import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { addDays, localDateAt, localeSchema, localDateSchema, uuidSchema } from '../domain/primitives.ts';
import { createCustomFood, saveFoodAlias, savePortion, searchFoods } from './foods.ts';
import { createMeal, createMealDraft, editMeal, editMealDraft, readMealTree } from './meals.ts';
import { copyFavorite, readRecipeVersion, saveFavorite, saveRecipe } from './nutrition-library.ts';
import { nutritionSummary } from './nutrition-days.ts';
import { favorites, foodAliases, mealDrafts, meals, portions, recipes } from './nutrition-store.ts';
import { createExerciseAlias, editExerciseAlias } from './exercises.ts';
import { exerciseAliases } from './training-store.ts';
import { pageAfter, pageQueryFields, pageResult } from './pagination.ts';
import { readConsistent } from './read-model.ts';
import { writeHeaders } from './api.ts';
import type { ApiEnvironment, AppBindings } from './api.ts';
import type { CommandReceipt } from './commands.ts';
import type { OwnedRecord, RecordStore } from './record-store.ts';
import { DomainError } from './errors.ts';

type ApiContext = Context<ApiEnvironment>;
type Dependencies = { bodies: WeakMap<Request, unknown>; clock: () => Date; meta: (bindings: AppBindings, extra?: Record<string, unknown>) => Record<string, unknown> };
const empty = z.strictObject({});
const rangeFields = { from: localDateSchema.optional(), to: localDateSchema.optional() };
export function registerNutritionRoutes(app: Hono<ApiEnvironment>, { bodies, clock, meta }: Dependencies) {
  const body = (context: ApiContext) => bodies.get(context.req.raw);
  const id = (context: ApiContext) => uuidSchema.parse(context.req.param('id'));
  const write = (context: ApiContext, edit = false) => writeHeaders(context.req.raw.headers, edit);
  const receipt = (context: ApiContext, value: CommandReceipt, created = false) => context.json({ data: value, meta: meta(context.env, { operationId: value.operationId, dataRevision: value.dataRevision }) }, created ? 201 : 200);
  const read = async <T>(context: ApiContext, action: () => Promise<T>) => {
    const result = await readConsistent(context.env.DB, context.get('auth').id, action);
    return context.json({ data: result.data, meta: meta(context.env, { dataRevision: result.dataRevision }) });
  };
  function range(context: ApiContext, input: { from?: string; to?: string }, days = 365, defaultDays = days) {
    const today = localDateAt(clock(), context.get('auth').timezone), from = input.from ?? addDays(today, -defaultDays + 1), to = input.to ?? today;
    if (from > to || new Date(to).getTime() - new Date(from).getTime() >= days * 86400000) throw new DomainError('INVALID_INPUT', 400, { reason: 'dateRange' });
    return { from, to };
  }
  async function listing<T extends OwnedRecord>(context: ApiContext, store: RecordStore<T>, query: { limit: number; cursor?: string }, filter = '1', values: Array<string | number | null> = [], binding: Record<string, unknown> = {}) {
    const owner = context.get('auth').id, after = pageAfter(owner, store.type, binding, query.cursor);
    return pageResult(await store.list(context.env.DB, owner, `(${filter}) AND (? IS NULL OR id>?)`, [...values, after, after], `id LIMIT ${query.limit + 1}`), query.limit, owner, store.type, binding);
  }
  app.get('/api/v1/catalog/foods', context => {
    const query = z.strictObject({ ...pageQueryFields, q: z.string().max(120).default(''), locale: localeSchema.default(context.get('auth').locale) }).parse(context.req.query());
    return read(context, () => searchFoods(context.env.DB, context.get('auth').id, query));
  });
  app.post('/api/v1/catalog/custom-foods', async context => receipt(context, await createCustomFood(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.get('/api/v1/aliases', context => {
    const query = z.strictObject({ ...pageQueryFields, type: z.enum(['exercise', 'food']) }).parse(context.req.query());
    return read(context, async () => query.type === 'food' ? listing(context, foodAliases, query) : listing(context, exerciseAliases, query));
  });
  app.post('/api/v1/aliases', async context => {
    const type = z.object({ type: z.enum(['exercise', 'food']) }).parse(body(context)).type;
    return receipt(context, type === 'food' ? await saveFoodAlias(context.env.DB, context.get('auth'), write(context).operationId, body(context), undefined, clock) : await createExerciseAlias(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true);
  });
  for (const method of ['patch', 'delete'] as const) app[method]('/api/v1/aliases/:id', async context => {
    const query = z.strictObject({ type: z.enum(['exercise', 'food']).default('exercise') }).parse(context.req.query()), headers = write(context, true);
    if (method === 'delete') empty.parse(body(context));
    return receipt(context, query.type === 'food' ? await saveFoodAlias(context.env.DB, context.get('auth'), headers.operationId, body(context), { id: id(context), revision: headers.expectedRevision!, deleting: method === 'delete' }, clock) : await editExerciseAlias(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), method === 'delete', clock));
  });
  app.get('/api/v1/meals', context => {
    const query = z.strictObject({ ...pageQueryFields, ...rangeFields }).parse(context.req.query()), bounds = range(context, query);
    return read(context, () => listing(context, meals, query, 'local_date BETWEEN ? AND ?', [bounds.from, bounds.to], bounds));
  });
  app.post('/api/v1/meals', async context => receipt(context, await createMeal(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.get('/api/v1/meals/:id', context => { empty.parse(context.req.query()); return read(context, () => readMealTree(context.env.DB, context.get('auth').id, id(context))); });
  for (const method of ['patch', 'delete'] as const) app[method]('/api/v1/meals/:id', async context => {
    const headers = write(context, true);
    return receipt(context, await editMeal(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), method === 'delete', clock));
  });
  for (const name of ['favorites', 'recipes', 'portions'] as const) {
    app.get(`/api/v1/${name}`, context => {
      const query = z.strictObject(pageQueryFields).parse(context.req.query());
      return read(context, async () => name === 'favorites' ? listing(context, favorites, query) : name === 'recipes' ? listing(context, recipes, query) : listing(context, portions, query));
    });
    app.post(`/api/v1/${name}`, async context => {
      const save = name === 'favorites' ? saveFavorite : name === 'recipes' ? saveRecipe : savePortion;
      return receipt(context, await save(context.env.DB, context.get('auth'), write(context).operationId, body(context), undefined, clock), true);
    });
    for (const method of ['patch', 'delete'] as const) app[method](`/api/v1/${name}/:id`, async context => {
      const save = name === 'favorites' ? saveFavorite : name === 'recipes' ? saveRecipe : savePortion, headers = write(context, true);
      return receipt(context, await save(context.env.DB, context.get('auth'), headers.operationId, body(context), { id: id(context), revision: headers.expectedRevision!, deleting: method === 'delete' }, clock));
    });
  }
  app.get('/api/v1/recipes/:id/versions/:version', context => {
    empty.parse(context.req.query());
    const version = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).parse(context.req.param('version'));
    return read(context, () => readRecipeVersion(context.env.DB, context.get('auth').id, id(context), version));
  });
  app.post('/api/v1/favorites/:id/copy', async context => receipt(context, await copyFavorite(context.env.DB, context.get('auth'), write(context).operationId, id(context), body(context), clock), true));
  app.get('/api/v1/nutrition/summary', context => {
    const query = z.strictObject(rangeFields).parse(context.req.query()), bounds = range(context, query, 31, 1);
    return read(context, () => nutritionSummary(context.env.DB, context.get('auth').id, bounds.from, bounds.to));
  });
  app.get('/api/v1/imports', context => {
    const query = z.strictObject({ ...pageQueryFields, ...rangeFields, kind: z.literal('meal') }).parse(context.req.query()), bounds = range(context, query);
    return read(context, () => listing(context, mealDrafts, query, "local_date BETWEEN ? AND ? AND status<>'confirmed'", [bounds.from, bounds.to], bounds));
  });
  app.post('/api/v1/imports', async context => receipt(context, await createMealDraft(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.get('/api/v1/imports/:id', context => { empty.parse(context.req.query()); return read(context, () => mealDrafts.read(context.env.DB, context.get('auth').id, id(context))); });
  for (const method of ['patch', 'delete'] as const) app[method]('/api/v1/imports/:id', async context => {
    const headers = write(context, true);
    return receipt(context, await editMealDraft(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), method === 'delete', clock));
  });
}
