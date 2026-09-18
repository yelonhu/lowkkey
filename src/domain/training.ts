import { z } from 'zod';
import { decimalSchema, entityMetadataSchema, loadSemanticsSchema, localeSchema, localDateSchema, revisionSchema, rpeSchema, scaledSchema, sourceKindSchema, timezoneSchema, unitSchema, utcSchema, uuidSchema } from './primitives.ts';
import { normalizeMass, compareDecimal } from './numbers.ts';
import { planSnapshotSchema, recoveryNoteSchema } from './snapshots.ts';

export const equipmentSchema = z.enum(['barbell', 'dumbbell', 'cable', 'machine', 'smith', 'bodyweight', 'band', 'kettlebell', 'other', 'unspecified']);
export const muscleSchema = z.enum(['chest', 'lats', 'upper_back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'core', 'spinal_erectors']);
const shortText = z.string().trim().min(1).max(120);
export const variantSchema = z.strictObject({ schemaVersion: z.literal(1), angle: z.enum(['flat', 'incline', 'decline', 'unspecified']), grip: z.enum(['neutral', 'pronated', 'supinated', 'mixed', 'unspecified']), laterality: z.enum(['bilateral', 'unilateral', 'alternating', 'unspecified']), note: z.string().max(500).nullable() });
export const muscleMappingSchema = z.strictObject({ schemaVersion: z.literal(1), primary: z.array(muscleSchema).max(13), secondary: z.array(muscleSchema).max(13) }).refine(value => new Set([...value.primary, ...value.secondary]).size === value.primary.length + value.secondary.length, 'Muscle roles must be distinct');
export const movementPatternSchema = z.enum(['horizontal_pull', 'vertical_pull', 'horizontal_push', 'vertical_push', 'squat', 'hinge', 'lunge', 'carry', 'core', 'isolation', 'other', 'unspecified']);
export const catalogReviewSchema = z.strictObject({ sourceUrls: z.array(z.url().max(1000)).min(1).max(8), sourceNote: z.string().min(1).max(1000), status: z.enum(['pending', 'approved']), reviewedBy: z.string().min(1).max(120).nullable(), reviewedAt: utcSchema.nullable(), record: z.string().min(1).max(500) }).refine(value => value.status === 'approved' ? value.reviewedBy !== null && value.reviewedAt !== null : value.reviewedBy === null && value.reviewedAt === null, 'Review status must have real review evidence');
export const customExerciseInputSchema = z.strictObject({ id: uuidSchema, name: shortText, locale: localeSchema, parentExerciseId: uuidSchema.nullable().default(null), equipmentType: equipmentSchema, variant: variantSchema, muscles: muscleMappingSchema, movementPattern: movementPatternSchema.optional() });
export const exerciseDefinitionSchema = entityMetadataSchema.extend({ ownerId: uuidSchema.nullable(), scope: z.enum(['system', 'personal']), catalogVersion: z.string().min(1).max(80), familyId: z.string().min(1).max(80), parentExerciseId: uuidSchema.nullable(), equipmentType: equipmentSchema, variant: variantSchema, muscles: muscleMappingSchema, movementPattern: movementPatternSchema.default('unspecified'), catalogReview: catalogReviewSchema.nullable().default(null), status: z.enum(['active', 'archived']), personalName: shortText.nullable(), personalLocale: localeSchema.nullable() }).refine(value => value.scope === 'personal' ? value.ownerId !== null && value.personalName !== null && value.personalLocale !== null : value.ownerId === null && value.personalName === null && value.personalLocale === null, 'Catalog ownership must match scope');
export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;
export const personalExerciseSchema = exerciseDefinitionSchema.safeExtend({ ownerId: uuidSchema, scope: z.literal('personal'), personalName: shortText, personalLocale: localeSchema, operationId: uuidSchema, createdOperationId: uuidSchema });
export type PersonalExercise = z.infer<typeof personalExerciseSchema>;

export const availableLoadsSchema = z.strictObject({ schemaVersion: z.literal(1), unit: unitSchema, values: z.array(decimalSchema).min(1).max(100) });
export const setupOriginFieldSchema = z.enum(['loadSemantics', 'loadUnit', 'includesBar', 'barWeightDecimal', 'barUnit', 'equipmentInstance', 'incrementDecimal', 'incrementUnit', 'availableLoads']);
export const setupOriginSchema = z.strictObject({ schemaVersion: z.literal(1), ruleVersion: z.literal('training-defaults-v1'), catalogVersion: z.string().min(1).max(80), defaultedFields: z.array(setupOriginFieldSchema).max(9), overriddenFields: z.array(setupOriginFieldSchema).max(9) }).refine(value => new Set([...value.defaultedFields, ...value.overriddenFields]).size === value.defaultedFields.length + value.overriddenFields.length, 'Default and explicit fields must be distinct');
const setupFields = {
  defaultsOrigin: setupOriginSchema.nullable().optional(),
  exerciseId: uuidSchema, equipmentInstance: z.string().trim().min(1).max(120).nullable().default(null), loadSemantics: loadSemanticsSchema, loadUnit: unitSchema,
  includesBar: z.boolean().nullable().default(null), barWeightDecimal: decimalSchema.nullable().default(null), barUnit: unitSchema.nullable().default(null),
  incrementDecimal: decimalSchema.nullable().default(null), incrementUnit: unitSchema.nullable().default(null), availableLoads: availableLoadsSchema.nullable().default(null),
};
function validateSetup(value: z.infer<z.ZodObject<typeof setupFields>>, ctx: z.RefinementCtx) {
  if ((value.barWeightDecimal === null) !== (value.barUnit === null)) ctx.addIssue({ code: 'custom', message: 'Bar value and unit must be paired' });
  if ((value.incrementDecimal === null) !== (value.incrementUnit === null)) ctx.addIssue({ code: 'custom', message: 'Increment value and unit must be paired' });
  if (value.loadSemantics !== 'external_total' && (value.includesBar !== null || value.barWeightDecimal !== null)) ctx.addIssue({ code: 'custom', message: 'Bar metadata requires total external load' });
  if (value.loadSemantics === 'bodyweight_only' && (value.incrementDecimal !== null || value.availableLoads !== null)) ctx.addIssue({ code: 'custom', message: 'Bodyweight-only has no external increments' });
  try {
    if (value.barWeightDecimal !== null && value.barUnit !== null) normalizeMass(value.barWeightDecimal, value.barUnit);
    if (value.incrementDecimal !== null && value.incrementUnit !== null) { if (compareDecimal(value.incrementDecimal, '0') <= 0) throw new Error(); normalizeMass(value.incrementDecimal, value.incrementUnit); }
    const normalized = value.availableLoads?.values.map(load => normalizeMass(load, value.availableLoads!.unit).kgMicros);
    if (normalized && (!normalized.length || new Set(normalized).size !== normalized.length)) throw new Error();
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid equipment loads' }); }
}
export const setupInputSchema = z.strictObject({ id: uuidSchema, ...setupFields }).superRefine(validateSetup);
export const setupPatchSchema = z.strictObject({ loadUnit: unitSchema.optional(), incrementDecimal: decimalSchema.nullable().optional(), incrementUnit: unitSchema.nullable().optional(), availableLoads: availableLoadsSchema.nullable().optional() }).refine(value => Object.keys(value).length > 0, 'Empty setup edit');
export const exerciseSetupSchema = entityMetadataSchema.extend({ ...setupFields, operationId: uuidSchema, createdOperationId: uuidSchema }).superRefine(validateSetup);
export type ExerciseSetup = z.infer<typeof exerciseSetupSchema>;
export const exerciseAliasInputSchema = z.strictObject({ id: uuidSchema, type: z.literal('exercise'), text: shortText, targetId: uuidSchema, localeHint: localeSchema.nullable().default(null), context: z.strictObject({ schemaVersion: z.literal(1), equipmentInstance: z.string().max(120).nullable() }).nullable().default(null) });
export const exerciseAliasPatchSchema = z.strictObject({ text: shortText.optional(), targetId: uuidSchema.optional() }).refine(value => Object.keys(value).length > 0, 'Empty alias edit');
export const exerciseAliasSchema = entityMetadataSchema.extend({ aliasOriginal: shortText, aliasNormalized: z.string().min(1).max(240), localeHint: localeSchema.nullable(), exerciseId: uuidSchema, context: exerciseAliasInputSchema.shape.context, confirmedAt: utcSchema, operationId: uuidSchema, createdOperationId: uuidSchema });
export type ExerciseAlias = z.infer<typeof exerciseAliasSchema>;
export function normalizeAlias(value: string) { return value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' '); }

const operationFields = { operationId: uuidSchema, createdOperationId: uuidSchema };
export const planVersionSchema = entityMetadataSchema.extend({ title: shortText, effectiveLocalDate: localDateSchema, status: z.enum(['draft', 'published', 'archived']), snapshot: planSnapshotSchema, supersedesId: uuidSchema.nullable(), ...operationFields });
export type PlanVersion = z.infer<typeof planVersionSchema>;
export const planInputSchema = z.strictObject({ id: uuidSchema, title: shortText, snapshot: planSnapshotSchema, effectiveLocalDate: localDateSchema.optional(), basePlan: z.strictObject({ id: uuidSchema, revision: revisionSchema }).nullable(), activate: z.boolean().default(true), confirmToday: z.boolean().default(false), confirmHistorical: z.boolean().default(false) });
export const planSelectionSchema = z.strictObject({ id: uuidSchema, ownerId: uuidSchema, planVersionId: uuidSchema.nullable(), effectiveLocalDate: localDateSchema, dataRevision: revisionSchema, operationId: uuidSchema });
export type PlanSelection = z.infer<typeof planSelectionSchema>;
export const planActivationInputSchema = z.strictObject({ effectiveLocalDate: localDateSchema.optional(), basePlan: z.strictObject({ id: uuidSchema, revision: revisionSchema }).nullable(), confirmToday: z.boolean().default(false), confirmHistorical: z.boolean().default(false) });
export const scheduledSessionSchema = entityMetadataSchema.extend({ localDate: localDateSchema, entryTimezone: timezoneSchema, planVersionId: uuidSchema.nullable(), templateId: uuidSchema.nullable(), plannedStartLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), status: z.enum(['planned', 'skipped', 'moved', 'cancelled']), movedFromId: uuidSchema.nullable(), overrideMode: z.enum(['additional', 'template', 'day']), overrideSnapshot: planSnapshotSchema.nullable(), ...operationFields });
export type ScheduledSession = z.infer<typeof scheduledSessionSchema>;
export const scheduleInputSchema = z.strictObject({ id: uuidSchema, localDate: localDateSchema, entryTimezone: timezoneSchema, planVersionId: uuidSchema.nullable(), templateId: uuidSchema.nullable(), plannedStartLocal: scheduledSessionSchema.shape.plannedStartLocal.default(null), overrideMode: scheduledSessionSchema.shape.overrideMode.default('additional') }).refine(value => (value.planVersionId === null) === (value.templateId === null) && (value.overrideMode !== 'template' || value.planVersionId !== null), 'Schedule source must be paired');
export const schedulePatchSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('move'), id: uuidSchema, localDate: localDateSchema, entryTimezone: timezoneSchema }),
  z.strictObject({ action: z.enum(['skip', 'cancel']) }),
]);

export const sessionStatusSchema = z.enum(['draft', 'in_progress', 'paused', 'completed', 'recorded', 'cancelled', 'deleted']);
export const workoutSessionSchema = entityMetadataSchema.extend({ localDate: localDateSchema, entryTimezone: timezoneSchema, startedAt: utcSchema.nullable(), endedAt: utcSchema.nullable(), timePrecision: z.enum(['instant', 'date']), status: sessionStatusSchema, planVersionId: uuidSchema.nullable(), scheduledSessionId: uuidSchema.nullable(), planSnapshot: planSnapshotSchema.nullable(), title: z.string().max(120).nullable(), note: z.string().max(2000).nullable(), recovery: recoveryNoteSchema.nullable(), sourceRef: uuidSchema.nullable(), sourceKind: sourceKindSchema, ...operationFields }).superRefine((value, ctx) => {
  if (value.status === 'recorded' && value.timePrecision !== 'date') ctx.addIssue({ code: 'custom', message: 'Daily training is date-only' });
  if (value.timePrecision === 'date' && (value.startedAt !== null || value.endedAt !== null)) ctx.addIssue({ code: 'custom', message: 'Date-only training cannot fabricate timestamps' });
  if (value.startedAt && value.endedAt && value.startedAt > value.endedAt) ctx.addIssue({ code: 'custom', message: 'Session ends before it begins' });
  if ((value.status === 'deleted') !== (value.deletedAt !== null)) ctx.addIssue({ code: 'custom', message: 'Deleted session must retain a tombstone' });
});
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;
export const sessionInputSchema = z.strictObject({ id: uuidSchema, localDate: localDateSchema, entryTimezone: timezoneSchema, timePrecision: z.enum(['instant', 'date']).default('instant'), title: z.string().max(120).nullable().default(null), planVersionId: uuidSchema.nullable().default(null), templateId: uuidSchema.nullable().default(null), expectedPlanRevision: revisionSchema.optional(), scheduledSessionId: uuidSchema.nullable().default(null), expectedScheduleRevision: revisionSchema.optional(), copySessionId: uuidSchema.nullable().default(null), expectedCopyRevision: revisionSchema.optional(), status: z.enum(['draft', 'in_progress']).default('in_progress') }).superRefine((value, ctx) => {
  if ((value.planVersionId === null) !== (value.templateId === null)) ctx.addIssue({ code: 'custom', message: 'Plan and template must be paired' });
  if (value.planVersionId && value.expectedPlanRevision === undefined) ctx.addIssue({ code: 'custom', message: 'Plan version required' });
  if (value.scheduledSessionId && value.expectedScheduleRevision === undefined) ctx.addIssue({ code: 'custom', message: 'Schedule version required' });
  if (value.copySessionId && (value.expectedCopyRevision === undefined || value.planVersionId || value.scheduledSessionId)) ctx.addIssue({ code: 'custom', message: 'Copy requires one explicit source' });
});
export const sessionPatchSchema = z.strictObject({ localDate: localDateSchema.optional(), entryTimezone: timezoneSchema.optional(), title: z.string().max(120).nullable().optional(), note: z.string().max(2000).nullable().optional(), recovery: recoveryNoteSchema.nullable().optional() }).refine(value => Object.keys(value).length > 0, 'Empty session edit');
export const targetSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), plannedSets: z.number().int().min(1).max(30).nullable(), repMin: z.number().int().min(1).max(200).nullable(), repMax: z.number().int().min(1).max(200).nullable(), targetRpe: rpeSchema.nullable(), note: z.string().max(500).nullable() }).refine(value => value.repMin === null || value.repMax === null || value.repMin <= value.repMax, 'Invalid rep interval');
export const exerciseDisplaySnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), defaultsOrigin: setupOriginSchema.nullable().optional(), exerciseId: uuidSchema, catalogVersion: z.string(), name: shortText, locale: localeSchema, equipmentType: equipmentSchema, equipmentInstance: z.string().max(120).nullable(), variant: variantSchema, muscles: muscleMappingSchema, movementPattern: movementPatternSchema.default('unspecified'), loadSemantics: loadSemanticsSchema, includesBar: z.boolean().nullable(), barWeightDecimal: decimalSchema.nullable(), barUnit: unitSchema.nullable() });
export const sessionExerciseSchema = entityMetadataSchema.extend({ sessionId: uuidSchema, setupId: uuidSchema, ordinal: revisionSchema, displaySnapshot: exerciseDisplaySnapshotSchema, targetSnapshot: targetSnapshotSchema.nullable(), ...operationFields });
export type SessionExercise = z.infer<typeof sessionExerciseSchema>;
export const sessionExerciseInputSchema = z.strictObject({ id: uuidSchema, setupId: uuidSchema, ordinal: revisionSchema, target: targetSnapshotSchema.nullable().default(null) });
export const sessionExercisePatchSchema = z.strictObject({ expectedRevision: revisionSchema, ordinal: revisionSchema.optional(), target: targetSnapshotSchema.nullable().optional() }).refine(value => value.ordinal !== undefined || value.target !== undefined, 'Empty exercise edit');
export const setTypeSchema = z.enum(['warmup', 'work', 'backoff', 'drop', 'unknown']);
export const workoutSetSchema = entityMetadataSchema.extend({ sessionExerciseId: uuidSchema, ordinal: revisionSchema, reps: z.number().int().min(1).max(200), loadDecimal: decimalSchema.nullable(), unit: unitSchema.nullable(), kgMicros: scaledSchema.nullable(), loadSemantics: loadSemanticsSchema, setType: setTypeSchema, rpeHalfUnits: z.number().int().min(2).max(20).nullable(), completedAt: utcSchema.nullable(), note: z.string().max(500).nullable(), sourceRowId: uuidSchema.nullable(), ...operationFields }).superRefine((value, ctx) => {
  if (value.loadSemantics === 'bodyweight_only') {
    if (value.loadDecimal !== null || value.unit !== null || value.kgMicros !== null) ctx.addIssue({ code: 'custom', message: 'Bodyweight-only has no external load' });
  } else {
    try { if (value.loadDecimal === null || value.unit === null || normalizeMass(value.loadDecimal, value.unit).kgMicros !== value.kgMicros) throw new Error(); }
    catch { ctx.addIssue({ code: 'custom', message: 'Load must retain its original unit and normalization' }); }
  }
});
export type WorkoutSet = z.infer<typeof workoutSetSchema>;
const inputLoad = z.strictObject({ value: decimalSchema, unit: unitSchema, semantics: loadSemanticsSchema.exclude(['bodyweight_only']) }).nullable();
export const trainingSetInputSchema = z.strictObject({ id: uuidSchema, sessionExerciseId: uuidSchema, ordinal: revisionSchema, reps: z.number().int().min(1).max(200), load: inputLoad, setType: setTypeSchema.default('unknown'), rpe: rpeSchema.nullable().default(null), completedAt: utcSchema.nullable().optional(), note: z.string().max(500).nullable().default(null) });
export const trainingSetPatchSchema = z.strictObject({ expectedRevision: revisionSchema, ordinal: revisionSchema.optional(), reps: z.number().int().min(1).max(200).optional(), load: inputLoad.optional(), setType: setTypeSchema.optional(), rpe: rpeSchema.nullable().optional(), completedAt: utcSchema.nullable().optional(), note: z.string().max(500).nullable().optional() }).refine(value => Object.keys(value).some(key => key !== 'expectedRevision'), 'Empty set edit');
export const dayClaimSchema = entityMetadataSchema.extend({ localDate: localDateSchema, entryTimezone: timezoneSchema, trainingClaim: z.enum(['unspecified', 'rest_confirmed']), nutritionCompleteness: z.enum(['unreviewed', 'partial', 'complete']), nutritionReviewedAt: utcSchema.nullable(), reviewInvalidatedReason: z.string().max(80).nullable(), explicitZeroIntake: z.boolean(), ...operationFields });
export type DayClaim = z.infer<typeof dayClaimSchema>;
