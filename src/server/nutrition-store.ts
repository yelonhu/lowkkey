import { favoriteSchema, foodAliasSchema, mealDraftSchema, mealItemSchema, mealSchema, personalFoodSchema, portionSchema, recipeSchema } from '../domain/nutrition.ts';
import type { Favorite, FoodAlias, Meal, MealDraft, MealItem, PersonalFood, Portion, Recipe } from '../domain/nutrition.ts';
import { RecordStore, recordColumns } from './record-store.ts';

export const personalFoods = new RecordStore<PersonalFood>('food_definitions', 'food_definition', personalFoodSchema, {
  ...recordColumns, scope: 'scope', catalogVersion: 'catalog_version', kind: 'kind', referenceState: 'reference_state', preparation: 'preparation', cutOrPart: 'cut_or_part', brand: 'brand', status: 'status', personalName: 'personal_name', personalLocale: 'personal_locale',
});
export const portions = new RecordStore<Portion>('portion_definitions', 'portion_definition', portionSchema, {
  ...recordColumns, foodId: 'food_id', label: 'label', quantityDecimal: 'quantity_decimal', unit: 'unit', gramsDecimal: 'grams_decimal', mlDecimal: 'ml_decimal', gramsMilli: 'grams_milli', mlMilli: 'ml_milli', densityDecimal: 'density_decimal', provenance: 'provenance', estimated: 'estimated',
}, [], ['estimated']);
export const recipes = new RecordStore<Recipe>('personal_recipes', 'personal_recipe', recipeSchema, {
  ...recordColumns, title: 'title', version: 'version', yieldServings: 'yield_servings', yieldGramsDecimal: 'yield_grams_decimal', yieldGramsMilli: 'yield_grams_milli', components: 'components_json', nutrientSnapshot: 'nutrient_snapshot_json',
}, ['components', 'nutrientSnapshot']);
export const favorites = new RecordStore<Favorite>('favorites', 'favorite', favoriteSchema, {
  ...recordColumns, title: 'title', version: 'version', snapshot: 'snapshot_json',
}, ['snapshot']);
export const foodAliases = new RecordStore<FoodAlias>('food_aliases', 'food_alias', foodAliasSchema, {
  ...recordColumns, aliasOriginal: 'alias_original', aliasNormalized: 'alias_normalized', localeHint: 'locale_hint', foodId: 'food_id', favoriteId: 'favorite_id', confirmedAt: 'confirmed_at',
});
export const meals = new RecordStore<Meal>('meals', 'meal', mealSchema, {
  ...recordColumns, localDate: 'local_date', entryTimezone: 'entry_timezone', occurredAt: 'occurred_at', timePrecision: 'time_precision', mealType: 'meal_type', title: 'title', sourceKind: 'source_kind', sourceRef: 'source_ref', confirmedAt: 'confirmed_at',
});
export const mealItems = new RecordStore<MealItem>('meal_items', 'meal_item', mealItemSchema, {
  ...recordColumns, mealId: 'meal_id', ordinal: 'ordinal', snapshot: 'snapshot_json',
}, ['snapshot'], [], { snapshot: 'snapshot_revision' });
export const mealDrafts = new RecordStore<MealDraft>('import_drafts', 'import_draft', mealDraftSchema, {
  ...recordColumns, kind: 'kind', localDate: 'local_date', entryTimezone: 'entry_timezone', occurredAt: 'occurred_at', timePrecision: 'time_precision', mealType: 'meal_type', title: 'title', description: 'description', sourceIds: 'source_ids_json', status: 'status', confirmedMealId: 'confirmed_meal_id', expiresAt: 'expires_at',
}, ['sourceIds'], [], { sourceIds: 'parsed_revision' });
