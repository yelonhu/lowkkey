import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerSynchronizer } from '../src/client/synchronizer.ts';
import type { SyncEnvironment } from '../src/client/synchronizer.ts';
import { appendSnapshot, applySyncPage } from '../src/domain/local-ledger.ts';
import type { LocalLedger, SnapshotAssembly } from '../src/domain/local-ledger.ts';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', epoch = 'fa682cd1-1d70-4f27-87f0-4b143f53b624';
const base = { schemaVersion: 1, ownerId: owner, restoreEpoch: epoch, dataRevision: 0, catalogRevision: 'a'.repeat(64), capturedAt: '2026-09-16T20:00:00.000Z' };
const snapshot = { ...base, items: [], nextCursor: null, syncCursor: 'snapshot-cursor' };
const page = { ...base, fromRevision: 0, items: [], nextCursor: 'next-cursor', hasMore: false };
function persistence(initial = false) {
  let ledger: LocalLedger | null = initial ? appendSnapshot(owner, null, snapshot).ledger : null, staging: SnapshotAssembly | null = null;
  return {
    ownerId: owner,
    readMetadata: vi.fn(async () => ledger),
    acceptSnapshotPage: vi.fn(async (payload: unknown, cursor: string | null) => {
      const result = appendSnapshot(owner, cursor ? staging : null, payload); staging = result.staging;
      if (result.ledger) ledger = result.ledger;
      return { complete: result.ledger !== null, nextCursor: result.staging?.nextCursor ?? null };
    }),
    applyDelta: vi.fn(async (payload: unknown) => { if (!ledger) throw new Error('No baseline'); ledger = applySyncPage(ledger, payload); }),
  };
}
function environment() {
  let visible = true, online = true, listener: (() => void) | null = null;
  const env: SyncEnvironment = { visible: () => visible, online: () => online, subscribe: value => { listener = value; return () => { listener = null; }; } };
  return { env, visibility: (value: boolean) => { visible = value; listener?.(); }, network: (value: boolean) => { online = value; listener?.(); }, subscribed: () => listener !== null };
}
afterEach(() => { vi.useRealTimers(); });
describe('foreground pull coordination', () => {
  it('starts with a complete snapshot, coalesces callers and performs only no-store GET requests', async () => {
    const db = persistence(), env = environment(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: snapshot })), updated = vi.fn();
    const sync = new LedgerSynchronizer(db, { fetch: fetcher, environment: env.env, onUpdated: updated });
    const first = sync.refresh(), second = sync.refresh(); expect(first).toBe(second);
    expect(await first).toEqual({ dataRevision: 0, rebuilt: true }); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toMatchObject(['/api/v1/sync/snapshot?limit=100', { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' }]);
    expect(sync.currentStatus).toEqual({ state: 'current', errorCode: null, dataRevision: 0 }); expect(updated).toHaveBeenCalledTimes(1); sync.stop();
  });
  it('polls every five seconds only while visible and online, and removes listeners on stop', async () => {
    vi.useFakeTimers();
    const db = persistence(true), env = environment(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: page }));
    const sync = new LedgerSynchronizer(db, { fetch: fetcher, environment: env.env }); sync.start(); await sync.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(4999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    env.visibility(false); await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledTimes(2);
    env.visibility(true); await sync.refresh(); expect(fetcher).toHaveBeenCalledTimes(3);
    env.network(false); await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledTimes(3); expect(sync.currentStatus.state).toBe('offline');
    env.network(true); await sync.refresh(); expect(fetcher).toHaveBeenCalledTimes(4);
    sync.stop(); expect(env.subscribed()).toBe(false); await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
  });
  it('retries indefinitely with a 30 second cap and pauses while hidden', async () => {
    vi.useFakeTimers();
    let failing = true;
    const db = persistence(true), env = environment(), fetcher = vi.fn<typeof fetch>(async () => failing ? Response.json({ error: { code: 'TEMPORARY_FAILURE' } }, { status: 503 }) : Response.json({ data: page }));
    const sync = new LedgerSynchronizer(db, { fetch: fetcher, environment: env.env }); sync.start(); await sync.refresh();
    for (const delay of [1000, 2000, 4000, 8000]) await vi.advanceTimersByTimeAsync(delay);
    expect(fetcher).toHaveBeenCalledTimes(5); expect(sync.currentStatus).toMatchObject({ state: 'idle', errorCode: 'TEMPORARY_FAILURE' });
    await vi.advanceTimersByTimeAsync(16000); expect(fetcher).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(29999); expect(fetcher).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(30000); expect(fetcher).toHaveBeenCalledTimes(8);
    env.visibility(false); await vi.advanceTimersByTimeAsync(120000); expect(fetcher).toHaveBeenCalledTimes(8);
    failing = false; env.visibility(true); await sync.refresh(); expect(fetcher).toHaveBeenCalledTimes(9); expect(sync.currentStatus.state).toBe('current'); sync.stop();
  });
  it('rebuilds on an expired cursor and retries an invalidated snapshot generation', async () => {
    const db = persistence(true), env = environment();
    const responses = [Response.json({ error: { code: 'SYNC_CURSOR_EXPIRED' } }, { status: 410 }), Response.json({ data: { ...snapshot, nextCursor: 'next-page', syncCursor: null } }), Response.json({ error: { code: 'REVISION_CONFLICT' } }, { status: 409 }), Response.json({ data: snapshot })];
    const fetcher = vi.fn<typeof fetch>(async () => { const response = responses.shift(); if (!response) throw new Error('Unexpected extra request'); return response; });
    const sync = new LedgerSynchronizer(db, { fetch: fetcher, environment: env.env });
    expect(await sync.refresh()).toEqual({ dataRevision: 0, rebuilt: true });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/sync?limit=20&cursor=snapshot-cursor', '/api/v1/sync/snapshot?limit=100', '/api/v1/sync/snapshot?limit=100&cursor=next-page', '/api/v1/sync/snapshot?limit=100']);
    expect(db.applyDelta).not.toHaveBeenCalled(); sync.stop();
  });
  it('does not save a response after stopping or consume another owner’s response', async () => {
    const db = persistence(true), env = environment(); let release: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const sync = new LedgerSynchronizer(db, { fetch: fetcher, environment: env.env });
    const flight = sync.refresh(); await Promise.resolve(); sync.stop(); release?.(Response.json({ data: page })); await flight;
    expect(db.applyDelta).not.toHaveBeenCalled();
    const foreign = new LedgerSynchronizer(db, { environment: env.env, fetch: async () => Response.json({ data: { ...page, ownerId: crypto.randomUUID() } }) });
    expect(await foreign.refresh()).toBeNull(); expect(foreign.currentStatus.errorCode).toBe('OWNER_MISMATCH'); expect(db.applyDelta).not.toHaveBeenCalled(); foreign.stop();
  });
  it('pauses on revoked identity without turning existing records into an empty dataset', async () => {
    vi.useFakeTimers();
    const db = persistence(true), env = environment(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 'MEMBER_SUSPENDED' } }, { status: 403 }));
    const sync = new LedgerSynchronizer(db, { environment: env.env, fetch: fetcher }); sync.start(); await sync.refresh();
    expect(sync.currentStatus).toMatchObject({ state: 'auth_required', errorCode: 'MEMBER_SUSPENDED' });
    env.visibility(false); env.visibility(true); await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(db.applyDelta).not.toHaveBeenCalled(); expect(db.acceptSnapshotPage).not.toHaveBeenCalled(); sync.stop();
  });
});
