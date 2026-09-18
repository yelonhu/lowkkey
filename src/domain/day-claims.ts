import { z } from 'zod';
import { scaledSchema, timezoneSchema, uuidSchema } from './primitives.ts';

export const trainingClaimInputSchema = z.strictObject({ id: uuidSchema, entryTimezone: timezoneSchema, trainingClaim: z.enum(['unspecified', 'rest_confirmed']) });
export const dayClaimInputSchema = z.strictObject({
  id: uuidSchema, entryTimezone: timezoneSchema,
  trainingClaim: z.enum(['unspecified', 'rest_confirmed']).optional(),
  nutritionCompleteness: z.enum(['unreviewed', 'partial', 'complete']).optional(),
  explicitZeroIntake: z.boolean().optional(),
  expectedNutritionContentRevision: scaledSchema.optional(),
}).refine(value => value.trainingClaim !== undefined || value.nutritionCompleteness !== undefined, 'A day claim is required')
  .refine(value => value.explicitZeroIntake === undefined || value.nutritionCompleteness !== undefined, 'Zero intake must accompany a nutrition claim')
  .refine(value => value.nutritionCompleteness !== 'complete' || value.expectedNutritionContentRevision !== undefined, 'Review must bind the observed nutrition content');
