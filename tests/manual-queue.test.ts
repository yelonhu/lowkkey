import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandQueue } from '../src/client/command-queue.ts';
import type { CommandStatePatch } from '../src/client/local-database.ts';
import type { SyncEnvironment } from '../src/client/synchronizer.ts';
import { commandInputSchema, newQueuedCommand, prepareMutation, queuedCommandSchema, QueueError } from '../src/domain/manual-commands.ts';
import type { CommandInput, QueuedCommand } from '../src/domain/manual-commands.ts';
import type { CommandReceipt } from '../src/domain/command-receipt.ts';
import type { LocalLedger } from '../src/domain/local-ledger.ts';
import { storedWeightSchema } from '../src/domain/weight.ts';

const ownerId = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', epoch = 'fa682cd1-1d70-4f27-87f0-4b143f53b624', date = '2026-09-17', now = '2026-09-17T15:00:00.000Z';
function input(): CommandInput {
  const id = crypto.randomUUID();
  return commandInputSchema.parse({ schemaVersion: 1, operationId: crypto.randomUUID(), ownerId, clientEntityId: id, mutation: { kind: 'weight.create', input: { id, localDate: date, entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date', value: '70.00', unit: 'kg', condition: 'unspecified' } }, dependencies: [], localDate: date, entryTimezone: 'America/Chicago', createdAt: now, restoreEpoch: epoch, baseDataRevision: 0 });
}
function fixture(commands: CommandInput[] = [input()]) {
  let visible = true, online = true, listener: (() => void) | null = null;
  const env: SyncEnvironment = { visible: () => visible, online: () => online, subscribe: callback => { listener = callback; return () => { listener = null; }; } };
  const rows = new Map(commands.map(command => [command.operationId, newQueuedCommand(command)]));
  const ledger: LocalLedger = { ownerId, restoreEpoch: epoch, catalogRevision: 'a'.repeat(64), dataRevision: 0, cursor: 'cursor', items: new Map() };
  const database = { ownerId, subscribe: () => () => {}, readLedger: async () => ledger, listCommands: async () => [...rows.values()], readCommand: async (id: string) => rows.get(id) ?? null,
    updateCommand: async (id: string, revision: number, patch: CommandStatePatch) => {
      const before = rows.get(id);
      if (!before || before.localRevision !== revision || ['committed', 'discarded'].includes(before.state)) throw new QueueError('LOCAL_COMMAND_CHANGED');
      const next = queuedCommandSchema.parse({ ...before, ...patch, localRevision: revision + 1 }); rows.set(id, next); return next;
    },
  };
  const pull = { refresh: vi.fn(async () => ({ dataRevision: ledger.dataRevision, rebuilt: false })), retry: vi.fn(async () => ({ dataRevision: ledger.dataRevision, rebuilt: false })), currentStatus: { state: 'current' as const, errorCode: null, dataRevision: 0 } };
  const receipt = (command: QueuedCommand, refs: CommandReceipt['recordRefs'] = []): CommandReceipt => ({ operationId: command.operationId, dataRevision: ++ledger.dataRevision, recordRefs: refs, committedAt: now, undoAvailable: true, result: {} });
  return { database, rows, ledger, pull, env, receipt, options: { environment: env, clock: () => new Date(now) }, visibility: (value: boolean) => { visible = value; listener?.(); }, network: (value: boolean) => { online = value; listener?.(); } };
}
afterEach(() => { vi.useRealTimers(); });
describe('typed persistent manual commands', () => {
  it('rejects owner assignment, paths, wrong identity, missing dependency, malformed capture and incomplete numeric input', () => {
    const base = input();
    expect(commandInputSchema.safeParse({ ...base, mutation: { kind: 'weight.create', input: { ...(base.mutation.kind === 'weight.create' ? base.mutation.input : {}), ownerId } } }).success).toBe(false);
    for (const change of [{ path: 'https://example.invalid' }, { clientEntityId: crypto.randomUUID() }, { localDate: '2026-09-18' }, { entryTimezone: 'UTC' }, { dependencies: [base.operationId] }]) expect(commandInputSchema.safeParse({ ...base, ...change }).success).toBe(false);
    expect(commandInputSchema.safeParse({ ...base, mutation: { kind: 'set.delete', session: { type: 'workout_session', id: crypto.randomUUID(), source: { kind: 'receipt', operationId: crypto.randomUUID() } }, target: { type: 'workout_set', id: base.clientEntityId, source: { kind: 'observed', revision: 1 } } } }).success).toBe(false);
    expect(commandInputSchema.safeParse({ ...base, mutation: { kind: 'weight.create', input: { ...(base.mutation.kind === 'weight.create' ? base.mutation.input : {}), value: '70.' } } }).success).toBe(false);
  });
  it('derives root and child versions only from the named committed receipts', () => {
    const sessionId = crypto.randomUUID(), setId = crypto.randomUUID(), operationId = crypto.randomUUID();
    const mutation = { kind: 'set.update', session: { type: 'workout_session', id: sessionId, source: { kind: 'receipt', operationId } }, target: { type: 'workout_set', id: setId, source: { kind: 'receipt', operationId } }, input: { reps: 5 } };
    expect(() => prepareMutation(mutation)).toThrow('DEPENDENCY_MISSING');
    const receipt: CommandReceipt = { operationId, dataRevision: 12, committedAt: now, undoAvailable: true, result: {}, recordRefs: [{ type: 'workout_session', id: sessionId, revision: 4 }, { type: 'workout_set', id: setId, revision: 1 }] };
    expect(prepareMutation(mutation, new Map([[operationId, receipt]]))).toMatchObject({ expectedRevision: 4, body: { expectedRevision: 1, reps: 5 }, path: `/api/v1/training/sessions/${sessionId}/sets/${setId}` });
    expect(() => prepareMutation(mutation, new Map([[operationId, { ...receipt, recordRefs: [] }]]))).toThrow('INVALID_RECEIPT');
  });
  it('pulls first, binds the account and recovery epoch, and commits only a matching receipt', async () => {
    const f = fixture(), command = [...f.rows.values()][0], order: string[] = [];
    f.pull.refresh.mockImplementation(async () => { order.push('pull'); return { dataRevision: f.ledger.dataRevision, rebuilt: false }; });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { order.push('write'); expect(new Headers(init?.headers).get('X-Account-Id')).toBe(ownerId); expect(new Headers(init?.headers).get('X-Restore-Epoch')).toBe(epoch); expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(command.operationId); return Response.json({ data: f.receipt(command) }); });
    const queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher });
    const first = queue.flush(); expect(queue.flush()).toBe(first); await first;
    expect(order).toEqual(['pull', 'write', 'pull']); expect(f.rows.get(command.operationId)?.state).toBe('committed'); expect(fetcher).toHaveBeenCalledTimes(1); queue.stop();
  });
  it('queries a lost response before validating a now-changed baseline or issuing another write', async () => {
    const f = fixture(), command = [...f.rows.values()][0]; let saved: CommandReceipt | null = null;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'POST') { saved = f.receipt(command); throw new TypeError('Lost response'); }
      return Response.json({ data: saved });
    });
    const queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher }); await queue.flush();
    expect(f.rows.get(command.operationId)?.state).toBe('uncertain');
    f.ledger.restoreEpoch = crypto.randomUUID(); await queue.flush();
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']); expect(f.rows.get(command.operationId)?.state).toBe('committed'); queue.stop();
  });
  it('does not retry an expired, restored or explicitly invalidated baseline without review', async () => {
    for (const mode of ['age', 'epoch', 'rebuild', 'future'] as const) {
      const command = input();
      if (mode === 'age') command.createdAt = '2026-08-01T00:00:00.000Z';
      if (mode === 'future') command.createdAt = '2026-09-18T00:00:00.000Z';
      const f = fixture([command]);
      if (mode === 'epoch') f.ledger.restoreEpoch = crypto.randomUUID();
      if (mode === 'rebuild') f.rows.set(command.operationId, { ...f.rows.get(command.operationId)!, reviewRequired: true });
      const fetcher = vi.fn<typeof fetch>(), queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher }); await queue.flush();
      expect(fetcher).not.toHaveBeenCalled(); expect(f.rows.get(command.operationId)?.state).toBe('needs_review'); queue.stop();
    }
  });
  it('holds stale/deleted edits and their dependents while unrelated appends can still succeed', async () => {
    const edit = input(), extra = input(), dependent = input();
    edit.mutation = { kind: 'weight.update', target: { type: 'weight_entry', id: edit.clientEntityId, source: { kind: 'observed', revision: 1 } }, input: { value: '71', confirmedOutlier: false } }; dependent.dependencies = [edit.operationId];
    const f = fixture([edit, dependent, extra]);
    f.ledger.items.set(`weight_entry:${edit.clientEntityId}`, { kind: 'weight_entry', value: storedWeightSchema.parse({ id: edit.clientEntityId, ownerId, revision: 2, createdAt: now, updatedAt: now, deletedAt: null, localDate: date, entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date', value: '72', unit: 'kg', kgMicros: 72000000, condition: 'unspecified', isPrimary: true, sourceKind: 'manual', sourceRef: null, operationId: crypto.randomUUID(), createdOperationId: crypto.randomUUID() }) });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: f.receipt(f.rows.get(extra.operationId)!) }));
    const queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher }); await queue.flush();
    expect(f.rows.get(edit.operationId)).toMatchObject({ state: 'conflict', issue: { code: 'REVISION_CONFLICT' } }); expect(f.rows.get(dependent.operationId)?.state).toBe('needs_review'); expect(f.rows.get(extra.operationId)?.state).toBe('committed'); expect(fetcher).toHaveBeenCalledTimes(1); queue.stop();
  });
  it('keeps server confirmation details and refuses to invent a receipt from a wrong operation', async () => {
    const f = fixture(), command = [...f.rows.values()][0];
    const rejected = new CommandQueue(f.database, f.pull, { ...f.options, fetch: async () => Response.json({ error: { code: 'NEEDS_CONFIRMATION', messageKey: 'errors.needsConfirmation', retryable: false, params: { reason: 'sameDayPrimary', primaryId: crypto.randomUUID(), primaryRevision: 2 } } }, { status: 422 }) }); await rejected.flush();
    expect(f.rows.get(command.operationId)).toMatchObject({ state: 'rejected', issue: { code: 'NEEDS_CONFIRMATION', params: { reason: 'sameDayPrimary', primaryRevision: 2 } } }); rejected.stop();
    const other = fixture(), wrong = new CommandQueue(other.database, other.pull, { ...other.options, fetch: async () => Response.json({ data: { ...other.receipt([...other.rows.values()][0]), operationId: crypto.randomUUID() } }) }); await wrong.flush(); expect([...other.rows.values()][0]).toMatchObject({ state: 'uncertain', issue: { code: 'INVALID_RECEIPT' }, receipt: null }); wrong.stop();
  });
  it('continues retries after five failures with a 30 second cap and pauses in background', async () => {
    vi.useFakeTimers(); const f = fixture(), fetcher = vi.fn<typeof fetch>(async () => { throw new TypeError('Offline transport'); });
    const queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher }); queue.start(); await queue.flush();
    for (const delay of [1000, 2000, 4000, 8000]) await vi.advanceTimersByTimeAsync(delay);
    expect(fetcher).toHaveBeenCalledTimes(5); expect(queue.currentStatus.state).toBe('idle');
    await vi.advanceTimersByTimeAsync(16000); expect(fetcher).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(29999); expect(fetcher).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(7);
    f.visibility(false); await vi.advanceTimersByTimeAsync(120000); expect(fetcher).toHaveBeenCalledTimes(7);
    f.visibility(true); await queue.flush(); expect(fetcher).toHaveBeenCalledTimes(8); queue.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps an unauthorized queue paused across visibility changes, even before a write', async () => {
    vi.useFakeTimers(); const f = fixture(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 'AUTH_REQUIRED', params: { reason: 'accountChanged' } } }, { status: 401 }));
    const queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher }); queue.start(); await queue.flush(); expect(queue.currentStatus.state).toBe('auth_required');
    f.visibility(false); f.visibility(true); f.network(false); f.network(true); await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledTimes(1); expect([...f.rows.values()][0].state).toBe('uncertain'); queue.stop();
  });
  it('recovers an expired tab lease and prevents another tab from claiming an active lease', async () => {
    const f = fixture(), command = [...f.rows.values()][0];
    f.rows.set(command.operationId, { ...command, state: 'sending', lease: { token: crypto.randomUUID(), until: '2026-09-17T15:00:45.000Z' } });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: f.receipt(command) })), queue = new CommandQueue(f.database, f.pull, { ...f.options, fetch: fetcher });
    await queue.flush(); expect(fetcher).not.toHaveBeenCalled();
    f.rows.set(command.operationId, { ...f.rows.get(command.operationId)!, lease: { token: crypto.randomUUID(), until: now } }); await queue.flush(); expect(fetcher).toHaveBeenCalledTimes(1); expect(f.rows.get(command.operationId)?.state).toBe('committed'); queue.stop();
  });
});
