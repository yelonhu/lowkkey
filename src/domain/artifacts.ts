import { z } from 'zod';
import { localDateSchema, revisionSchema, scaledSchema, utcSchema, uuidSchema } from './primitives.ts';
import { nutrientSnapshotSchema } from './snapshots.ts';

export const entityTypes = ['workout_session', 'workout_set', 'weight_entry', 'meal', 'goal_version', 'plan_version', 'day_claim', 'user_insight', 'scheduled_session', 'session_exercise', 'exercise_setup', 'import_draft', 'recommendation', 'change_proposal', 'user_profile', 'daily_report', 'meal_item', 'favorite', 'personal_recipe', 'portion_definition', 'exercise_alias', 'food_alias', 'exercise_definition', 'food_definition'] as const;
export const entityRefSchema = z.strictObject({ type: z.enum(entityTypes), id: uuidSchema, revision: revisionSchema });
export type EntityRef = z.infer<typeof entityRefSchema>;
export const evidenceRefSchema = z.union([entityRefSchema, z.strictObject({ type: z.enum(['source_text', 'assistant_message', 'report_snapshot']), id: uuidSchema, revision: revisionSchema })]);
export const artifactKinds = ['SessionArtifact', 'WeightArtifact', 'DietArtifact'] as const;
const meta = {
  schemaVersion: z.literal(1), dataRevision: scaledSchema, projectedAt: utcSchema, localDate: localDateSchema,
  entityRefs: z.array(entityRefSchema).max(100), quality: z.enum(['empty', 'partial', 'sufficient']),
  pendingDraftIds: z.array(uuidSchema).max(100), insightRefs: z.array(entityRefSchema.extend({ type: z.literal('user_insight') })).max(100), recommendationIds: z.array(uuidSchema).max(100),
};
export const artifactViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...meta, kind: z.literal('SessionArtifact'), props: z.strictObject({
    activeSessionId: uuidSchema.nullable(), selectedSessionId: uuidSchema.nullable(), plannedSessionIds: z.array(uuidSchema).max(100),
    completedWorkingSets: scaledSchema, unknownTypeSets: scaledSchema,
    muscleVolume: z.array(z.strictObject({ muscleId: z.string().min(1).max(80), directSets: scaledSchema, secondarySets: scaledSchema })).max(100),
  }) }),
  z.strictObject({ ...meta, kind: z.literal('WeightArtifact'), props: z.strictObject({
    primaryEntryId: uuidSchema.nullable(), primaryKgMicros: scaledSchema.nullable(),
    trend: z.array(z.strictObject({ localDate: localDateSchema, meanKgMicros: scaledSchema.nullable(), sampleDays: z.number().int().min(0).max(7) })).max(90),
    algorithmVersion: z.string().min(1).max(80), goalVersionId: uuidSchema.nullable(),
  }).refine(value => (value.primaryEntryId === null) === (value.primaryKgMicros === null), 'Primary entry and value must agree') }),
  z.strictObject({ ...meta, kind: z.literal('DietArtifact'), props: z.strictObject({
    mealIds: z.array(uuidSchema).max(100), knownSum: nutrientSnapshotSchema.refine(value => value.provenance === 'calculated', 'Totals are calculated'),
    unknownCounts: z.strictObject({ energy: scaledSchema, protein: scaledSchema, carbs: scaledSchema, fat: scaledSchema }),
    completeness: z.enum(['unreviewed', 'partial', 'complete']), goalVersionId: uuidSchema.nullable(),
  }) }),
]);
export type ArtifactView = z.infer<typeof artifactViewSchema>;
export const interactionContextSchema = z.strictObject({
  schemaVersion: z.literal(1), workspaceView: z.enum(['overview', 'session', 'weight', 'diet', 'report', 'settings']),
  artifactKind: z.enum(artifactKinds).nullable(), localDate: localDateSchema.nullable(), entityRef: entityRefSchema.nullable(), threadId: uuidSchema.nullable(),
  observedDataRevision: scaledSchema, capturedAt: utcSchema, hasPendingLocalChanges: z.boolean(),
});
export const dateRangeSchema = z.strictObject({ from: localDateSchema, to: localDateSchema }).refine(value => value.from <= value.to, 'Reversed range');
export const artifactQuerySchema = z.strictObject({ localDate: localDateSchema.optional(), kind: z.enum(artifactKinds).optional(), sessionId: uuidSchema.optional(), range: dateRangeSchema.optional() }).superRefine((value, ctx) => {
  if (value.sessionId && value.kind && value.kind !== 'SessionArtifact') ctx.addIssue({ code: 'custom', message: 'Session selection requires the training view' });
  if (value.range && value.kind === 'DietArtifact') ctx.addIssue({ code: 'custom', message: 'Diet uses the selected local date' });
});
