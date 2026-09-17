import type { D1Database } from '@cloudflare/workers-types';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan } from './commands.ts';
import { DomainError } from './errors.ts';
import { expectRevision, mergePlans, reviseRecord } from './record-store.ts';
import type { OwnedRecord, RecordStore } from './record-store.ts';
import { sessionExercises, sessions, sets } from './training-store.ts';

type RevisionRow = { target_type: string; target_id: string; before_snapshot: string | null; after_revision: number };
async function reverse<T extends OwnedRecord>(context: CommandContext, store: RecordStore<T>, row: RevisionRow) {
  const current = await store.read(context.db, context.auth.id, row.target_id, true); expectRevision(current, row.after_revision);
  const before = row.before_snapshot === null ? null : store.schema.parse(JSON.parse(row.before_snapshot));
  const fields = before ?? { deletedAt: context.now, ...(store.type === 'workout_session' ? { status: 'deleted' } : {}) };
  return store.plan(context, current, reviseRecord(current, context, fields as Partial<T>));
}
export function undoTraining(db: D1Database, auth: AuthContext, operationId: string, originalId: string, clock?: () => Date) {
  return executeCommand(db, auth, { operationId, kind: 'training.undo', payload: { originalId }, entryPoint: 'manual', plan: async context => {
    const operation = await db.prepare('SELECT kind,undo_until,undone_by FROM command_operations WHERE owner_id=? AND operation_id=?').bind(auth.id, originalId).first<{ kind: string; undo_until: string | null; undone_by: string | null }>();
    if (!operation) throw new DomainError('RECORD_NOT_FOUND', 404);
    if (!operation.kind.startsWith('training.') || operation.kind === 'training.undo' || !operation.undo_until || operation.undo_until < context.now || operation.undone_by) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'undoUnavailable' });
    const rows = await db.prepare('SELECT target_type,target_id,before_snapshot,after_revision FROM operation_revisions WHERE owner_id=? AND operation_id=? ORDER BY CASE WHEN target_type=\'workout_session\' THEN 0 ELSE 1 END,id').bind(auth.id, originalId).all<RevisionRow>();
    const changes: CommandPlan[] = [];
    for (const row of rows.results) {
      if (row.target_type === 'workout_session') changes.push(await reverse(context, sessions, row));
      else if (row.target_type === 'session_exercise') changes.push(await reverse(context, sessionExercises, row));
      else if (row.target_type === 'workout_set') changes.push(await reverse(context, sets, row));
      else throw new DomainError('REVISION_CONFLICT', 409, { reason: 'undoUnavailable' });
    }
    const plan = mergePlans(changes, { originalOperationId: originalId }, false);
    for (const entity of plan.entities) if (entity.type === 'workout_session') {
      const after = sessions.schema.parse(entity.after);
      if (after.status === 'in_progress') plan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM workout_sessions WHERE owner_id=? AND id<>? AND deleted_at IS NULL AND status='in_progress')", values: [auth.id, after.id], error: new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'sessionInProgress' }) });
      if (after.deletedAt === null) {
        const setsBefore = await db.prepare('SELECT s.id FROM workout_sets s JOIN session_exercises e ON e.owner_id=s.owner_id AND e.id=s.session_exercise_id WHERE e.owner_id=? AND e.session_id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL').bind(auth.id, after.id).all<{ id: string }>();
        const actual = new Set(setsBefore.results.map(row => row.id));
        for (const change of plan.entities) if (change.type === 'workout_set') { if (change.after.deletedAt === null) actual.add(String(change.after.id)); else actual.delete(String(change.after.id)); }
        // Restoring a deleted exercise makes its unchanged child sets visible again.
        for (const change of plan.entities) if (change.type === 'session_exercise' && change.after.deletedAt === null) {
          const descendants = await sets.list(db, auth.id, 'session_exercise_id=?', [String(change.after.id)]);
          for (const set of descendants) actual.add(set.id);
        }
        if (after.status === 'completed' && !actual.size) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'noActualSets' });
        if (actual.size) plan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM day_claims WHERE owner_id=? AND local_date=? AND training_claim='rest_confirmed' AND deleted_at IS NULL)", values: [auth.id, after.localDate], error: new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'restConfirmed' }) });
        if (after.scheduledSessionId) plan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM workout_sessions WHERE owner_id=? AND scheduled_session_id=? AND id<>? AND deleted_at IS NULL AND status<>'cancelled')", values: [auth.id, after.scheduledSessionId, after.id], error: new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'scheduleAlreadyStarted' }) });
      }
    }
    plan.undoOf = originalId;
    return plan;
  } }, clock);
}
