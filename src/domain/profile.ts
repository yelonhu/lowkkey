import { z } from 'zod';
import { decimalSchema, entityMetadataSchema, localeSchema, localDateSchema, revisionSchema, scaledSchema, timezoneSchema, unitSchema, utcSchema, uuidSchema } from './primitives.ts';
import { normalizeMass, scaledDecimal } from './numbers.ts';

export const goalTypeSchema = z.enum(['lean_bulk', 'fat_loss', 'maintenance']);
export const displayNameSchema = z.string().refine(value => value.trim().length > 0 && [...value].length <= 40, 'Name must have 1–40 characters');
export const activationSchema = z.strictObject({ displayName: displayNameSchema, goalType: goalTypeSchema, locale: localeSchema, timezone: timezoneSchema });
export const profileInputSchema = z.strictObject({
  displayName: displayNameSchema.optional(), locale: localeSchema.optional(), timezone: timezoneSchema.optional(),
  bodyWeightUnit: unitSchema.optional(), defaultLoadUnit: unitSchema.optional(), trainingExperience: z.enum(['beginner', 'intermediate', 'experienced', 'unknown']).optional(),
  heightCm: z.number().min(50).max(250).nullable().optional(), constraintsText: z.string().max(2000).nullable().optional(), digestEnabled: z.boolean().optional(), autoMemoryEnabled: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0, 'Empty profile edit');
export const profileSnapshotSchema = entityMetadataSchema.extend({
  displayName: displayNameSchema, locale: localeSchema, timezone: timezoneSchema, bodyWeightUnit: unitSchema, defaultLoadUnit: unitSchema,
  trainingExperience: z.enum(['beginner', 'intermediate', 'experienced', 'unknown']), heightCm: z.number().min(50).max(250).nullable(), constraintsText: z.string().max(2000).nullable(),
  digestEnabled: z.boolean(), autoMemoryEnabled: z.boolean(), nextDigestAt: utcSchema, pendingTimezone: timezoneSchema.nullable(), timezoneEffectiveDate: localDateSchema.nullable(),
}).refine(value => (value.pendingTimezone === null) === (value.timezoneEffectiveDate === null), 'Timezone change requires an effective date');
export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>;
export const goalAmountsSchema = z.strictObject({
  energyKcal: decimalSchema.nullable().default(null), proteinG: decimalSchema.nullable().default(null), carbsG: decimalSchema.nullable().default(null), fatG: decimalSchema.nullable().default(null),
  weightMin: decimalSchema.nullable().default(null), weightMax: decimalSchema.nullable().default(null), weightUnit: unitSchema.default('kg'),
  weeklyChangeMinPct: z.number().finite().nullable().default(null), weeklyChangeMaxPct: z.number().finite().nullable().default(null),
}).superRefine((value, ctx) => {
  try {
    if (value.energyKcal !== null && scaledDecimal(value.energyKcal, 1000n) <= 0) throw new Error('Energy must be positive');
    for (const key of ['proteinG', 'carbsG', 'fatG'] as const) if (value[key] !== null) scaledDecimal(value[key], 1000n);
    const min = value.weightMin === null ? null : normalizeMass(value.weightMin, value.weightUnit, 1, 500).kgMicros;
    const max = value.weightMax === null ? null : normalizeMass(value.weightMax, value.weightUnit, 1, 500).kgMicros;
    if (min !== null && max !== null && min > max) throw new Error('Reversed weight interval');
    if (value.weeklyChangeMinPct !== null && value.weeklyChangeMaxPct !== null && value.weeklyChangeMinPct > value.weeklyChangeMaxPct) throw new Error('Reversed change interval');
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid target amount or interval' }); }
});
export const goalInputSchema = z.strictObject({
  id: uuidSchema, goalType: goalTypeSchema, amounts: goalAmountsSchema,
  effectiveLocalDate: localDateSchema.optional(), baseGoal: z.strictObject({ id: uuidSchema, revision: revisionSchema }).nullable(),
  confirmToday: z.boolean().default(false), confirmHistorical: z.boolean().default(false), confirmLargeEnergy: z.boolean().default(false),
});
export function goalTargets(amounts: z.infer<typeof goalAmountsSchema>) {
  const scaled = (value: string | null) => value === null ? null : scaledDecimal(value, 1000n);
  const mass = (value: string | null) => value === null ? null : normalizeMass(value, amounts.weightUnit, 1, 500).kgMicros;
  return { energyTargetMkcal: scaled(amounts.energyKcal), proteinTargetMg: scaled(amounts.proteinG), carbsTargetMg: scaled(amounts.carbsG), fatTargetMg: scaled(amounts.fatG),
    weightMinKgMicros: mass(amounts.weightMin), weightMaxKgMicros: mass(amounts.weightMax), weeklyChangeMinPct: amounts.weeklyChangeMinPct, weeklyChangeMaxPct: amounts.weeklyChangeMaxPct };
}
export const goalSnapshotSchema = entityMetadataSchema.extend({
  goalType: goalTypeSchema, effectiveLocalDate: localDateSchema, energyTargetMkcal: revisionSchema.nullable(), proteinTargetMg: scaledSchema.nullable(), carbsTargetMg: scaledSchema.nullable(), fatTargetMg: scaledSchema.nullable(),
  weightMinKgMicros: scaledSchema.nullable(), weightMaxKgMicros: scaledSchema.nullable(), weeklyChangeMinPct: z.number().finite().nullable(), weeklyChangeMaxPct: z.number().finite().nullable(),
  supersedesId: uuidSchema.nullable(), rawInput: goalAmountsSchema, createdDataRevision: revisionSchema, operationId: uuidSchema,
}).refine(value => value.revision === 1 && value.createdAt === value.updatedAt && Object.entries(goalTargets(value.rawInput)).every(([key, target]) => value[key as keyof typeof value] === target), 'Goal snapshot must retain its immutable, normalized input');
export type GoalSnapshot = z.infer<typeof goalSnapshotSchema>;
export const invitationInputSchema = z.strictObject({ email: z.string().trim().pipe(z.email()).transform(value => value.toLowerCase()), renew: z.boolean().default(false) });
export const memberChangeSchema = z.strictObject({ status: z.enum(['active', 'suspended']).optional(), role: z.enum(['member', 'admin']).optional(), confirmRoleChange: z.boolean().default(false) }).refine(value => value.status !== undefined || value.role !== undefined, 'Empty membership edit');
