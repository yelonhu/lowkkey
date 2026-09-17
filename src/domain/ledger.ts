import { z } from 'zod';
import { changeBatchSchema } from './events.ts';
import { localeSchema, revisionSchema, scaledSchema, utcSchema, uuidSchema } from './primitives.ts';
import { goalSnapshotSchema, profileSnapshotSchema } from './profile.ts';
import { storedWeightSchema } from './weight.ts';
import { dayClaimSchema, exerciseAliasSchema, exerciseDefinitionSchema, exerciseSetupSchema, personalExerciseSchema, planSelectionSchema, planVersionSchema, scheduledSessionSchema, sessionExerciseSchema, workoutSessionSchema, workoutSetSchema } from './training.ts';
import { favoriteSchema, foodAliasSchema, foodDefinitionSchema, mealDraftSchema, mealItemSchema, mealSchema, nutritionReferenceSchema, personalFoodSchema, portionSchema, recipeSchema } from './nutrition.ts';

function item<K extends string, S extends z.ZodType>(kind: K, value: S) { return z.strictObject({ kind: z.literal(kind), value }); }
/** The same typed records are used by sync, local storage and export. No API can
 * write an arbitrary ledger item; writes still use domain-specific commands. */
export const ledgerEntitySchema = z.discriminatedUnion('kind', [
  item('user_profile', profileSnapshotSchema), item('goal_version', goalSnapshotSchema), item('weight_entry', storedWeightSchema),
  item('exercise_definition', personalExerciseSchema), item('exercise_alias', exerciseAliasSchema), item('exercise_setup', exerciseSetupSchema),
  item('plan_version', planVersionSchema), item('scheduled_session', scheduledSessionSchema), item('workout_session', workoutSessionSchema),
  item('session_exercise', sessionExerciseSchema), item('workout_set', workoutSetSchema), item('day_claim', dayClaimSchema),
  item('food_definition', personalFoodSchema), item('food_alias', foodAliasSchema), item('portion_definition', portionSchema),
  item('personal_recipe', recipeSchema), item('favorite', favoriteSchema), item('meal', mealSchema), item('meal_item', mealItemSchema), item('import_draft', mealDraftSchema),
]);
export type LedgerEntity = z.infer<typeof ledgerEntitySchema>;
export const recipeVersionRecordSchema = z.strictObject({ ownerId: uuidSchema, recipeId: uuidSchema, version: revisionSchema, dataRevision: revisionSchema, snapshot: recipeSchema }).refine(value => value.ownerId === value.snapshot.ownerId && value.recipeId === value.snapshot.id && value.version === value.snapshot.version, 'Recipe history must identify its immutable snapshot');
export const ownedReferenceSchema = nutritionReferenceSchema.safeExtend({ ownerId: uuidSchema.nullable() });
export const ledgerSupplementSchema = z.discriminatedUnion('kind', [
  item('plan_selection', planSelectionSchema), item('recipe_version', recipeVersionRecordSchema), item('nutrition_reference', ownedReferenceSchema),
]);
export type LedgerSupplement = z.infer<typeof ledgerSupplementSchema>;
const labelSchema = z.strictObject({ locale: localeSchema, displayName: z.string().min(1).max(200), searchTerms: z.string().max(4000) });
const labelsSchema = z.array(labelSchema).max(3).refine(labels => new Set(labels.map(label => label.locale)).size === labels.length, 'Duplicate catalog locale');
export const catalogItemSchema = z.discriminatedUnion('kind', [
  item('catalog_exercise', z.strictObject({ definition: exerciseDefinitionSchema.refine(value => value.scope === 'system'), labels: labelsSchema })),
  item('catalog_food', z.strictObject({ definition: foodDefinitionSchema.refine(value => value.scope === 'system'), labels: labelsSchema })),
]);
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export const ledgerItemSchema = z.union([ledgerEntitySchema, ledgerSupplementSchema, catalogItemSchema]);
export type LedgerItem = z.infer<typeof ledgerItemSchema>;
export function ledgerKey(item: LedgerItem): string {
  if (item.kind === 'recipe_version') return `${item.kind}:${item.value.recipeId}:${item.value.version}`;
  if (item.kind === 'catalog_exercise' || item.kind === 'catalog_food') return `${item.kind}:${item.value.definition.id}`;
  return `${item.kind}:${item.value.id}`;
}
export function ledgerOwner(item: LedgerItem): string | null {
  return item.kind === 'catalog_exercise' || item.kind === 'catalog_food' ? item.value.definition.ownerId : item.value.ownerId;
}
export const syncBatchSchema = changeBatchSchema.safeExtend({ changes: z.array(ledgerEntitySchema).min(1).max(300), supplements: z.array(ledgerSupplementSchema).max(300) }).superRefine((batch, context) => {
  if (batch.changes.length !== batch.events.length || batch.changes.some((change, index) => {
    const event = batch.events[index];
    return !event || change.kind !== event.entity.type || change.value.id !== event.entity.id || change.value.revision !== event.afterRevision || (change.value.deletedAt !== null) !== (event.action === 'deleted');
  })) context.addIssue({ code: 'custom', message: 'Sync values must match their committed events' });
  if (batch.supplements.some(extra => extra.kind === 'nutrition_reference' ? extra.value.ownerId === null : extra.value.dataRevision !== batch.dataRevision)) context.addIssue({ code: 'custom', message: 'Supplement must belong to the same command' });
});
export type SyncBatch = z.infer<typeof syncBatchSchema>;
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const envelopeFields = { schemaVersion: z.literal(1), ownerId: uuidSchema, restoreEpoch: uuidSchema, dataRevision: scaledSchema, catalogRevision: fingerprintSchema, capturedAt: utcSchema };
export const syncPageSchema = z.strictObject({ ...envelopeFields, fromRevision: scaledSchema, items: z.array(syncBatchSchema).max(100), nextCursor: z.string().min(1), hasMore: z.boolean() }).superRefine((page, context) => {
  if (page.items.some((batch, index) => batch.dataRevision !== page.fromRevision + index + 1 || [...batch.changes, ...batch.supplements].some(item => ledgerOwner(item) !== page.ownerId))) context.addIssue({ code: 'custom', message: 'Sync must be contiguous and owned' });
  const last = page.items.at(-1)?.dataRevision ?? page.fromRevision;
  if (last > page.dataRevision || page.hasMore !== (last < page.dataRevision)) context.addIssue({ code: 'custom', message: 'Invalid sync cutoff' });
});
export type SyncPage = z.infer<typeof syncPageSchema>;
export const snapshotPageSchema = z.strictObject({ ...envelopeFields, items: z.array(ledgerItemSchema).max(100), nextCursor: z.string().nullable(), syncCursor: z.string().nullable() }).superRefine((page, context) => {
  if ((page.nextCursor === null) === (page.syncCursor === null)) context.addIssue({ code: 'custom', message: 'Only the final snapshot page establishes a sync cursor' });
  if (new Set(page.items.map(ledgerKey)).size !== page.items.length || page.items.some(item => ledgerOwner(item) !== null && ledgerOwner(item) !== page.ownerId)) context.addIssue({ code: 'custom', message: 'Duplicate or foreign snapshot item' });
});
export type SnapshotPage = z.infer<typeof snapshotPageSchema>;
