import { z } from 'zod';
import { commandReceiptSchema } from '../domain/command-receipt.ts';
import type { CommandReceipt } from '../domain/command-receipt.ts';
import { commandNeedsReview, prepareMutation, QueueError, queueIssueSchema, validateCommandBaseline } from '../domain/manual-commands.ts';
import type { QueuedCommand } from '../domain/manual-commands.ts';
import type { LocalDatabase, CommandStatePatch } from './local-database.ts';
import { browserEnvironment, SyncRequestError } from './synchronizer.ts';
import type { LedgerSynchronizer, SyncEnvironment } from './synchronizer.ts';

type Persistence = Pick<LocalDatabase, 'ownerId' | 'listCommands' | 'readCommand' | 'readLedger' | 'updateCommand' | 'subscribe'>;
type Pull = Pick<LedgerSynchronizer, 'refresh' | 'retry' | 'currentStatus'>;
export type QueueStatus = { state: 'idle' | 'working' | 'offline' | 'paused' | 'auth_required'; errorCode: string | null };
class RequestFailure extends Error {
  constructor(readonly status: number, readonly issue: z.infer<typeof queueIssueSchema>) { super(issue.code); }
}
const envelopeSchema = z.object({ data: commandReceiptSchema });

/** Persistent manual commands are sent only in the foreground, after pulling
 * authoritative changes. A local lease limits duplicate tab work; the server's
 * idempotency key remains authoritative even if a tab dies during a request. */
export class CommandQueue {
  private active = false;
  private flight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: Array<() => void> = [];
  private failures = 0;
  private authPaused = false;
  private status: QueueStatus = { state: 'idle', errorCode: null };
  constructor(private readonly database: Persistence, private readonly synchronizer: Pull, private readonly options: {
    fetch?: typeof fetch; environment?: SyncEnvironment; clock?: () => Date; onStatus?: (status: QueueStatus) => void;
  } = {}) {}
  private get environment() { return this.options.environment ?? browserEnvironment; }
  private now() { return (this.options.clock ?? (() => new Date()))(); }
  get currentStatus() { return { ...this.status }; }
  private publish(state: QueueStatus['state'], errorCode: string | null = null) { this.status = { state, errorCode }; this.options.onStatus?.(this.currentStatus); }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule(delay: number) {
    this.clearTimer();
    if (this.active && !this.authPaused && this.failures < 5 && this.environment.online() && this.environment.visible()) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }
  start() {
    if (this.active) return;
    this.active = true;
    let wasOnline = this.environment.online();
    this.unsubscribe = [this.database.subscribe(() => { if (!this.flight) this.schedule(0); }), this.environment.subscribe(() => {
      const reconnected = !wasOnline && this.environment.online(); wasOnline = this.environment.online();
      this.clearTimer();
      if (!this.environment.online() || !this.environment.visible()) { this.controller?.abort('inactive'); if (!this.authPaused) this.publish(this.environment.online() ? 'idle' : 'offline'); }
      else if (!this.authPaused) { if (reconnected) this.failures = 0; if (!this.flight) void this.flush(); }
    })];
    void this.flush();
  }
  stop() { this.active = false; this.clearTimer(); for (const unsubscribe of this.unsubscribe) unsubscribe(); this.unsubscribe = []; this.controller?.abort('stopped'); }
  async stopAndWait() { this.stop(); await this.flight; }
  async retry() { this.failures = 0; this.authPaused = false; await this.synchronizer.retry(); return this.flush(); }
  flush(): Promise<void> {
    if (this.flight) return this.flight;
    if (this.authPaused || this.failures >= 5) return Promise.resolve();
    this.clearTimer();
    if (!this.environment.online() || !this.environment.visible()) { this.publish(this.environment.online() ? 'idle' : 'offline'); return Promise.resolve(); }
    const controller = new AbortController(); this.controller = controller; this.publish('working');
    this.flight = this.drain(controller.signal).then(() => { if (!controller.signal.aborted) { this.failures = 0; this.publish('idle'); } }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      this.failures++;
      if ((error instanceof RequestFailure || error instanceof SyncRequestError) && [401, 403].includes(error.status)) { this.authPaused = true; this.publish('auth_required', error instanceof RequestFailure ? error.issue.code : error.code); }
      else this.publish(this.failures >= 5 ? 'paused' : 'idle', error instanceof QueueError ? error.code : error instanceof RequestFailure ? error.issue.code : 'SYNC_FAILED');
    }).finally(() => {
      this.controller = null; this.flight = null;
      this.schedule(this.failures ? 1000 * 2 ** (this.failures - 1) : 5000);
    });
    return this.flight;
  }
  private async pull(signal: AbortSignal) {
    signal.throwIfAborted();
    const result = await this.synchronizer.refresh(); signal.throwIfAborted();
    if (!result) throw new SyncRequestError(this.synchronizer.currentStatus.errorCode ?? 'SYNC_FAILED', this.synchronizer.currentStatus.state === 'auth_required' ? 401 : 503);
    const ledger = await this.database.readLedger();
    if (!ledger || ledger.ownerId !== this.database.ownerId) throw new QueueError('OWNER_MISMATCH');
    return ledger;
  }
  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<CommandReceipt> {
    const deadline = new AbortController(), abort = () => deadline.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => deadline.abort(new Error('COMMAND_TIMEOUT')), 30000);
    try {
      signal.throwIfAborted();
      const headers = new Headers(init.headers); headers.set('X-Account-Id', this.database.ownerId);
      const response = await (this.options.fetch ?? fetch)(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: deadline.signal });
      deadline.signal.throwIfAborted();
      const raw: unknown = await response.json(); deadline.signal.throwIfAborted();
      if (!response.ok) {
        const parsed = z.object({ error: z.object(queueIssueSchema.shape) }).safeParse(raw);
        throw new RequestFailure(response.status, parsed.success ? parsed.data.error : { code: 'INVALID_RESPONSE', params: {} });
      }
      return envelopeSchema.parse(raw).data;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  private async update(command: QueuedCommand, patch: CommandStatePatch) { return this.database.updateCommand(command.operationId, command.localRevision, patch); }
  private async drain(signal: AbortSignal) {
    // A bounded pass prevents a stream of newly queued commands monopolizing the page.
    for (let count = 0; count < 100; count++) {
      signal.throwIfAborted();
      let all = await this.database.listCommands();
      const eligible = (command: QueuedCommand) => ['queued', 'uncertain'].includes(command.state) || (command.state === 'sending' && command.lease !== null && command.lease.until <= this.now().toISOString());
      if (!all.some(eligible)) return;
      const ledger = await this.pull(signal);
      all = await this.database.listCommands();
      const byId = new Map(all.map(command => [command.operationId, command]));
      let progressed = false;
      for (const candidate of all.filter(eligible)) {
        signal.throwIfAborted();
        const dependencies = candidate.dependencies.map(id => byId.get(id));
        if (dependencies.some(command => !command || ['discarded', 'conflict', 'needs_review', 'rejected'].includes(command.state))) {
          try { await this.update(candidate, { state: 'needs_review', lease: null, issue: { code: 'DEPENDENCY_BLOCKED', params: {} } }); } catch (error) { if (!(error instanceof QueueError && error.code === 'LOCAL_COMMAND_CHANGED')) throw error; }
          progressed = true; continue;
        }
        if (dependencies.some(command => command?.state !== 'committed')) continue;
        let command: QueuedCommand;
        try { command = await this.update(candidate, { state: 'sending', lease: { token: crypto.randomUUID(), until: new Date(this.now().getTime() + 45000).toISOString() } }); }
        catch (error) { if (error instanceof QueueError && error.code === 'LOCAL_COMMAND_CHANGED') continue; throw error; }
        try {
          let receipt: CommandReceipt | null = null;
          if (command.firstAttemptAt !== null) {
            try { receipt = await this.request(`/api/v1/operations/${command.operationId}`, { method: 'GET' }, signal); }
            catch (error) { if (!(error instanceof RequestFailure && error.status === 404)) throw error; }
          }
          if (receipt === null) {
            if (commandNeedsReview(command, ledger, this.now())) throw new QueueError('REVIEW_REQUIRED');
            const receipts = new Map(dependencies.flatMap(dependency => dependency?.receipt ? [[dependency.operationId, dependency.receipt] as const] : []));
            const prepared = prepareMutation(command.mutation, receipts);
            validateCommandBaseline(command, prepared, ledger); signal.throwIfAborted();
            command = await this.update(command, { firstAttemptAt: command.firstAttemptAt ?? this.now().toISOString(), attempts: command.attempts + 1 });
            const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': command.operationId, 'X-Restore-Epoch': command.restoreEpoch };
            if (prepared.expectedRevision !== null) headers['If-Match'] = `"${prepared.expectedRevision}"`;
            receipt = await this.request(prepared.path, { method: prepared.method, headers, body: JSON.stringify(prepared.body) }, signal);
          }
          if (receipt.operationId !== command.operationId) throw new QueueError('INVALID_RECEIPT');
          await this.update(command, { state: 'committed', receipt, lease: null, issue: null });
          // The next command pulls the resulting batch before resolving versions.
          await this.pull(signal); progressed = true; break;
        } catch (error) {
          if (error instanceof QueueError && error.code === 'LOCAL_COMMAND_CHANGED') { progressed = true; break; }
          const localConflict = error instanceof QueueError && ['REVISION_CONFLICT', 'RECORD_NOT_FOUND', 'DEPENDENCY_BLOCKED'].includes(error.code);
          const review = (error instanceof QueueError && error.code === 'REVIEW_REQUIRED') || (error instanceof RequestFailure && error.issue.code === 'SYNC_CURSOR_EXPIRED');
          const terminal = error instanceof RequestFailure && [400, 404, 409, 410, 422].includes(error.status);
          const patch: CommandStatePatch = {
            state: review ? 'needs_review' : localConflict || (terminal && error.status === 409) ? 'conflict' : terminal ? 'rejected' : command.firstAttemptAt === null ? 'queued' : 'uncertain',
            lease: null, issue: error instanceof RequestFailure ? error.issue : { code: error instanceof QueueError ? error.code : 'SYNC_FAILED', params: {} },
          };
          try { await this.update(command, patch); } catch (saveError) { if (!(saveError instanceof QueueError && saveError.code === 'LOCAL_COMMAND_CHANGED')) throw saveError; }
          if (localConflict || review || terminal) { progressed = true; break; }
          throw error;
        }
      }
      if (!progressed) return;
    }
  }
}
