import { z } from 'zod';
import { weightEntitySchema, weightInputSchema } from './contracts.ts';
import { addDays, localDateAt, localDateSchema, revisionSchema, sourceKindSchema, uuidSchema, validateActualDate } from './primitives.ts';
import { normalizeMass } from './numbers.ts';

const confirmation = {
  primaryChoice: z.enum(['extra', 'replace']).optional(),
  expectedPrimary: z.strictObject({ id: uuidSchema, revision: revisionSchema }).optional(),
  confirmedOutlier: z.boolean().default(false),
  outlierReference: z.strictObject({ id: uuidSchema, revision: revisionSchema }).optional(),
};
export const createWeightSchema = weightInputSchema.safeExtend(confirmation);
export const patchWeightSchema = z.strictObject({
  localDate: weightInputSchema.shape.localDate.optional(), entryTimezone: weightInputSchema.shape.entryTimezone.optional(),
  occurredAt: weightInputSchema.shape.occurredAt.optional(), timePrecision: weightInputSchema.shape.timePrecision.optional(),
  value: weightInputSchema.shape.value.optional(), unit: weightInputSchema.shape.unit.optional(), condition: weightInputSchema.shape.condition.optional(), ...confirmation,
}).refine(value => Object.keys(value).some(key => key !== 'confirmedOutlier'), 'Empty edit');
export const storedWeightSchema = weightEntitySchema.extend({ sourceKind: sourceKindSchema, sourceRef: uuidSchema.nullable(), operationId: uuidSchema, createdOperationId: uuidSchema }).superRefine((value, ctx) => {
  const input = Object.fromEntries(Object.keys(weightInputSchema.shape).map(key => [key, value[key as keyof typeof value]]));
  if (!weightInputSchema.safeParse(input).success || normalizeMass(value.value, value.unit, 1, 500).kgMicros !== value.kgMicros) ctx.addIssue({ code: 'custom', message: 'Invalid persisted weight' });
});
export type Weight = z.infer<typeof storedWeightSchema>;
export type WeightConfirmation = z.infer<typeof createWeightSchema>;
export function validateWeightDate(input: z.infer<typeof weightInputSchema>, timezone: string, now: Date) {
  validateActualDate(input, timezone, now);
  if (input.occurredAt && localDateAt(new Date(input.occurredAt), input.entryTimezone) !== input.localDate) throw new Error('OCCURRENCE_DATE_MISMATCH');
}
export { addDays } from './primitives.ts';
function mean(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  return Number((2n * sum + BigInt(values.length)) / (2n * BigInt(values.length)));
}
export function weightTrend(entries: readonly Pick<Weight, 'localDate' | 'kgMicros' | 'isPrimary' | 'deletedAt'>[], from: string, to: string) {
  localDateSchema.parse(from); localDateSchema.parse(to);
  if (from > to || new Date(to).getTime() - new Date(from).getTime() > 89 * 86400000) throw new Error('INVALID_TREND_RANGE');
  const primaries = entries.filter(entry => entry.isPrimary && entry.deletedAt === null);
  if (new Set(primaries.map(entry => entry.localDate)).size !== primaries.length) throw new Error('DUPLICATE_PRIMARY_DATE');
  const trend = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const values = primaries.filter(entry => entry.localDate >= addDays(date, -6) && entry.localDate <= date).map(entry => entry.kgMicros);
    trend.push({ localDate: date, meanKgMicros: values.length >= 3 ? mean(values) : null, sampleDays: values.length });
  }
  const current = primaries.filter(entry => entry.localDate >= addDays(to, -6) && entry.localDate <= to).map(entry => entry.kgMicros);
  const previous = primaries.filter(entry => entry.localDate >= addDays(to, -13) && entry.localDate <= addDays(to, -7)).map(entry => entry.kgMicros);
  const a = mean(current), b = mean(previous);
  return { algorithmVersion: 'weight-trailing-7d-v1', trend, weeklyChangeKgMicros: current.length >= 4 && previous.length >= 4 && a !== null && b !== null ? a - b : null,
    weeklyChangePct: current.length >= 4 && previous.length >= 4 && a !== null && b !== null ? (a - b) / b * 100 : null,
    currentSampleDays: current.length, previousSampleDays: previous.length };
}
