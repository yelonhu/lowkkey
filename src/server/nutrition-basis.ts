import { calculateItemNutrition, mealItemSnapshotSchema, nutrientBasisSchema, portionFactors, portionSnapshotSchema, rawFromSnapshot, rawNutrientKeys } from '../domain/nutrition.ts';
import type { MealItemInput, MealItemSnapshot, NutrientBasis } from '../domain/nutrition.ts';
import { compareDecimalProduct, sumDecimalProducts } from '../domain/numbers.ts';
import type { CommandContext, Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { foodGuard, readReference } from './foods.ts';
import { portions, recipes } from './nutrition-store.ts';
import { expectRevision } from './record-store.ts';

export async function resolveMealItem(context: CommandContext, input: MealItemInput, existing?: MealItemSnapshot, wholeRecipe = false) {
  const guards: Guard[] = [];
  let basis: NutrientBasis, portion: MealItemSnapshot['portionSnapshot'] = null, foodId: string | null = null, referenceId: string | null = null, referenceState: MealItemSnapshot['referenceState'] = 'unknown';
  const source = input.source;
  if (source.kind === 'manual') {
    const nutrients = { ...source.nutrients };
    if (source.calculateEnergy) {
      if (nutrients.proteinG === null || nutrients.carbsG === null || nutrients.fatG === null) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'macrosRequired' });
      nutrients.energyKcal = sumDecimalProducts([{ value: nutrients.proteinG, coefficient: 4 }, { value: nutrients.carbsG, coefficient: 4 }, { value: nutrients.fatG, coefficient: 9 }]);
    }
    // Manual numbers describe the entered amount before the consumption fraction.
    basis = { schemaVersion: 1, nutrients, quantityDecimal: input.quantityDecimal, unit: input.unit, provenance: source.calculateEnergy ? 'calculated' : source.provenance, estimated: source.estimated || source.calculateEnergy, referenceVersion: null, calculationVersion: source.calculateEnergy ? 'macro-4-4-9-v1' : null, calculationInput: source.calculateEnergy ? { provenance: source.provenance, nutrients: source.nutrients } : null, recipeId: null, recipeVersion: null };
  } else if (source.kind === 'reference') {
    const { reference, food } = await readReference(context.db, context.auth.id, source.referenceId);
    guards.push(foodGuard(context.auth.id, food.id, food.revision));
    foodId = food.id; referenceId = reference.id; referenceState = food.referenceState;
    basis = { schemaVersion: 1, nutrients: reference.nutrients, quantityDecimal: reference.basis === 'per_serving' ? reference.servingQuantity! : '100', unit: reference.basis === 'per_100g' ? 'g' : reference.basis === 'per_100ml' ? 'ml' : reference.servingUnit!, provenance: reference.provenance, estimated: reference.estimated, referenceVersion: reference.sourceVersion, calculationVersion: null, calculationInput: null, recipeId: null, recipeVersion: null };
    if (source.portionRef) {
      const definition = await portions.read(context.db, context.auth.id, source.portionRef.id); expectRevision(definition, source.portionRef.revision);
      if ((definition.foodId !== null && definition.foodId !== food.id) || (input.unit !== basis.unit && basis.unit === 'g' && definition.foodId === null)) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'portionFoodMismatch' });
      portion = portionSnapshotSchema.parse({ schemaVersion: 1, ...Object.fromEntries(Object.keys(portionSnapshotSchema.shape).filter(key => key !== 'schemaVersion').map(key => [key, definition[key as keyof typeof definition]])) });
      guards.push({ predicate: 'EXISTS(SELECT 1 FROM portion_definitions WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)', values: [context.auth.id, definition.id, definition.revision], error: new DomainError('CONTEXT_STALE', 422) });
    }
  } else if (source.kind === 'recipe') {
    const recipe = await recipes.read(context.db, context.auth.id, source.id); expectRevision(recipe, source.revision);
    const quantity = input.unit === 'g' ? recipe.yieldGramsDecimal : input.unit === 'serving' ? recipe.yieldServings : null;
    if (quantity === null) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'recipeYieldUnknown' });
    basis = { schemaVersion: 1, nutrients: rawFromSnapshot(recipe.nutrientSnapshot), quantityDecimal: quantity, unit: input.unit, provenance: 'recipe', estimated: recipe.nutrientSnapshot.estimated, referenceVersion: `recipe/${recipe.id}/${recipe.version}`, calculationVersion: 'recipe-portion-v1', calculationInput: null, recipeId: recipe.id, recipeVersion: recipe.version };
    guards.push({ predicate: 'EXISTS(SELECT 1 FROM personal_recipes WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)', values: [context.auth.id, recipe.id, recipe.revision], error: new DomainError('CONTEXT_STALE', 422) });
  } else {
    if (!existing) throw new DomainError('INVALID_INPUT', 400, { reason: 'existingItemRequired' });
    basis = existing.nutrientBasis; portion = existing.portionSnapshot; foodId = existing.foodId; referenceId = existing.referenceId; referenceState = existing.referenceState;
  }
  nutrientBasisSchema.parse(basis);
  let factors: ReturnType<typeof portionFactors>;
  try { factors = portionFactors(basis, input.quantityDecimal, input.unit, input.consumptionFraction, portion); }
  catch (error) { if (error instanceof Error && error.message === 'PORTION_CONVERSION_UNKNOWN') throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'portionConversionUnknown' }); throw error; }
  if (!wholeRecipe) {
    for (let index = 0; index < rawNutrientKeys.length; index++) {
      const value = basis.nutrients[rawNutrientKeys[index]];
      if (value !== null && compareDecimalProduct(value, index === 0 ? '10000' : '2000', factors.numerators, factors.denominators) > 0) throw new DomainError('INVALID_INPUT', 400, { reason: 'nutrientOutOfRange' });
    }
    if (basis.nutrients.energyKcal !== null && compareDecimalProduct(basis.nutrients.energyKcal, '3000', factors.numerators, factors.denominators) > 0 && !input.confirmLargePortion) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'largePortion' });
    if (['g', 'ml'].includes(input.unit) && compareDecimalProduct(input.quantityDecimal, '5000', [input.consumptionFraction]) > 0 && !input.confirmLargePortion) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'largePortion' });
  }
  let nutrientSnapshot;
  try { nutrientSnapshot = calculateItemNutrition(basis, input.quantityDecimal, input.unit, input.consumptionFraction, portion); }
  catch (error) { if (error instanceof Error && error.message === 'UNSAFE_SCALED_NUMBER') throw new DomainError('INVALID_INPUT', 400, { reason: 'nutrientOutOfRange' }); throw error; }
  const snapshot = mealItemSnapshotSchema.parse({ schemaVersion: 1, originalName: input.originalName, foodId, referenceId, referenceState, quantityDecimal: input.quantityDecimal, unit: input.unit, consumptionFraction: input.consumptionFraction, portionSnapshot: portion, nutrientBasis: basis, nutrientSnapshot, provenance: nutrientSnapshot.provenance, estimated: nutrientSnapshot.estimated, assumptionNote: input.assumptionNote });
  return { snapshot, guards };
}
