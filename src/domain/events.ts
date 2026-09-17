import { z } from 'zod';
import { entityRefSchema } from './artifacts.ts';
import type { EntityRef } from './artifacts.ts';
import { revisionSchema, utcSchema, uuidSchema } from './primitives.ts';

// Complex snapshots are retrieved by entity/version. Events contain only these
// explicitly named primitive fields, never JSON paths or arbitrary object trees.
export const eventFields = {
  workout_session: ['local_date', 'status', 'title', 'note', 'started_at', 'ended_at', 'plan_version_id', 'recovery_revision', 'deleted_at'],
  workout_set: ['reps', 'load_decimal', 'unit', 'load_semantics', 'set_type', 'rpe_half_units', 'ordinal', 'completed_at', 'note', 'deleted_at'],
  weight_entry: ['local_date', 'occurred_at', 'time_precision', 'value_decimal', 'unit', 'kg_micros', 'condition', 'is_primary', 'deleted_at'],
  meal: ['local_date', 'occurred_at', 'time_precision', 'meal_type', 'title', 'confirmed_at', 'deleted_at'],
  meal_item: ['ordinal', 'original_name', 'quantity_decimal', 'unit', 'consumption_fraction', 'reference_id', 'provenance', 'estimated', 'snapshot_revision', 'deleted_at'],
  goal_version: ['goal_type', 'effective_local_date', 'supersedes_id', 'energy_target_mkcal', 'protein_target_mg', 'carbs_target_mg', 'fat_target_mg', 'weight_min_kg_micros', 'weight_max_kg_micros', 'weekly_change_min_pct', 'weekly_change_max_pct', 'deleted_at'],
  plan_version: ['title', 'effective_local_date', 'status', 'supersedes_id', 'snapshot_revision', 'deleted_at'],
  day_claim: ['training_claim', 'nutrition_completeness', 'nutrition_reviewed_at', 'review_invalidated_reason', 'explicit_zero_intake', 'deleted_at'],
  user_insight: ['kind', 'origin', 'status', 'valid_from', 'expires_at', 'review_due_at', 'supersedes_id', 'payload_revision', 'deleted_at'],
  scheduled_session: ['local_date', 'status', 'plan_version_id', 'template_id', 'moved_from_id', 'override_mode', 'deleted_at'],
  session_exercise: ['setup_id', 'ordinal', 'target_revision', 'deleted_at'],
  exercise_setup: ['exercise_id', 'equipment_instance', 'load_semantics', 'load_unit', 'includes_bar', 'bar_weight_decimal', 'bar_unit', 'increment_decimal', 'increment_unit', 'available_loads_revision', 'deleted_at'],
  import_draft: ['kind', 'status', 'local_date', 'meal_type', 'title', 'description', 'parsed_revision', 'expires_at', 'deleted_at'],
  recommendation: ['kind', 'status', 'target_local_date', 'proposal_id', 'deleted_at'],
  change_proposal: ['status', 'expected_revision', 'expires_at', 'accepted_operation_id', 'deleted_at'],
  user_profile: ['display_name', 'locale', 'timezone', 'pending_timezone', 'timezone_effective_date', 'body_weight_unit', 'default_load_unit', 'training_experience', 'height_cm', 'constraints_text', 'digest_enabled', 'auto_memory_enabled', 'deleted_at'],
  daily_report: ['report_date', 'status', 'data_cutoff_at', 'source_data_revision', 'deleted_at'],
  favorite: ['title', 'version', 'deleted_at'], personal_recipe: ['title', 'version', 'yield_servings', 'yield_grams_milli', 'deleted_at'],
  portion_definition: ['label', 'quantity_decimal', 'unit', 'grams_milli', 'ml_milli', 'density_decimal', 'provenance', 'estimated', 'deleted_at'],
  exercise_alias: ['alias_original', 'alias_normalized', 'locale_hint', 'exercise_id', 'confirmed_at', 'deleted_at'],
  food_alias: ['alias_original', 'alias_normalized', 'locale_hint', 'food_id', 'favorite_id', 'confirmed_at', 'deleted_at'],
  exercise_definition: ['scope', 'catalog_version', 'family_id', 'equipment_type', 'status', 'deleted_at'],
  food_definition: ['scope', 'catalog_version', 'kind', 'reference_state', 'preparation', 'cut_or_part', 'brand', 'status', 'deleted_at'],
} as const satisfies Record<EntityRef['type'], readonly string[]>;

const primitive = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
export const eventChangeSchema = z.strictObject({ field: z.string(), before: primitive, after: primitive });
export const domainEventSchema = z.strictObject({
  schemaVersion: z.literal(1), eventId: z.string(), operationId: uuidSchema, dataRevision: revisionSchema,
  source: z.enum(['user', 'assistant', 'system']), originThreadId: uuidSchema.nullable(), occurredAt: utcSchema, entity: entityRefSchema,
  beforeRevision: revisionSchema.nullable(), afterRevision: revisionSchema, action: z.enum(['created', 'updated', 'deleted', 'restored', 'invalidated']),
  changes: z.array(eventChangeSchema).max(40),
}).superRefine((value, ctx) => {
  const ordinal = value.eventId.slice(value.operationId.length + 1);
  if (!value.eventId.startsWith(`${value.operationId}:`) || !/^(0|[1-9]\d*)$/.test(ordinal) || !Number.isSafeInteger(Number(ordinal))) ctx.addIssue({ code: 'custom', path: ['eventId'], message: 'Invalid event identity' });
  if (value.afterRevision !== value.entity.revision || (value.beforeRevision === null ? value.afterRevision !== 1 || value.action !== 'created' : value.afterRevision !== value.beforeRevision + 1 || value.action === 'created')) ctx.addIssue({ code: 'custom', message: 'Inconsistent event revisions' });
  const allowed: readonly string[] = eventFields[value.entity.type];
  if (value.changes.some(change => !allowed.includes(change.field))) ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Field is not allowed for this entity' });
  if (new Set(value.changes.map(change => change.field)).size !== value.changes.length) ctx.addIssue({ code: 'custom', message: 'Duplicate changed field' });
});
export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EventChange = z.infer<typeof eventChangeSchema>;
export const changeBatchSchema = z.strictObject({
  dataRevision: revisionSchema, operationId: uuidSchema, source: z.enum(['user', 'assistant', 'system']), originThreadId: uuidSchema.nullable(), createdAt: utcSchema,
  events: z.array(domainEventSchema).min(1).max(300),
}).superRefine((value, ctx) => {
  if (value.events.some((event, ordinal) => event.eventId !== `${value.operationId}:${ordinal}` || event.dataRevision !== value.dataRevision || event.source !== value.source || event.originThreadId !== value.originThreadId)) ctx.addIssue({ code: 'custom', message: 'Events must belong to one ordered transaction' });
});
