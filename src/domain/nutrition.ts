import { z } from 'zod';
import { decimalSchema, entityMetadataSchema, localeSchema, localDateSchema, revisionSchema, scaledSchema, sourceKindSchema, timezoneSchema, utcSchema, uuidSchema, validateOccurrence } from './primitives.ts';
import { compareDecimal, decimalFromScaled, scaledDecimal, scaledProduct, sumScaled } from './numbers.ts';
import { nutrientSnapshotSchema, provenanceSchema } from './snapshots.ts';
import type { NutrientSnapshot } from './snapshots.ts';

export const quantitySchema = decimalSchema.refine(value => compareDecimal(value, '0') > 0 && compareDecimal(value, '1000000') <= 0, 'Quantity must be positive and bounded');
export const fractionSchema = decimalSchema.refine(value => compareDecimal(value, '1') <= 0, 'Fraction must be between zero and one');
export const foodUnitSchema = z.enum(['g', 'ml', 'count', 'serving']);
export const foodStateSchema = z.enum(['raw', 'cooked', 'as_packaged', 'unknown']);
export const foodKindSchema = z.enum(['basic_food', 'personal_recipe', 'packaged_food', 'composite_meal', 'manual_total']);
export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'unspecified']);
const title = z.string().trim().min(1).max(160);
const operationFields = { operationId: uuidSchema, createdOperationId: uuidSchema };
export const rawNutrientsSchema = z.strictObject({ energyKcal: decimalSchema.nullable(), proteinG: decimalSchema.nullable(), carbsG: decimalSchema.nullable(), fatG: decimalSchema.nullable() });
export type RawNutrients = z.infer<typeof rawNutrientsSchema>;
export const nutrientKeys = ['energyMkcal', 'proteinMg', 'carbsMg', 'fatMg'] as const;
export const rawNutrientKeys = ['energyKcal', 'proteinG', 'carbsG', 'fatG'] as const;
export function rawFromSnapshot(snapshot: NutrientSnapshot): RawNutrients { return { energyKcal: snapshot.energyMkcal === null ? null : decimalFromScaled(snapshot.energyMkcal), proteinG: snapshot.proteinMg === null ? null : decimalFromScaled(snapshot.proteinMg), carbsG: snapshot.carbsMg === null ? null : decimalFromScaled(snapshot.carbsMg), fatG: snapshot.fatMg === null ? null : decimalFromScaled(snapshot.fatMg) }; }
export const manualNutrientsSchema = rawNutrientsSchema.refine(value => rawNutrientKeys.every((key, index) => value[key] === null || compareDecimal(value[key], index === 0 ? '10000' : '2000') <= 0), 'Nutrient value exceeds the input boundary');
export const emptyNutrients: RawNutrients = { energyKcal: null, proteinG: null, carbsG: null, fatG: null };
const mealDescriptionSchema = z.string().max(2000).refine(value => value.trim().length > 0, 'Describe what you ate');
export const mealNoteInputSchema = z.strictObject({ description: mealDescriptionSchema, nutrients: manualNutrientsSchema, estimated: z.boolean().default(false), confirmLargePortion: z.boolean().default(false) });
export function noteNutrition(nutrients: RawNutrients, estimated = false): NutrientSnapshot {
  return nutrientSnapshotSchema.parse({ schemaVersion: 1, ...Object.fromEntries(nutrientKeys.map((key, index) => [key, nutrients[rawNutrientKeys[index]] === null ? null : scaledDecimal(nutrients[rawNutrientKeys[index]]!, 1000n)])), provenance: 'user_entered', estimated, referenceVersion: null, calculationVersion: null });
}
export const mealNoteSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), description: mealDescriptionSchema, nutrients: manualNutrientsSchema, nutrientSnapshot: nutrientSnapshotSchema }).refine(value => JSON.stringify(value.nutrientSnapshot) === JSON.stringify(noteNutrition(value.nutrients, value.nutrientSnapshot.estimated)), 'Note nutrition must preserve the explicitly entered total');
export type MealNote = z.infer<typeof mealNoteSnapshotSchema>;
export function resolveNote(input: z.infer<typeof mealNoteInputSchema>): MealNote {
  return mealNoteSnapshotSchema.parse({ schemaVersion: 1, description: input.description, nutrients: input.nutrients, nutrientSnapshot: noteNutrition(input.nutrients, input.estimated) });
}
const referenceFields = { id: uuidSchema, basis: z.enum(['per_100g', 'per_100ml', 'per_serving']), servingQuantity: quantitySchema.nullable().default(null), servingUnit: foodUnitSchema.nullable().default(null), nutrients: manualNutrientsSchema, sourceName: title, sourceEntryId: z.string().max(120).nullable().default(null), sourceUrl: z.url().max(2000).refine(value => value.startsWith('https://')).nullable().default(null), sourceVersion: z.string().min(1).max(120), estimated: z.boolean().default(false) };
function validReference(value: { basis: string; servingQuantity: string | null; servingUnit: string | null }) { return value.basis === 'per_serving' ? value.servingQuantity !== null && value.servingUnit !== null : value.servingQuantity === null && value.servingUnit === null; }
export const referenceInputSchema = z.strictObject({ ...referenceFields, provenance: z.enum(['label', 'user_entered']) }).refine(validReference, 'Serving basis requires an explicit definition');
export const foodInputSchema = z.strictObject({ id: uuidSchema, name: title, locale: localeSchema, kind: foodKindSchema, referenceState: foodStateSchema, preparation: z.string().max(160).nullable().default(null), cutOrPart: z.string().max(160).nullable().default(null), brand: z.string().max(160).nullable().default(null), reference: referenceInputSchema.nullable().default(null) });
export const foodDefinitionSchema = entityMetadataSchema.extend({ ownerId: uuidSchema.nullable(), scope: z.enum(['system', 'personal']), catalogVersion: z.string().min(1).max(100), kind: foodKindSchema, referenceState: foodStateSchema, preparation: z.string().max(160).nullable(), cutOrPart: z.string().max(160).nullable(), brand: z.string().max(160).nullable(), status: z.enum(['active', 'archived']), personalName: title.nullable(), personalLocale: localeSchema.nullable() }).refine(value => value.scope === 'system' ? value.ownerId === null && value.personalName === null && value.personalLocale === null : value.ownerId !== null && value.personalName !== null && value.personalLocale !== null, 'Invalid food ownership');
export const personalFoodSchema = foodDefinitionSchema.safeExtend({ ownerId: uuidSchema, scope: z.literal('personal'), personalName: title, personalLocale: localeSchema, ...operationFields });
export type PersonalFood = z.infer<typeof personalFoodSchema>;
export const nutritionReferenceSchema = z.strictObject({ ...referenceFields, foodId: uuidSchema, provenance: z.enum(['reference', 'label', 'user_entered']), retrievedAt: utcSchema }).refine(validReference, 'Serving basis requires an explicit definition');
export type NutritionReference = z.infer<typeof nutritionReferenceSchema>;

export const portionInputSchema = z.strictObject({ id: uuidSchema, foodId: uuidSchema.nullable().default(null), label: title, quantityDecimal: quantitySchema, unit: foodUnitSchema, gramsDecimal: quantitySchema.nullable().default(null), mlDecimal: quantitySchema.nullable().default(null), densityDecimal: quantitySchema.nullable().default(null), estimated: z.boolean().default(true) }).refine(value => value.densityDecimal === null || value.foodId !== null, 'Density must refer to a particular food');
export const portionSchema = entityMetadataSchema.extend({ ...portionInputSchema.shape, gramsMilli: scaledSchema.nullable(), mlMilli: scaledSchema.nullable(), provenance: z.literal('user_entered'), ...operationFields }).refine(value => (value.densityDecimal === null || value.foodId !== null) && value.gramsMilli === (value.gramsDecimal === null ? null : scaledDecimal(value.gramsDecimal, 1000n)) && value.mlMilli === (value.mlDecimal === null ? null : scaledDecimal(value.mlDecimal, 1000n)), 'Portion must retain its normalized input');
export type Portion = z.infer<typeof portionSchema>;
export const portionSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), id: uuidSchema, revision: revisionSchema, foodId: uuidSchema.nullable(), label: title, quantityDecimal: quantitySchema, unit: foodUnitSchema, gramsDecimal: quantitySchema.nullable(), mlDecimal: quantitySchema.nullable(), densityDecimal: quantitySchema.nullable(), estimated: z.boolean() });
export const nutrientBasisSchema = z.strictObject({ schemaVersion: z.literal(1), nutrients: rawNutrientsSchema, quantityDecimal: quantitySchema, unit: foodUnitSchema, provenance: provenanceSchema, estimated: z.boolean(), referenceVersion: z.string().nullable(), calculationVersion: z.string().nullable(), calculationInput: z.strictObject({ provenance: z.enum(['label', 'user_entered']), nutrients: rawNutrientsSchema }).nullable(), recipeId: uuidSchema.nullable(), recipeVersion: revisionSchema.nullable() }).refine(value => (value.recipeId === null) === (value.recipeVersion === null) && (value.provenance !== 'ai_estimate' || value.estimated) && (value.calculationInput === null || value.provenance === 'calculated'), 'Invalid basis source');
export type NutrientBasis = z.infer<typeof nutrientBasisSchema>;
const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual'), nutrients: manualNutrientsSchema, provenance: z.enum(['user_entered', 'label']).default('user_entered'), estimated: z.boolean().default(false), calculateEnergy: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal('reference'), referenceId: uuidSchema, portionRef: z.strictObject({ id: uuidSchema, revision: revisionSchema }).nullable().default(null) }),
  z.strictObject({ kind: z.literal('recipe'), id: uuidSchema, revision: revisionSchema }),
  z.strictObject({ kind: z.literal('existing') }),
]);
export const mealItemInputSchema = z.strictObject({ id: uuidSchema, expectedRevision: revisionSchema.optional(), originalName: title, quantityDecimal: quantitySchema, unit: foodUnitSchema, consumptionFraction: fractionSchema.default('1'), assumptionNote: z.string().max(1000).nullable().default(null), source: sourceSchema, confirmLargePortion: z.boolean().default(false) });
export type MealItemInput = z.infer<typeof mealItemInputSchema>;
export const mealItemSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), originalName: title, foodId: uuidSchema.nullable(), referenceId: uuidSchema.nullable(), referenceState: foodStateSchema, quantityDecimal: quantitySchema, unit: foodUnitSchema, consumptionFraction: fractionSchema, portionSnapshot: portionSnapshotSchema.nullable(), nutrientBasis: nutrientBasisSchema, nutrientSnapshot: nutrientSnapshotSchema, provenance: provenanceSchema, estimated: z.boolean(), assumptionNote: z.string().max(1000).nullable() }).refine(value => value.provenance === value.nutrientSnapshot.provenance && value.estimated === value.nutrientSnapshot.estimated, 'Nutrient source flags must agree');
export type MealItemSnapshot = z.infer<typeof mealItemSnapshotSchema>;
export const recipeComponentSchema = mealItemSnapshotSchema.safeExtend({ id: uuidSchema });
export const mealItemSchema = entityMetadataSchema.extend({ mealId: uuidSchema, ordinal: revisionSchema, snapshot: mealItemSnapshotSchema, ...operationFields });
export type MealItem = z.infer<typeof mealItemSchema>;
const occurrenceFields = { localDate: localDateSchema, entryTimezone: timezoneSchema, occurredAt: utcSchema.nullable(), timePrecision: z.enum(['instant', 'date']) };
export const mealInputSchema = z.strictObject({ id: uuidSchema, ...occurrenceFields, mealType: mealTypeSchema.default('unspecified'), title: z.string().max(160).nullable().default(null), note: mealNoteInputSchema.nullable().default(null), items: z.array(mealItemInputSchema).max(100).default([]), draftRef: z.strictObject({ id: uuidSchema, revision: revisionSchema }).nullable().default(null) }).superRefine(validateOccurrence).refine(value => new Set(value.items.map(item => item.id)).size === value.items.length && (value.note ? value.items.length === 0 : value.items.length > 0), 'Choose a note or food items');
export const mealPatchSchema = z.strictObject({ localDate: localDateSchema.optional(), entryTimezone: timezoneSchema.optional(), occurredAt: utcSchema.nullable().optional(), timePrecision: z.enum(['instant', 'date']).optional(), mealType: mealTypeSchema.optional(), title: z.string().max(160).nullable().optional(), note: mealNoteInputSchema.optional(), items: z.array(mealItemInputSchema).min(1).max(100).optional() }).refine(value => Object.keys(value).length > 0 && !(value.note && value.items) && (!value.items || new Set(value.items.map(item => item.id)).size === value.items.length), 'Empty meal edit or duplicate item');
export const mealSchema = entityMetadataSchema.extend({ ...occurrenceFields, mealType: mealTypeSchema, title: z.string().max(160).nullable(), note: mealNoteSnapshotSchema.nullable().default(null), sourceKind: sourceKindSchema, sourceRef: uuidSchema.nullable(), confirmedAt: utcSchema, ...operationFields }).superRefine(validateOccurrence);
export type Meal = z.infer<typeof mealSchema>;
export const mealSnapshotSchema = z.discriminatedUnion('schemaVersion', [
  z.strictObject({ schemaVersion: z.literal(1), title: z.string().max(160).nullable(), mealType: mealTypeSchema, items: z.array(mealItemSnapshotSchema).min(1).max(100) }),
  z.strictObject({ schemaVersion: z.literal(2), title: z.string().max(160).nullable(), mealType: mealTypeSchema, note: mealNoteSnapshotSchema, items: z.array(mealItemSnapshotSchema).length(0) }),
]);
export const favoriteInputSchema = z.strictObject({ id: uuidSchema, title, mealRef: z.strictObject({ id: uuidSchema, revision: revisionSchema }) });
export const favoritePatchSchema = z.strictObject({ title: title.optional(), mealRef: z.strictObject({ id: uuidSchema, revision: revisionSchema }).optional() }).refine(value => Object.keys(value).length > 0, 'Empty edit');
export const favoriteSchema = entityMetadataSchema.extend({ title, version: revisionSchema, snapshot: mealSnapshotSchema, ...operationFields });
export type Favorite = z.infer<typeof favoriteSchema>;
export const copyFavoriteSchema = z.strictObject({ id: uuidSchema, ...occurrenceFields, expectedRevision: revisionSchema, mealType: mealTypeSchema.optional() }).superRefine(validateOccurrence);
const componentInputSchema = z.array(mealItemInputSchema).min(1).max(100).refine(value => new Set(value.map(item => item.id)).size === value.length, 'Duplicate recipe component');
export const recipeInputSchema = z.strictObject({ id: uuidSchema, title, yieldServings: quantitySchema.nullable(), yieldGramsDecimal: quantitySchema.nullable(), components: componentInputSchema, confirmYield: z.literal(true) }).refine(value => value.yieldServings !== null || value.yieldGramsDecimal !== null, 'Recipe yield required');
export const recipePatchSchema = z.strictObject({ title: title.optional(), yieldServings: quantitySchema.nullable().optional(), yieldGramsDecimal: quantitySchema.nullable().optional(), components: componentInputSchema.optional(), confirmYield: z.literal(true).optional() }).refine(value => ['title', 'yieldServings', 'yieldGramsDecimal', 'components'].some(key => key in value), 'Empty recipe edit');
export const recipeSchema = entityMetadataSchema.extend({ title, version: revisionSchema, yieldServings: quantitySchema.nullable(), yieldGramsDecimal: quantitySchema.nullable(), yieldGramsMilli: scaledSchema.nullable(), components: z.array(recipeComponentSchema).min(1).max(100), nutrientSnapshot: nutrientSnapshotSchema, ...operationFields }).refine(value => (value.yieldServings !== null || value.yieldGramsDecimal !== null) && (value.yieldGramsDecimal === null) === (value.yieldGramsMilli === null) && new Set(value.components.map(item => item.id)).size === value.components.length, 'Recipe requires explicit yield and distinct components');
export type Recipe = z.infer<typeof recipeSchema>;
export const foodAliasInputSchema = z.strictObject({ id: uuidSchema, type: z.literal('food'), text: title, localeHint: localeSchema.nullable().default(null), target: z.discriminatedUnion('type', [z.strictObject({ type: z.literal('food'), id: uuidSchema }), z.strictObject({ type: z.literal('favorite'), id: uuidSchema })]) });
export const foodAliasSchema = entityMetadataSchema.extend({ aliasOriginal: title, aliasNormalized: z.string().max(320), localeHint: localeSchema.nullable(), foodId: uuidSchema.nullable(), favoriteId: uuidSchema.nullable(), confirmedAt: utcSchema, ...operationFields }).refine(value => (value.foodId === null) !== (value.favoriteId === null), 'Exactly one alias target');
export type FoodAlias = z.infer<typeof foodAliasSchema>;
export const mealDraftInputSchema = z.strictObject({ id: uuidSchema, kind: z.literal('meal'), ...occurrenceFields, mealType: mealTypeSchema.default('unspecified'), title: z.string().max(160).nullable().default(null), description: z.string().max(2000), sourceIds: z.array(uuidSchema).max(4).default([]) }).superRefine(validateOccurrence).refine(value => value.description.trim().length > 0 || value.sourceIds.length > 0, 'A draft needs text or an image');
export const mealDraftSchema = entityMetadataSchema.extend({ kind: z.literal('meal'), ...occurrenceFields, mealType: mealTypeSchema, title: z.string().max(160).nullable(), description: z.string().max(2000), sourceIds: z.array(uuidSchema).max(4), status: z.enum(['needs_input', 'review_ready', 'confirmed']), confirmedMealId: uuidSchema.nullable(), expiresAt: utcSchema, ...operationFields }).superRefine(validateOccurrence);
export type MealDraft = z.infer<typeof mealDraftSchema>;
export const mealDraftPatchSchema = z.strictObject({ localDate: localDateSchema.optional(), entryTimezone: timezoneSchema.optional(), occurredAt: utcSchema.nullable().optional(), timePrecision: z.enum(['instant', 'date']).optional(), mealType: mealTypeSchema.optional(), title: z.string().max(160).nullable().optional(), description: z.string().max(2000).optional(), sourceIds: z.array(uuidSchema).max(4).optional() }).refine(value => Object.keys(value).length > 0, 'Empty edit');

export function portionFactors(basis: NutrientBasis, quantity: string, unit: z.infer<typeof foodUnitSchema>, fraction: string, portion: z.infer<typeof portionSnapshotSchema> | null) {
  nutrientBasisSchema.parse(basis); quantitySchema.parse(quantity); foodUnitSchema.parse(unit); fractionSchema.parse(fraction); portionSnapshotSchema.nullable().parse(portion);
  const numerators = [quantity, fraction], denominators = [basis.quantityDecimal];
  if (unit !== basis.unit) {
    if (unit === 'ml' && basis.unit === 'g' && portion?.densityDecimal) numerators.push(portion.densityDecimal);
    else if (unit === 'g' && basis.unit === 'ml' && portion?.densityDecimal) denominators.push(portion.densityDecimal);
    else if (portion && portion.unit === unit && basis.unit === 'g' && portion.gramsDecimal) { numerators.push(portion.gramsDecimal); denominators.push(portion.quantityDecimal); }
    else if (portion && portion.unit === unit && basis.unit === 'ml' && portion.mlDecimal) { numerators.push(portion.mlDecimal); denominators.push(portion.quantityDecimal); }
    else throw new Error('PORTION_CONVERSION_UNKNOWN');
  }
  return { numerators, denominators };
}
export function calculateItemNutrition(basis: NutrientBasis, quantity: string, unit: z.infer<typeof foodUnitSchema>, fraction: string, portion: z.infer<typeof portionSnapshotSchema> | null): NutrientSnapshot {
  const { numerators, denominators } = portionFactors(basis, quantity, unit, fraction, portion);
  const values = rawNutrientKeys.map(key => basis.nutrients[key] === null ? null : scaledProduct(basis.nutrients[key], 1000n, numerators, denominators));
  return nutrientSnapshotSchema.parse({ schemaVersion: 1, energyMkcal: values[0], proteinMg: values[1], carbsMg: values[2], fatMg: values[3], provenance: basis.provenance, estimated: basis.estimated || (portion?.estimated ?? false), referenceVersion: basis.referenceVersion, calculationVersion: basis.calculationVersion ?? 'portion-rational-v1' });
}

/** A whole recipe cannot inherit a partial sum as if every ingredient were known. */
export function recipeNutrition(values: NutrientSnapshot[]): NutrientSnapshot {
  const aggregate = summarizeNutrients(values).knownSum;
  return nutrientSnapshotSchema.parse({ ...aggregate, ...Object.fromEntries(nutrientKeys.map(key => [key, values.some(value => value[key] === null) ? null : aggregate[key]])), provenance: 'recipe', calculationVersion: 'recipe-sum-v1' });
}
export function summarizeNutrients(values: NutrientSnapshot[], explicitZero = false) {
  const totals = nutrientKeys.map(key => {
    const known = values.flatMap(value => value[key] === null ? [] : [value[key]]);
    return known.length ? sumScaled(known) : explicitZero && values.length === 0 ? 0 : null;
  });
  return { knownSum: nutrientSnapshotSchema.parse({ schemaVersion: 1, energyMkcal: totals[0], proteinMg: totals[1], carbsMg: totals[2], fatMg: totals[3], estimated: values.some(value => value.estimated), provenance: 'calculated', referenceVersion: null, calculationVersion: 'known-sum-v1' }), unknownCounts: { energy: values.filter(value => value.energyMkcal === null).length, protein: values.filter(value => value.proteinMg === null).length, carbs: values.filter(value => value.carbsMg === null).length, fat: values.filter(value => value.fatMg === null).length } };
}
