import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { localDateSchema, timezoneSchema, uuidSchema, validateActualDate } from '../domain/primitives.ts';
import type { DayClaim } from '../domain/training.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import { DomainError } from './errors.ts';
import { expectRevision, newMetadata, reviseRecord } from './record-store.ts';
import { claims } from './training-store.ts';
import { nutritionDayCounts } from './nutrition-days.ts';

export const trainingClaimInputSchema = z.strictObject({ id: uuidSchema, entryTimezone: timezoneSchema, trainingClaim: z.enum(['unspecified', 'rest_confirmed']) });
export const dayClaimInputSchema = z.strictObject({ id: uuidSchema, entryTimezone: timezoneSchema, trainingClaim: z.enum(['unspecified', 'rest_confirmed']).optional(), nutritionCompleteness: z.enum(['unreviewed', 'partial', 'complete']).optional(), explicitZeroIntake: z.boolean().optional() }).refine(value => value.trainingClaim !== undefined || value.nutritionCompleteness !== undefined, 'A day claim is required').refine(value => value.explicitZeroIntake === undefined || value.nutritionCompleteness !== undefined, 'Zero intake must accompany a nutrition claim');
export async function actualDaySets(db: D1Database, owner: string, localDate: string) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM workout_sets s JOIN session_exercises e ON e.owner_id=s.owner_id AND e.id=s.session_exercise_id JOIN workout_sessions w ON w.owner_id=e.owner_id AND w.id=e.session_id WHERE w.owner_id=? AND w.local_date=? AND w.status IN ('in_progress','paused','completed') AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL").bind(owner, localDate).first<number>('n'))!;
}
export async function readDay(db: D1Database, owner: string, localDate: string) {
  localDateSchema.parse(localDate);
  return { localDate, claim: (await claims.list(db, owner, 'local_date=?', [localDate]))[0] ?? null, actualSetCount: await actualDaySets(db, owner, localDate), ...await nutritionDayCounts(db, owner, localDate) };
}
export function patchTrainingClaim(db: D1Database, auth: AuthContext, operationId: string, localDate: string, revision: number | undefined, payload: unknown, clock?: () => Date) {
  return patchDayClaim(db, auth, operationId, localDate, revision, trainingClaimInputSchema.parse(payload), clock);
}
export function patchDayClaim(db: D1Database, auth: AuthContext, operationId: string, localDate: string, revision: number | undefined, payload: unknown, clock?: () => Date) {
  const input = dayClaimInputSchema.parse(payload); localDateSchema.parse(localDate);
  return executeCommand(db, auth, { operationId, kind: input.nutritionCompleteness === undefined ? 'day.training' : 'day.claim', payload: { localDate, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    try { validateActualDate({ localDate, occurredAt: null }, context.auth.timezone, new Date(context.now)); } catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'actualDate' }); }
    const previous = (await claims.list(db, auth.id, 'local_date=?', [localDate]))[0] ?? null;
    if (previous) { if (revision === undefined || previous.id !== input.id) throw new DomainError('REVISION_CONFLICT', 409); expectRevision(previous, revision); }
    else if (revision !== undefined) throw new DomainError('REVISION_CONFLICT', 409);
    if (input.trainingClaim === 'rest_confirmed' && await actualDaySets(db, auth.id, localDate)) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'actualTrainingExists' });
    if (previous && previous.entryTimezone !== input.entryTimezone) throw new DomainError('INVALID_INPUT', 400, { reason: 'historicalTimezone' });
    const fields: Partial<DayClaim> = {};
    if (input.trainingClaim !== undefined) fields.trainingClaim = input.trainingClaim;
    if (input.nutritionCompleteness !== undefined) {
      const counts = await nutritionDayCounts(db, auth.id, localDate);
      if (input.nutritionCompleteness === 'complete') {
        if (counts.pendingDraftCount > 0) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'pendingMeals', pendingDraftCount: counts.pendingDraftCount });
        if (counts.mealCount === 0 && input.explicitZeroIntake !== true) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'confirmZeroIntake' });
      }
      if (input.explicitZeroIntake === true && (counts.mealCount > 0 || counts.pendingDraftCount > 0 || input.nutritionCompleteness !== 'complete')) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'intakeExists' });
      Object.assign(fields, { nutritionCompleteness: input.nutritionCompleteness, nutritionReviewedAt: input.nutritionCompleteness === 'complete' ? context.now : previous?.nutritionReviewedAt ?? null, reviewInvalidatedReason: null, explicitZeroIntake: input.nutritionCompleteness === 'complete' && input.explicitZeroIntake === true });
    }
    const record = previous ? reviseRecord(previous, context, fields) : { ...newMetadata(context, input.id), localDate, entryTimezone: input.entryTimezone, trainingClaim: 'unspecified' as const, nutritionCompleteness: 'unreviewed' as const, nutritionReviewedAt: null, reviewInvalidatedReason: null, explicitZeroIntake: false, ...fields };
    const plan = claims.plan(context, previous, record); plan.undoable = false; return plan;
  } }, clock);
}
