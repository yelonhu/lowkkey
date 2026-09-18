import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { addDays, localDateAt, localeSchema, localDateSchema, uuidSchema } from '../domain/primitives.ts';
import { createCustomExercise, createSetup, patchSetup, searchExercises } from './exercises.ts';
import { addDailySet, readTrainingDay, addExercise, addSet, createSession, editExercise, editSet, patchSession, trainingHistory, transitionSession } from './training.ts';
import { patchDayClaim, readDay } from './days.ts';
import { changePlanSelection, createPlan, createSchedule, editSchedule, readActivePlan, readPlanSelection, readScheduleDay } from './plans.ts';
import { plans, schedules, sessionExercises, sessions, sets, setups } from './training-store.ts';
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
export function registerTrainingRoutes(app: Hono<ApiEnvironment>, { bodies, clock, meta }: Dependencies) {
  const body = (context: ApiContext) => bodies.get(context.req.raw);
  const id = (context: ApiContext, field = 'id') => uuidSchema.parse(context.req.param(field));
  const write = (context: ApiContext, edit = false) => writeHeaders(context.req.raw.headers, edit);
  const receipt = (context: ApiContext, value: CommandReceipt, created = false) => context.json({ data: value, meta: meta(context.env, { operationId: value.operationId, dataRevision: value.dataRevision }) }, created ? 201 : 200);
  const read = async <T>(context: ApiContext, action: () => Promise<T>) => {
    const result = await readConsistent(context.env.DB, context.get('auth').id, action);
    return context.json({ data: result.data, meta: meta(context.env, { dataRevision: result.dataRevision }) });
  };
  function range(context: ApiContext, input: { from?: string; to?: string }, days = 365) {
    const today = localDateAt(clock(), context.get('auth').timezone), from = input.from ?? addDays(today, -days + 1), to = input.to ?? today;
    if (from > to || (new Date(to).getTime() - new Date(from).getTime()) / 86400000 >= days) throw new DomainError('INVALID_INPUT', 400, { reason: 'dateRange' });
    return { from, to };
  }
  async function listing<T extends OwnedRecord>(context: ApiContext, store: RecordStore<T>, query: { limit: number; cursor?: string }, filter = '1', values: Array<string | number | null> = [], binding: Record<string, unknown> = {}) {
    const owner = context.get('auth').id, after = pageAfter(owner, store.type, binding, query.cursor);
    const rows = await store.list(context.env.DB, owner, `(${filter}) AND (? IS NULL OR id>?)`, [...values, after, after], `id LIMIT ${query.limit + 1}`);
    return pageResult(rows, query.limit, owner, store.type, binding);
  }
  app.get('/api/v1/catalog/exercises', context => {
    const query = z.strictObject({ ...pageQueryFields, q: z.string().max(120).default(''), locale: localeSchema.default(context.get('auth').locale) }).parse(context.req.query());
    return read(context, () => searchExercises(context.env.DB, context.get('auth').id, query));
  });
  app.post('/api/v1/catalog/custom-exercises', async context => receipt(context, await createCustomExercise(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.get('/api/v1/exercise-setups', context => {
    const query = z.strictObject({ ...pageQueryFields, exerciseId: uuidSchema.optional() }).parse(context.req.query());
    return read(context, () => listing(context, setups, query, query.exerciseId ? 'exercise_id=?' : '1', query.exerciseId ? [query.exerciseId] : [], { exerciseId: query.exerciseId ?? null }));
  });
  app.post('/api/v1/exercise-setups', async context => receipt(context, await createSetup(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.patch('/api/v1/exercise-setups/:id', async context => { const headers = write(context, true); return receipt(context, await patchSetup(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), clock)); });
  app.get('/api/v1/plans', context => {
    const query = z.strictObject({ ...pageQueryFields, localDate: localDateSchema.default(localDateAt(clock(), context.get('auth').timezone)) }).parse(context.req.query());
    return read(context, async () => ({ ...await listing(context, plans, query, '1', [], { localDate: query.localDate }), activePlan: await readActivePlan(context.env.DB, context.get('auth').id, query.localDate), selection: await readPlanSelection(context.env.DB, context.get('auth').id, query.localDate) }));
  });
  app.post('/api/v1/plans', async context => receipt(context, await createPlan(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  for (const action of ['activate', 'archive'] as const) app.post(`/api/v1/plans/:id/${action}`, async context => {
    const headers = write(context, true); return receipt(context, await changePlanSelection(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), action, clock));
  });
  app.get('/api/v1/schedule', context => {
    const query = z.strictObject({ ...pageQueryFields, ...rangeFields, status: z.enum(['planned', 'skipped', 'moved', 'cancelled']).optional() }).parse(context.req.query()), bounds = range(context, query, 31);
    return read(context, async () => {
      const days = [];
      for (let day = bounds.from; day <= bounds.to; day = addDays(day, 1)) days.push(await readScheduleDay(context.env.DB, context.get('auth').id, day));
      return { ...await listing(context, schedules, query, `local_date BETWEEN ? AND ?${query.status ? ' AND status=?' : ''}`, [bounds.from, bounds.to, ...(query.status ? [query.status] : [])], query.status ? { ...bounds, status: query.status } : bounds), days };
    });
  });
  app.post('/api/v1/schedule', async context => receipt(context, await createSchedule(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.patch('/api/v1/schedule/:id', async context => { const headers = write(context, true); return receipt(context, await editSchedule(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), clock)); });
  app.delete('/api/v1/training/days/:date/:id/exercises/:exerciseId', async context => { const headers = write(context, true); return receipt(context, await editExercise(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, id(context, 'exerciseId'), body(context), true, clock, localDateSchema.parse(context.req.param('date')))); });
  app.get('/api/v1/training/days/:date', context => read(context, () => readTrainingDay(context.env.DB, context.get('auth').id, localDateSchema.parse(context.req.param('date')))));
  app.post('/api/v1/training/days/:date/sets', async context => receipt(context, await addDailySet(context.env.DB, context.get('auth'), write(context).operationId, localDateSchema.parse(context.req.param('date')), body(context), clock), true));
  for (const method of ['patch', 'delete'] as const) app[method]('/api/v1/training/days/:date/:id/sets/:setId', async context => {
    const headers = write(context, true);
    return receipt(context, await editSet(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, id(context, 'setId'), body(context), method === 'delete', clock, localDateSchema.parse(context.req.param('date'))));
  });
  app.get('/api/v1/training/sessions', context => {
    const query = z.strictObject({ ...pageQueryFields, ...rangeFields, status: z.enum(['draft', 'in_progress', 'paused', 'completed', 'recorded', 'cancelled']).optional() }).parse(context.req.query()), bounds = range(context, query);
    return read(context, () => listing(context, sessions, query, `local_date BETWEEN ? AND ?${query.status ? ' AND status=?' : ''}`, [bounds.from, bounds.to, ...(query.status ? [query.status] : [])], { ...bounds, status: query.status ?? null }));
  });
  app.post('/api/v1/training/sessions', async context => receipt(context, await createSession(context.env.DB, context.get('auth'), write(context).operationId, body(context), clock), true));
  app.get('/api/v1/training/sessions/:id', context => {
    const query = z.strictObject(pageQueryFields).parse(context.req.query()), sessionId = id(context), owner = context.get('auth').id;
    return read(context, async () => {
      const session = await sessions.read(context.env.DB, owner, sessionId), binding = { sessionId, revision: session.revision }, after = pageAfter(owner, 'session-tree', binding, query.cursor);
      const rows = await context.env.DB.prepare("SELECT id,type FROM (SELECT id,'session_exercise' AS type FROM session_exercises WHERE owner_id=? AND session_id=? AND deleted_at IS NULL UNION ALL SELECT s.id,'workout_set' AS type FROM workout_sets s JOIN session_exercises e ON e.owner_id=s.owner_id AND e.id=s.session_exercise_id WHERE e.owner_id=? AND e.session_id=? AND e.deleted_at IS NULL AND s.deleted_at IS NULL) WHERE (? IS NULL OR id>?) ORDER BY id LIMIT ?").bind(owner, sessionId, owner, sessionId, after, after, query.limit + 1).all<{ id: string; type: 'session_exercise' | 'workout_set' }>();
      const entities = await Promise.all(rows.results.map(async row => row.type === 'session_exercise' ? { ...row, value: await sessionExercises.read(context.env.DB, owner, row.id) } : { ...row, value: await sets.read(context.env.DB, owner, row.id) }));
      return { session, ...pageResult(entities, query.limit, owner, 'session-tree', binding) };
    });
  });
  app.patch('/api/v1/training/sessions/:id', async context => { const headers = write(context, true); return receipt(context, await patchSession(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), clock)); });
  app.delete('/api/v1/training/sessions/:id', async context => { const headers = write(context, true); empty.parse(body(context)); return receipt(context, await transitionSession(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, 'delete', clock)); });
  for (const action of ['pause', 'resume', 'finish', 'cancel'] as const) app.post(`/api/v1/training/sessions/:id/${action}`, async context => { const headers = write(context, true); empty.parse(body(context)); return receipt(context, await transitionSession(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, action, clock)); });
  app.post('/api/v1/training/sessions/:id/exercises', async context => { const headers = write(context, true); return receipt(context, await addExercise(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), clock), true); });
  app.post('/api/v1/training/sessions/:id/sets', async context => { const headers = write(context, true); return receipt(context, await addSet(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, body(context), clock), true); });
  for (const method of ['patch', 'delete'] as const) {
    app[method]('/api/v1/training/sessions/:id/exercises/:exerciseId', async context => { const headers = write(context, true); return receipt(context, await editExercise(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, id(context, 'exerciseId'), body(context), method === 'delete', clock)); });
    app[method]('/api/v1/training/sessions/:id/sets/:setId', async context => { const headers = write(context, true); return receipt(context, await editSet(context.env.DB, context.get('auth'), headers.operationId, id(context), headers.expectedRevision!, id(context, 'setId'), body(context), method === 'delete', clock)); });
  }
  app.get('/api/v1/training/history', context => {
    const query = z.strictObject({ ...rangeFields, setupId: uuidSchema, limit: pageQueryFields.limit.pipe(z.number().max(20)).default(5), cursor: pageQueryFields.cursor }).parse(context.req.query()), bounds = range(context, query);
    return read(context, () => trainingHistory(context.env.DB, context.get('auth').id, query.setupId, bounds.from, bounds.to, query.limit, query.cursor));
  });
  app.get('/api/v1/days/:date', context => { empty.parse(context.req.query()); return read(context, () => readDay(context.env.DB, context.get('auth').id, localDateSchema.parse(context.req.param('date')))); });
  app.patch('/api/v1/days/:date', async context => {
    const headers = write(context, context.req.header('If-Match') !== undefined);
    return receipt(context, await patchDayClaim(context.env.DB, context.get('auth'), headers.operationId, localDateSchema.parse(context.req.param('date')), headers.expectedRevision, body(context), clock));
  });
}
