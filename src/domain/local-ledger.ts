import { ledgerEntitySchema, ledgerKey, ledgerOwner, snapshotPageSchema, syncPageSchema } from './ledger.ts';
import type { LedgerEntity, LedgerItem, SnapshotPage } from './ledger.ts';

export type LocalLedger = {
  ownerId: string; restoreEpoch: string; catalogRevision: string; dataRevision: number; cursor: string;
  items: Map<string, LedgerItem>;
};
export class LocalLedgerError extends Error {
  constructor(readonly code: 'OWNER_MISMATCH' | 'SNAPSHOT_REQUIRED' | 'SYNC_GAP' | 'SNAPSHOT_CHANGED' | 'INVALID_LOCAL_BASELINE') { super(code); }
}
export type SnapshotAssembly = {
  ownerId: string; restoreEpoch: string; catalogRevision: string; dataRevision: number; capturedAt: string;
  items: Map<string, LedgerItem>; nextCursor: string | null;
};
/** Incomplete pages live in a staging generation, never in the visible cache. */
export function appendSnapshot(owner: string, previous: SnapshotAssembly | null, payload: unknown): { staging: SnapshotAssembly | null; ledger: LocalLedger | null } {
  const page = snapshotPageSchema.parse(payload);
  if (page.ownerId !== owner) throw new LocalLedgerError('OWNER_MISMATCH');
  if (previous && (previous.ownerId !== owner || previous.restoreEpoch !== page.restoreEpoch || previous.dataRevision !== page.dataRevision || previous.catalogRevision !== page.catalogRevision || previous.capturedAt !== page.capturedAt)) throw new LocalLedgerError('SNAPSHOT_CHANGED');
  const items = new Map(previous?.items ?? []);
  for (const item of page.items) {
    const key = ledgerKey(item);
    if (items.has(key)) throw new LocalLedgerError('SNAPSHOT_CHANGED');
    items.set(key, item);
  }
  const state = { ownerId: owner, restoreEpoch: page.restoreEpoch, catalogRevision: page.catalogRevision, dataRevision: page.dataRevision, items };
  if (page.syncCursor === null) return { staging: { ...state, capturedAt: page.capturedAt, nextCursor: page.nextCursor }, ledger: null };
  return { staging: null, ledger: { ...state, cursor: page.syncCursor } };
}
export function applySyncPage(previous: LocalLedger, payload: unknown): LocalLedger {
  const page = syncPageSchema.parse(payload);
  if (page.ownerId !== previous.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
  if (page.restoreEpoch !== previous.restoreEpoch || page.catalogRevision !== previous.catalogRevision) throw new LocalLedgerError('SNAPSHOT_REQUIRED');
  if (page.fromRevision > previous.dataRevision) throw new LocalLedgerError('SYNC_GAP');
  const last = page.items.at(-1)?.dataRevision ?? page.fromRevision;
  if (last < previous.dataRevision) return previous;
  const items = new Map(previous.items);
  let revision = previous.dataRevision;
  for (const batch of page.items) {
    if (batch.dataRevision <= revision) continue;
    if (batch.dataRevision !== revision + 1) throw new LocalLedgerError('SYNC_GAP');
    for (const [index, item] of batch.changes.entries()) {
      const key = ledgerKey(item), before = items.get(key), expected = batch.events[index].beforeRevision;
      if ((before && (!('revision' in before.value) || before.value.revision !== expected)) || (!before && expected !== null)) throw new LocalLedgerError('INVALID_LOCAL_BASELINE');
      items.set(key, item);
    }
    for (const item of batch.supplements) {
      const key = ledgerKey(item), before = items.get(key);
      if (before && JSON.stringify(before) !== JSON.stringify(item)) throw new LocalLedgerError('INVALID_LOCAL_BASELINE');
      items.set(key, item);
    }
    revision = batch.dataRevision;
  }
  return { ...previous, items, dataRevision: revision, cursor: page.nextCursor };
}
/** A parent tombstone hides descendants without discarding their undoable data. */
export function visibleLedgerEntities(ledger: Pick<LocalLedger, 'ownerId' | 'items'>): LedgerEntity[] {
  const entities = [...ledger.items.values()].flatMap(item => {
    const result = ledgerEntitySchema.safeParse(item);
    return result.success && result.data.value.deletedAt === null && ledgerOwner(result.data) === ledger.ownerId ? [result.data] : [];
  });
  const sessions = new Set(entities.filter(item => item.kind === 'workout_session').map(item => item.value.id));
  const exercises = new Set(entities.filter(item => item.kind === 'session_exercise' && sessions.has(item.value.sessionId)).map(item => item.value.id));
  const meals = new Set(entities.filter(item => item.kind === 'meal').map(item => item.value.id));
  return entities.filter(item => item.kind === 'session_exercise' ? sessions.has(item.value.sessionId) : item.kind === 'workout_set' ? exercises.has(item.value.sessionExerciseId) : item.kind === 'meal_item' ? meals.has(item.value.mealId) : true);
}
export function snapshotPagesMatch(a: SnapshotPage, b: SnapshotPage): boolean {
  return a.ownerId === b.ownerId && a.restoreEpoch === b.restoreEpoch && a.catalogRevision === b.catalogRevision && a.dataRevision === b.dataRevision && a.capturedAt === b.capturedAt;
}
