import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { copyFavoriteSchema, favoriteInputSchema, favoritePatchSchema, mealSchema, recipeInputSchema, recipeNutrition, recipePatchSchema, recipeSchema } from '../domain/nutrition.ts';
import type { Recipe } from '../domain/nutrition.ts';
import { scaledDecimal } from '../domain/numbers.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { expectRevision, newMetadata, reviseRecord } from './record-store.ts';
import { favorites, recipes } from './nutrition-store.ts';
import { resolveMealItem } from './nutrition-basis.ts';
import { frozenMeal, newMealPlan, readMealTree } from './meals.ts';

export function saveRecipe(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, edit?: { id: string; revision: number; deleting?: boolean }, clock?: () => Date) {
  const input = edit ? edit.deleting ? z.strictObject({}).parse(payload) : recipePatchSchema.parse(payload) : recipeInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: `recipe.${edit ? edit.deleting ? 'delete' : 'patch' : 'create'}`, payload: { ...input, ...(edit ? { id: edit.id } : {}) }, expectedRevision: edit?.revision, entryPoint: 'manual', plan: async context => {
    const before = edit ? await recipes.read(db, auth.id, edit.id) : null;
    if (before && edit) expectRevision(before, edit.revision);
    if (edit?.deleting && before) { const plan = recipes.plan(context, before, reviseRecord(before, context, { deletedAt: context.now })); plan.undoable = false; return plan; }
    const guards: Guard[] = [], components: Recipe['components'] = [];
    if (input.components) {
      for (const item of input.components) {
        if (item.expectedRevision !== undefined) throw new DomainError('INVALID_INPUT', 400, { reason: 'recipeRootRevisionOnly' });
        if (item.source.kind === 'recipe' && item.source.id === before?.id) throw new DomainError('INVALID_INPUT', 400, { reason: 'recursiveRecipe' });
        const resolved = await resolveMealItem(context, item, before?.components.find(old => old.id === item.id), true);
        components.push({ id: item.id, ...resolved.snapshot }); guards.push(...resolved.guards);
      }
    } else if (before) components.push(...before.components);
    if (!before || input.components !== undefined || input.yieldServings !== undefined || input.yieldGramsDecimal !== undefined) {
      if (input.confirmYield !== true) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'confirmRecipeYield' });
    }
    const yieldServings = input.yieldServings === undefined ? before?.yieldServings ?? null : input.yieldServings;
    const yieldGramsDecimal = input.yieldGramsDecimal === undefined ? before?.yieldGramsDecimal ?? null : input.yieldGramsDecimal;
    const fields = { title: input.title ?? before?.title, version: (before?.version ?? 0) + 1, yieldServings, yieldGramsDecimal, yieldGramsMilli: yieldGramsDecimal === null ? null : scaledDecimal(yieldGramsDecimal, 1000n), components, nutrientSnapshot: recipeNutrition(components.map(item => item.nutrientSnapshot)) };
    const record = recipeSchema.parse(before ? reviseRecord(before, context, fields) : { ...newMetadata(context, recipeInputSchema.parse(input).id), ...fields });
    const plan = recipes.plan(context, before, record); plan.guards.push(...guards);
    plan.statements.push(db.prepare('INSERT INTO recipe_versions(owner_id,recipe_id,version,snapshot_json,data_revision) VALUES (?,?,?,?,?)').bind(auth.id, record.id, record.version, JSON.stringify(record), context.dataRevision));
    plan.result = { id: record.id, version: record.version }; plan.undoable = false; return plan;
  } }, clock);
}
export async function readRecipeVersion(db: D1Database, owner: string, id: string, version: number) {
  const row = await db.prepare('SELECT snapshot_json FROM recipe_versions WHERE owner_id=? AND recipe_id=? AND version=?').bind(owner, id, version).first<string>('snapshot_json');
  if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
  return recipeSchema.parse(JSON.parse(row));
}
export function saveFavorite(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, edit?: { id: string; revision: number; deleting?: boolean }, clock?: () => Date) {
  const input = edit ? edit.deleting ? z.strictObject({}).parse(payload) : favoritePatchSchema.parse(payload) : favoriteInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: `favorite.${edit ? edit.deleting ? 'delete' : 'patch' : 'create'}`, payload: { ...input, ...(edit ? { id: edit.id } : {}) }, expectedRevision: edit?.revision, entryPoint: 'manual', plan: async context => {
    const before = edit ? await favorites.read(db, auth.id, edit.id) : null;
    if (before && edit) expectRevision(before, edit.revision);
    if (edit?.deleting && before) { const plan = favorites.plan(context, before, reviseRecord(before, context, { deletedAt: context.now })); plan.undoable = false; return plan; }
    const tree = input.mealRef ? await readMealTree(db, auth.id, input.mealRef.id) : null;
    if (tree && input.mealRef) expectRevision(tree.meal, input.mealRef.revision);
    const fields = { title: input.title ?? before?.title, snapshot: tree ? frozenMeal(tree.meal, tree.items) : before?.snapshot, version: (before?.version ?? 0) + 1 };
    const record = favorites.schema.parse(before ? reviseRecord(before, context, fields) : { ...newMetadata(context, favoriteInputSchema.parse(input).id), ...fields });
    const plan = favorites.plan(context, before, record);
    if (tree) plan.guards.push({ predicate: 'EXISTS(SELECT 1 FROM meals WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)', values: [auth.id, tree.meal.id, tree.meal.revision], error: new DomainError('CONTEXT_STALE', 422) });
    plan.undoable = false; return plan;
  } }, clock);
}
export function copyFavorite(db: D1Database, auth: AuthContext, operationId: string, id: string, payload: unknown, clock?: () => Date) {
  const input = copyFavoriteSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'nutrition.meal.copy', payload: { favoriteId: id, ...input }, entryPoint: 'manual', plan: async context => {
    const favorite = await favorites.read(db, auth.id, id); expectRevision(favorite, input.expectedRevision);
    const meal = mealSchema.parse({ ...newMetadata(context, input.id), localDate: input.localDate, entryTimezone: input.entryTimezone, occurredAt: input.occurredAt, timePrecision: input.timePrecision, mealType: input.mealType ?? favorite.snapshot.mealType, title: favorite.snapshot.title, note: favorite.snapshot.schemaVersion === 2 ? favorite.snapshot.note : null, sourceKind: 'copied', sourceRef: favorite.id, confirmedAt: context.now });
    const plan = await newMealPlan(context, meal, favorite.snapshot.items.map(snapshot => ({ id: crypto.randomUUID(), snapshot })));
    plan.guards.push({ predicate: 'EXISTS(SELECT 1 FROM favorites WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)', values: [auth.id, id, favorite.revision], error: new DomainError('CONTEXT_STALE', 422) });
    plan.result = { ...plan.result, sourceFavoriteId: id, sourceFavoriteVersion: favorite.version }; return plan;
  } }, clock);
}
