import { z } from 'zod';
import { LocalLedgerError } from '../domain/local-ledger.ts';
import { snapshotPageSchema, syncPageSchema } from '../domain/ledger.ts';
import type { LocalDatabase } from './local-database.ts';

export type SyncStatus = { state: 'idle' | 'syncing' | 'current' | 'offline' | 'paused' | 'auth_required'; errorCode: string | null; dataRevision: number | null };
type Persistence = Pick<LocalDatabase, 'ownerId' | 'readMetadata' | 'acceptSnapshotPage' | 'applyDelta'>;
export type SyncEnvironment = { online: () => boolean; visible: () => boolean; subscribe: (listener: () => void) => () => void };
export const browserEnvironment: SyncEnvironment = {
  online: () => navigator.onLine, visible: () => document.visibilityState === 'visible',
  subscribe: listener => {
    window.addEventListener('online', listener); window.addEventListener('offline', listener); window.addEventListener('focus', listener); document.addEventListener('visibilitychange', listener);
    return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener); window.removeEventListener('focus', listener); document.removeEventListener('visibilitychange', listener); };
  },
};
export class SyncRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const errorSchema = z.object({ error: z.object({ code: z.string().max(100) }) });

/** Pull-only coordinator. Manual commands will use their own dependency queue;
 * polling or recovering a snapshot must never send a draft to the server. */
export class LedgerSynchronizer {
  private active = false;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private flight: Promise<{ dataRevision: number; rebuilt: boolean } | null> | null = null;
  private failures = 0;
  private authorizationPaused = false;
  private wakeRequested = false;
  private wasOnline = true;
  private status: SyncStatus = { state: 'idle', errorCode: null, dataRevision: null };
  constructor(private readonly database: Persistence, private readonly options: {
    fetch?: typeof fetch; environment?: SyncEnvironment; onStatus?: (status: SyncStatus) => void;
    onUpdated?: (result: { dataRevision: number; rebuilt: boolean }) => void;
  } = {}) {}
  private get environment() { return this.options.environment ?? browserEnvironment; }
  get currentStatus(): SyncStatus { return { ...this.status }; }
  private publish(state: SyncStatus['state'], errorCode: string | null = null, dataRevision = this.status.dataRevision) {
    this.status = { state, errorCode, dataRevision }; this.options.onStatus?.(this.currentStatus);
  }
  private clearTimer() { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
  start() {
    if (this.active) return;
    this.active = true;
    this.wasOnline = this.environment.online();
    this.unsubscribe = this.environment.subscribe(() => {
      const online = this.environment.online(), reconnected = online && !this.wasOnline; this.wasOnline = online;
      this.clearTimer();
      if (!this.environment.online() || !this.environment.visible()) {
        this.controller?.abort('visibilityOrNetwork');
        if (!this.authorizationPaused) this.publish(this.environment.online() ? 'idle' : 'offline');
      } else if (!this.authorizationPaused) {
        if (reconnected) this.failures = 0;
        if (this.flight) this.wakeRequested = true;
        else void this.refresh();
      }
    });
    void this.refresh();
  }
  stop() {
    this.active = false; this.wakeRequested = false; this.clearTimer(); this.unsubscribe?.(); this.unsubscribe = null; this.controller?.abort('stopped');
  }
  async stopAndWait() { this.stop(); await this.flight; }
  retry() { this.failures = 0; this.authorizationPaused = false; return this.refresh(); }
  refresh(): Promise<{ dataRevision: number; rebuilt: boolean } | null> {
    if (this.flight) return this.flight;
    if (this.authorizationPaused) return Promise.resolve(null);
    this.clearTimer();
    if (!this.environment.online() || !this.environment.visible()) { this.publish(this.environment.online() ? 'idle' : 'offline'); return Promise.resolve(null); }
    const controller = new AbortController(); this.controller = controller;
    this.publish('syncing');
    const timeout = setTimeout(() => controller.abort(new Error('SYNC_TIMEOUT')), 30000);
    this.flight = this.pull(controller.signal).then(result => {
      controller.signal.throwIfAborted(); this.failures = 0; this.publish('current', null, result.dataRevision); this.options.onUpdated?.(result); return result;
    }).catch((error: unknown) => {
      if (controller.signal.aborted && ['visibilityOrNetwork', 'stopped'].includes(String(controller.signal.reason))) return null;
      this.failures++;
      if (error instanceof SyncRequestError && (error.status === 401 || error.status === 403)) { this.failures = 5; this.authorizationPaused = true; this.publish('auth_required', error.code); }
      else this.publish('idle', error instanceof SyncRequestError ? error.code : error instanceof LocalLedgerError ? error.code : 'SYNC_FAILED');
      return null;
    }).finally(() => {
      clearTimeout(timeout); this.controller = null; this.flight = null;
      const wake = this.wakeRequested; this.wakeRequested = false;
      if (this.active && this.environment.online() && this.environment.visible() && !this.authorizationPaused) this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, wake ? 0 : this.failures ? Math.min(30000, 1000 * 2 ** Math.min(5, this.failures - 1)) : 5000);
    });
    return this.flight;
  }
  private async get(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await (this.options.fetch ?? fetch)(path, { method: 'GET', headers: { 'X-Account-Id': this.database.ownerId }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
    signal.throwIfAborted();
    let json: unknown;
    try { json = await response.json(); } catch { throw new SyncRequestError('INVALID_SYNC_RESPONSE', response.status); }
    if (!response.ok) { const error = errorSchema.safeParse(json); throw new SyncRequestError(error.success ? error.data.error.code : 'SYNC_FAILED', response.status); }
    return z.object({ data: z.unknown() }).parse(json).data;
  }
  private async rebuild(signal: AbortSignal): Promise<{ dataRevision: number; rebuilt: boolean }> {
    // A write between snapshot pages invalidates the entire staged generation.
    // Retry at most three generations; sustained changes use the normal backoff.
    for (let attempt = 0; attempt < 3; attempt++) {
      let cursor: string | null = null;
      try {
        do {
          const payload = await this.get(`/api/v1/sync/snapshot?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, signal), page = snapshotPageSchema.parse(payload);
          if (page.ownerId !== this.database.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
          signal.throwIfAborted();
          const result = await this.database.acceptSnapshotPage(page, cursor); cursor = result.nextCursor;
          if (result.complete) return { dataRevision: page.dataRevision, rebuilt: true };
        } while (cursor);
      } catch (error) {
        if (!(error instanceof SyncRequestError && [409, 410].includes(error.status)) && !(error instanceof LocalLedgerError && error.code === 'SNAPSHOT_CHANGED')) throw error;
      }
    }
    throw new SyncRequestError('SNAPSHOT_CHANGED', 409);
  }
  private async pull(signal: AbortSignal) {
    const initial = await this.database.readMetadata();
    if (!initial) return this.rebuild(signal);
    let cursor = initial.cursor;
    try {
      while (true) {
        const page = syncPageSchema.parse(await this.get(`/api/v1/sync?limit=20&cursor=${encodeURIComponent(cursor)}`, signal));
        if (page.ownerId !== this.database.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
        signal.throwIfAborted(); await this.database.applyDelta(page); cursor = page.nextCursor;
        if (!page.hasMore) return { dataRevision: page.dataRevision, rebuilt: false };
      }
    } catch (error) {
      if ((error instanceof SyncRequestError && error.status === 410) || (error instanceof LocalLedgerError && ['SNAPSHOT_REQUIRED', 'SYNC_GAP', 'INVALID_LOCAL_BASELINE'].includes(error.code))) return this.rebuild(signal);
      throw error;
    }
  }
}
