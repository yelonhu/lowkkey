import { expect, it } from 'vitest';
import { newQueuedCommand, observed } from '../src/domain/manual-commands.ts';
import type { LocalLedger } from '../src/domain/local-ledger.ts';
import { orderedCommands, trainingProjection, versionFor } from '../src/app/training/training-state.ts';
const ownerId = crypto.randomUUID(), sessionId = crypto.randomUUID(), exerciseId = crypto.randomUUID();
const at = '2026-09-17T15:00:00.000Z';
const ledger: LocalLedger = { ownerId, restoreEpoch: crypto.randomUUID(), catalogRevision: 'v1', dataRevision: 0, cursor: '', items: new Map() };
function command(mutation: unknown, id = sessionId, dependencies: string[] = []) {
  return newQueuedCommand({ schemaVersion: 1, ownerId, operationId: crypto.randomUUID(), clientEntityId: id, createdAt: at, localDate: '2026-09-16', entryTimezone: 'UTC', restoreEpoch: ledger.restoreEpoch, baseDataRevision: 0, mutation, dependencies });
}
const create = () => command({ kind: 'session.create', input: { id: sessionId, localDate: '2026-09-16', entryTimezone: 'UTC', timePrecision: 'date' } });
it('orders successors by dependency even when operation UUID order differs', () => {
  const first = create();
  const second = command({ kind: 'session.transition', action: 'pause', target: { type: 'workout_session', id: sessionId, source: { kind: 'receipt', operationId: first.operationId } } }, sessionId, [first.operationId]);
  expect(orderedCommands([second, first]).map(row => row.operationId)).toEqual([first.operationId, second.operationId]);
  expect(versionFor({ type: 'workout_session', id: sessionId, revision: 1 }, [second, first]).source).toEqual({ kind: 'receipt', operationId: second.operationId });
});
it('separates local completion from facts and keeps date-only timestamps null', () => {
  const first = create(), finish = command({ kind: 'session.transition', target: { type: 'workout_session', id: sessionId, source: { kind: 'receipt', operationId: first.operationId } }, action: 'finish' }, sessionId, [first.operationId]);
  const model = trainingProjection(ledger, [finish, first]);
  expect(model.sessions[0]).toMatchObject({ status: 'completed', startedAt: null, endedAt: null });
  expect(model.pending.get(sessionId)?.operationId).toBe(finish.operationId);
  expect(ledger.items.size).toBe(0);
});
it('does not overlay a rejected or conflicting session as a successful fact', () => {
  for (const state of ['conflict', 'rejected', 'needs_review', 'discarded'] as const) {
    const model = trainingProjection(ledger, [{ ...create(), state }]);
    expect(model.sessions).toEqual([]);
  }
});
it('does not resurrect sets beneath a deleted or missing exercise', () => {
  const setId = crypto.randomUUID();
  const set = command({ kind: 'set.create', session: observed({ type: 'workout_session', id: sessionId, revision: 1 }), input: { id: setId, sessionExerciseId: exerciseId, ordinal: 1, reps: 10, load: { value: '110', unit: 'lb', semantics: 'external_total' } } }, setId);
  expect(trainingProjection(ledger, [create(), set]).sets).toEqual([]);
});
