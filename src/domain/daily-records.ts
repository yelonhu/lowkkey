import { z } from 'zod';
import { localDateSchema, revisionSchema, timezoneSchema, uuidSchema } from './primitives.ts';
import { sessionExerciseInputSchema, trainingSetInputSchema } from './training.ts';
import { createWeightSchema, patchWeightSchema } from './weight.ts';
export const dailySetInputSchema = trainingSetInputSchema.extend({
  localDate: localDateSchema, entryTimezone: timezoneSchema, createSession: z.boolean(),
  exercise: sessionExerciseInputSchema, completedAt: z.null().default(null),
}).refine(value => value.exercise.id === value.sessionExerciseId, 'Exercise identity mismatch');
export const dailySetRequestSchema = dailySetInputSchema.safeExtend({
  sessionId: uuidSchema, expectedSessionRevision: revisionSchema.nullable(),
}).refine(value => value.createSession === (value.expectedSessionRevision === null), 'Root version mismatch');
export const dailyWeightCreateSchema = z.strictObject({ ...z.strictObject(createWeightSchema.shape).omit({ primaryChoice: true, expectedPrimary: true }).shape,
  occurredAt: z.null().default(null), timePrecision: z.literal('date').default('date'),
});
export const dailyWeightEditSchema = z.strictObject(patchWeightSchema.shape).pick({
  value: true, unit: true, condition: true, confirmedOutlier: true, outlierReference: true,
}).refine(value => value.value !== undefined || value.unit !== undefined || value.condition !== undefined, 'Empty edit');
