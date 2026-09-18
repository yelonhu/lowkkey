import type { D1Database } from '@cloudflare/workers-types';
import type { CommandContext, CommandPlan } from './commands.ts';
import { newMetadata, reviseRecord } from './record-store.ts';
import { claims } from './training-store.ts';
import { mealItems, meals } from './nutrition-store.ts';
import { nutrientKeys, summarizeNutrients } from '../domain/nutrition.ts';
import { addDays, localDateSchema } from '../domain/primitives.ts';
import { readGoal } from './goals.ts';
import { DomainError } from './errors.ts';

export async function nutritionDayCounts(db: D1Database, owner: string, localDate: string) {
  const mealCount = (await db.prepare('SELECT COUNT(*) AS n FROM meals WHERE owner_id=? AND local_date=? AND deleted_at IS NULL').bind(owner, localDate).first<number>('n'))!;
  // Even an expired, undiscarded photo remains visible as incomplete content.
  const pendingDraftCount = (await db.prepare("SELECT COUNT(*) AS n FROM import_drafts WHERE owner_id=? AND local_date=? AND deleted_at IS NULL AND status<>'confirmed'").bind(owner, localDate).first<number>('n'))!;
  return { mealCount, pendingDraftCount };
}
export async function invalidateNutrition(context: CommandContext, dates: string[], reason: string): Promise<CommandPlan[]> {
  const plans: CommandPlan[] = [];
  for (const date of new Set(dates)) {
    const previous = (await claims.list(context.db, context.auth.id, 'local_date=?', [date]))[0] ?? null;
    const invalidated = previous?.nutritionCompleteness === 'complete';
    const fields = { nutritionContentRevision: (previous?.nutritionContentRevision ?? 0) + 1, ...(invalidated ? { nutritionCompleteness: 'partial' as const, explicitZeroIntake: false, reviewInvalidatedReason: reason } : {}) };
    const record = previous ? reviseRecord(previous, context, fields) : { ...newMetadata(context, crypto.randomUUID()), localDate: date, entryTimezone: context.auth.timezone, trainingClaim: 'unspecified' as const, nutritionCompleteness: 'unreviewed' as const, nutritionReviewedAt: null, reviewInvalidatedReason: null, explicitZeroIntake: false, ...fields };
    const plan = claims.plan(context, previous, record);
    if (invalidated) plan.entities[0].action = 'invalidated';
    plans.push(plan);
  }
  return plans;
}
export async function nutritionDaySummary(db: D1Database, owner: string, localDate: string) {
  localDateSchema.parse(localDate);
  const rows = await mealItems.list(db, owner, 'meal_id IN (SELECT id FROM meals WHERE owner_id=? AND local_date=? AND deleted_at IS NULL)', [owner, localDate]);
  const notes = (await meals.list(db, owner, 'local_date=?', [localDate])).flatMap(meal => meal.note ? [meal.note.nutrientSnapshot] : []);
  const values = [...rows.map(row => row.snapshot.nutrientSnapshot), ...notes], claim = (await claims.list(db, owner, 'local_date=?', [localDate]))[0] ?? null;
  const counts = await nutritionDayCounts(db, owner, localDate), completeness = claim?.nutritionCompleteness ?? 'unreviewed';
  const totals = summarizeNutrients(values, completeness === 'complete' && claim?.explicitZeroIntake === true && counts.mealCount === 0 && counts.pendingDraftCount === 0);
  const goal = await readGoal(db, owner, localDate);
  const targets = [goal?.energyTargetMkcal ?? null, goal?.proteinTargetMg ?? null, goal?.carbsTargetMg ?? null, goal?.fatTargetMg ?? null];
  const metrics = Object.fromEntries(nutrientKeys.map((key, index) => {
    const known = totals.knownSum[key], target = targets[index];
    return [key, { knownSum: known, unknownItemCount: values.filter(value => value[key] === null).length, estimatePresent: values.some(value => value[key] !== null && value.estimated), dayCompleteness: completeness, target, remaining: target === null || known === null ? null : Math.max(0, target - known), overTarget: target === null || known === null ? null : Math.max(0, known - target) }];
  }));
  return { localDate, nutritionContentRevision: claim?.nutritionContentRevision ?? 0, ...totals, ...counts, completeness, claim, goalVersionId: goal?.id ?? null, metrics };
}
export async function nutritionSummary(db: D1Database, owner: string, from: string, to: string) {
  localDateSchema.parse(from); localDateSchema.parse(to);
  if (from > to || new Date(to).getTime() - new Date(from).getTime() >= 31 * 86400000) throw new DomainError('INVALID_INPUT', 400, { reason: 'dateRange' });
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(await nutritionDaySummary(db, owner, date));
  return { from, to, days };
}
