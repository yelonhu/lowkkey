import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnvironment, AppBindings } from './api.ts';
import { pageQueryFields } from './pagination.ts';
import { readSync, readSyncSnapshot } from './sync.ts';

export function registerSyncRoutes(app: Hono<ApiEnvironment>, options: { clock: () => Date; meta: (bindings: AppBindings, extra?: Record<string, unknown>) => Record<string, unknown> }) {
  app.get('/api/v1/sync', async context => {
    const query = z.strictObject({ ...pageQueryFields, cursor: z.string().min(1).max(4000) }).parse(context.req.query());
    const data = await readSync(context.env.DB, context.get('auth').id, context.env.RESTORE_EPOCH, query, options.clock);
    return context.json({ data, meta: options.meta(context.env, { dataRevision: data.dataRevision }) });
  });
  app.get('/api/v1/sync/snapshot', async context => {
    const query = z.strictObject(pageQueryFields).parse(context.req.query());
    const data = await readSyncSnapshot(context.env.DB, context.get('auth').id, context.env.RESTORE_EPOCH, query, options.clock);
    return context.json({ data, meta: options.meta(context.env, { dataRevision: data.dataRevision }) });
  });
}
