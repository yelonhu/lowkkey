import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { addDays, localDateAt, localDateSchema, uuidSchema } from '../domain/primitives.ts';
import { artifactKinds } from '../domain/artifacts.ts';
import { weightTrend } from '../domain/weight.ts';
import { readArtifacts } from './artifacts.ts';
import { listWeights, weightPage } from './weights.ts';
import { pageQueryFields } from './pagination.ts';
import { readConsistent } from './read-model.ts';
import type { ApiEnvironment, AppBindings } from './api.ts';
import { DomainError } from './errors.ts';

type Dependencies = { clock: () => Date; meta: (bindings: AppBindings, extra?: Record<string, unknown>) => Record<string, unknown> };
export function registerArtifactRoutes(app: Hono<ApiEnvironment>, { clock, meta }: Dependencies) {
  const rangeFields = { from: localDateSchema.optional(), to: localDateSchema.optional() };
  function range(context: Context<ApiEnvironment>, query: { from?: string; to?: string }, maximum: number, initial: number) {
    const to = query.to ?? localDateAt(clock(), context.get('auth').timezone), from = query.from ?? addDays(to, -initial + 1);
    if (from > to || new Date(to).getTime() - new Date(from).getTime() >= maximum * 86400000) throw new DomainError('INVALID_INPUT', 400, { reason: 'dateRange' });
    return { from, to };
  }
  app.get('/api/v1/artifacts', async context => {
    const query = z.strictObject({ localDate: localDateSchema.optional(), kind: z.enum(artifactKinds).optional(), sessionId: uuidSchema.optional(), ...rangeFields }).refine(value => (value.from === undefined) === (value.to === undefined), 'Both range bounds are required').parse(context.req.query());
    const { from, to, ...selection } = query;
    const result = await readArtifacts(context.env.DB, context.get('auth'), { ...selection, ...(from && to ? { range: { from, to } } : {}) }, clock);
    return context.json({ data: result.views, meta: meta(context.env, { dataRevision: result.dataRevision, query: result.query }) });
  });
  app.get('/api/v1/weights', async context => {
    const query = z.strictObject({ ...pageQueryFields, ...rangeFields }).parse(context.req.query()), bounds = range(context, query, 365, 30);
    const result = await readConsistent(context.env.DB, context.get('auth').id, () => weightPage(context.env.DB, context.get('auth').id, bounds.from, bounds.to, query));
    return context.json({ data: result.data, meta: meta(context.env, { dataRevision: result.dataRevision, query: bounds }) });
  });
  app.get('/api/v1/trends/weight', async context => {
    const query = z.strictObject(rangeFields).parse(context.req.query()), bounds = range(context, query, 90, 28);
    const result = await readConsistent(context.env.DB, context.get('auth').id, async () => {
      const entries = await listWeights(context.env.DB, context.get('auth').id, addDays(bounds.from, -13), bounds.to);
      return { ...weightTrend(entries, bounds.from, bounds.to), rawPoints: entries.filter(entry => entry.isPrimary && entry.localDate >= bounds.from).map(entry => ({ id: entry.id, revision: entry.revision, localDate: entry.localDate, kgMicros: entry.kgMicros })), ...bounds };
    });
    return context.json({ data: result.data, meta: meta(context.env, { dataRevision: result.dataRevision, query: bounds }) });
  });
}
