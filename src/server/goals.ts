import type { D1Database } from '@cloudflare/workers-types';
import type { z } from 'zod';
import { goalInputSchema, goalSnapshotSchema, goalTargets } from '../domain/profile.ts';
import type { GoalSnapshot, goalAmountsSchema } from '../domain/profile.ts';
import { addDays, localDateAt, localDateSchema } from '../domain/primitives.ts';
import { compareDecimal } from '../domain/numbers.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan } from './commands.ts';
import { DomainError } from './errors.ts';

const columns = {
  id: 'id', ownerId: 'owner_id', revision: 'revision', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at',
  goalType: 'goal_type', effectiveLocalDate: 'effective_local_date', energyTargetMkcal: 'energy_target_mkcal', proteinTargetMg: 'protein_target_mg', carbsTargetMg: 'carbs_target_mg', fatTargetMg: 'fat_target_mg',
  weightMinKgMicros: 'weight_min_kg_micros', weightMaxKgMicros: 'weight_max_kg_micros', weeklyChangeMinPct: 'weekly_change_min_pct', weeklyChangeMaxPct: 'weekly_change_max_pct', supersedesId: 'supersedes_id',
  rawInput: 'raw_input_json', createdDataRevision: 'created_data_revision', operationId: 'operation_id',
} as const;
export const goalSelect = `SELECT ${Object.entries(columns).map(([key, column]) => `${column} AS ${key}`).join(',')} FROM goal_versions`;
export function decodeGoal(row: Record<string, unknown>) { return goalSnapshotSchema.parse({ ...row, rawInput: JSON.parse(String(row.rawInput)) }); }
export async function readGoal(db: D1Database, ownerId: string, date: string): Promise<GoalSnapshot | null> {
  localDateSchema.parse(date);
  const row = await db.prepare(`${goalSelect} WHERE owner_id=? AND effective_local_date<=? AND deleted_at IS NULL ORDER BY effective_local_date DESC,created_data_revision DESC LIMIT 1`).bind(ownerId, date).first<Record<string, unknown>>();
  if (!row) return null;
  return decodeGoal(row);
}
export function newGoal(context: CommandContext, id: string, goalType: GoalSnapshot['goalType'], date: string, amounts: z.infer<typeof goalAmountsSchema>, base: GoalSnapshot | null): GoalSnapshot {
  return goalSnapshotSchema.parse({ id, ownerId: context.auth.id, revision: 1, createdAt: context.now, updatedAt: context.now, deletedAt: null, goalType, effectiveLocalDate: date,
    ...goalTargets(amounts), supersedesId: base?.id ?? null, rawInput: amounts, createdDataRevision: context.dataRevision, operationId: context.operationId });
}
export function goalPlan(context: CommandContext, after: GoalSnapshot): CommandPlan {
  goalSnapshotSchema.parse(after);
  const keys = Object.keys(columns) as Array<keyof typeof columns>;
  const fields = keys.filter(key => !['id', 'ownerId', 'revision', 'createdAt', 'updatedAt', 'rawInput', 'createdDataRevision', 'operationId'].includes(key));
  return {
    guards: [{ predicate: 'NOT EXISTS(SELECT 1 FROM goal_versions WHERE id=?)', values: [after.id], error: new DomainError('DUPLICATE_CANDIDATE', 409) }],
    statements: [context.db.prepare(`INSERT INTO goal_versions(${keys.map(key => columns[key]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(key => key === 'rawInput' ? JSON.stringify(after[key]) : after[key]))],
    entities: [{ type: 'goal_version', before: null, after, action: 'created', changes: fields.filter(key => after[key] !== null).map(key => ({ field: columns[key], before: null, after: after[key] as string | number | null })) }],
    result: { goal: after }, undoable: false,
  };
}
export async function createGoal(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = goalInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'goal.create', payload: input, entryPoint: 'goals.create', plan: async context => {
    const today = localDateAt(new Date(context.now), context.auth.timezone);
    const date = input.effectiveLocalDate ?? addDays(today, 1);
    if (date === today && !input.confirmToday) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'goalToday' });
    if (date < today && !input.confirmHistorical) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'goalHistorical' });
    const base = await readGoal(db, auth.id, date);
    if ((base?.id ?? null) !== (input.baseGoal?.id ?? null) || (base && base.revision !== input.baseGoal?.revision)) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'goalChanged', currentGoalId: base?.id ?? null });
    const next = newGoal(context, input.id, input.goalType, date, input.amounts, base);
    if (input.amounts.energyKcal !== null && compareDecimal(input.amounts.energyKcal, '8000') > 0 && !input.confirmLargeEnergy) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'largeEnergyTarget' });
    return goalPlan(context, next);
  } }, clock);
}
