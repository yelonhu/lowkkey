import type { D1Database } from '@cloudflare/workers-types';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan } from './commands.ts';
import { DomainError } from './errors.ts';
import { expectRevision, mergePlans, reviseRecord } from './record-store.ts';
import type { OwnedRecord, RecordStore } from './record-store.ts';
import { mealDrafts, mealItems, meals } from './nutrition-store.ts';
import { invalidateNutrition } from './nutrition-days.ts';
import { stageMealOrdinals, validateMealDate } from './meals.ts';

type RevisionRow = { target_type: string; target_id: string; before_snapshot: string | null; after_revision: number };
async function reverse<T extends OwnedRecord>(context: CommandContext, store: RecordStore<T>, row: RevisionRow) {
  const current = await store.read(context.db, context.auth.id, row.target_id, true); expectRevision(current, row.after_revision);
  const before = row.before_snapshot === null ? null : store.schema.parse(JSON.parse(row.before_snapshot));
  return store.plan(context, current, reviseRecord(current, context, (before ?? { deletedAt: context.now }) as Partial<T>));
}
export function undoNutrition(db: D1Database, auth: AuthContext, operationId: string, originalId: string, clock?: () => Date) {
  return executeCommand(db, auth, { operationId, kind: 'nutrition.undo', payload: { originalId }, entryPoint: 'manual', plan: async context => {
    const operation = await db.prepare('SELECT kind,undo_until,undone_by FROM command_operations WHERE owner_id=? AND operation_id=?').bind(auth.id, originalId).first<{ kind: string; undo_until: string | null; undone_by: string | null }>();
    if (!operation) throw new DomainError('RECORD_NOT_FOUND', 404);
    if (!operation.kind.startsWith('nutrition.') || operation.kind === 'nutrition.undo' || !operation.undo_until || operation.undo_until < context.now || operation.undone_by) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'undoUnavailable' });
    const rows = await db.prepare("SELECT target_type,target_id,before_snapshot,after_revision FROM operation_revisions WHERE owner_id=? AND operation_id=? ORDER BY CASE WHEN target_type='meal' THEN 0 ELSE 1 END,id").bind(auth.id, originalId).all<RevisionRow>();
    const plans: CommandPlan[] = [], dates: string[] = [];
    for (const row of rows.results) {
      let plan: CommandPlan;
      if (row.target_type === 'meal') plan = await reverse(context, meals, row);
      else if (row.target_type === 'meal_item') plan = await reverse(context, mealItems, row);
      else if (row.target_type === 'import_draft') plan = await reverse(context, mealDrafts, row);
      // Undo is itself a content change. It cannot restore an old completeness declaration.
      else if (row.target_type === 'day_claim') continue;
      else throw new DomainError('REVISION_CONFLICT', 409, { reason: 'undoUnavailable' });
      const entity = plan.entities[0];
      if (entity.type === 'meal' || entity.type === 'import_draft') {
        dates.push(String(entity.before!.localDate), String(entity.after.localDate));
        if (entity.type === 'meal' && entity.after.deletedAt === null) validateMealDate(context, meals.schema.parse(entity.after));
      }
      plans.push(plan);
    }
    const plan = mergePlans([...plans, ...await invalidateNutrition(context, dates, 'nutritionUndo')], { originalOperationId: originalId }, false);
    plan.statements.unshift(...stageMealOrdinals(context, plans)); plan.undoOf = originalId; return plan;
  } }, clock);
}
