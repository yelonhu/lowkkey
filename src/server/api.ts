import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { accessVerifier, authentication } from './auth.ts';
import type { AuthContext, IdentityVerifier, VerifiedIdentity } from './auth.ts';
import { memberLookup } from './members.ts';
import { parseWriteHeaders } from '../domain/contracts.ts';
import { addDays, localDateAt, localDateSchema, uuidSchema } from '../domain/primitives.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { DomainError } from './errors.ts';
import { createWeight, deleteWeight, patchWeight, readWeight, undoWeight } from './weights.ts';
import { readOperation } from './commands.ts';
import { patchProfile, readProfile } from './profiles.ts';
import { createGoal, readGoal } from './goals.ts';
import { activateMember, changeMember, inviteMember, listMembers, sessionState } from './membership.ts';
import { checkSession, logoutSession } from './sessions.ts';
import { readConsistent } from './read-model.ts';
import { registerTrainingRoutes } from './training-api.ts';
import { undoTraining } from './training-undo.ts';
import { registerNutritionRoutes } from './nutrition-api.ts';
import { undoNutrition } from './nutrition-undo.ts';
import { registerArtifactRoutes } from './artifact-api.ts';
import { registerSyncRoutes } from './sync-api.ts';

export type AppBindings = { DB: D1Database; APP_ORIGIN: string; RESTORE_EPOCH: string; APP_ENV?: 'development' | 'test' | 'staging' | 'production'; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };
export type ApiEnvironment = { Bindings: AppBindings; Variables: { auth: AuthContext } };
type Options = { verifyIdentity?: (request: Request, bindings: AppBindings) => Promise<VerifiedIdentity>; clock?: () => Date };
const verifiers = new Map<string, IdentityVerifier>();
async function verifyAccess(request: Request, bindings: AppBindings) {
  if (!bindings.ACCESS_TEAM_DOMAIN || !bindings.ACCESS_AUD) throw new DomainError('AUTH_REQUIRED', 401);
  const key = JSON.stringify([bindings.ACCESS_TEAM_DOMAIN, bindings.ACCESS_AUD]);
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = accessVerifier({ teamDomain: bindings.ACCESS_TEAM_DOMAIN, audience: bindings.ACCESS_AUD });
    verifiers.set(key, verifier);
  }
  return verifier(request);
}
export function writeHeaders(headers: Headers, editing = false) {
  try { return parseWriteHeaders(headers, editing); }
  catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'writeHeaders' }); }
}
export function createApi(options: Options = {}) {
  const app = new Hono<ApiEnvironment>();
  const bodies = new WeakMap<Request, unknown>();
  const identities = new WeakMap<Request, VerifiedIdentity>();
  const identityFor = (request: Request) => { const identity = identities.get(request); if (!identity) throw new DomainError('AUTH_REQUIRED', 401); return identity; };
  const clock = options.clock ?? (() => new Date());
  const meta = (bindings: AppBindings, extra: Record<string, unknown> = {}) => ({ requestId: crypto.randomUUID(), serverTime: clock().toISOString(), restoreEpoch: uuidSchema.parse(bindings.RESTORE_EPOCH), ...extra });
  app.use('/api/*', async (context, next) => { context.header('Cache-Control', 'no-store'); context.header('X-Content-Type-Options', 'nosniff'); await next(); });
  app.get('/healthz', context => context.json({ status: 'ok' }, 200, { 'Cache-Control': 'no-store' }));
  app.use('/api/v1/*', async (context, next) => {
    let identity: VerifiedIdentity;
    try { identity = await (options.verifyIdentity ?? verifyAccess)(context.req.raw, context.env); }
    catch { throw new DomainError('AUTH_REQUIRED', 401); }
    if (context.req.path !== '/api/v1/session/logout') await checkSession(context.env.DB, identity, clock());
    identities.set(context.req.raw, identity);
    await next();
  });
  app.use('/api/v1/*', async (context, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
      const origin = context.req.header('Origin');
      if (origin !== new URL(context.env.APP_ORIGIN).origin || context.req.header('Sec-Fetch-Site') === 'cross-site') throw new DomainError('AUTH_REQUIRED', 401);
      if (context.req.header('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new DomainError('INVALID_INPUT', 400);
      const reader = context.req.raw.body?.getReader();
      if (!reader) throw new DomainError('INVALID_INPUT', 400);
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0, body = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 65536) { await reader.cancel(); throw new DomainError('INVALID_INPUT', 400, { reason: 'bodyTooLarge' }); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } catch (error) { if (error instanceof TypeError) throw new DomainError('INVALID_INPUT', 400); throw error; }
      finally { reader.releaseLock(); }
      bodies.set(context.req.raw, JSON.parse(body));
    }
    await next();
  });
  app.get('/api/v1/session', async context => {
    z.strictObject({}).parse(context.req.query());
    const state = await sessionState(context.env.DB, identityFor(context.req.raw), clock());
    return context.json({ data: { status: state.state, userId: state.member.id, email: state.member.email, invitationExpiresAt: state.state === 'invited' ? state.invitation.expiresAt : null }, meta: meta(context.env) });
  });
  app.post('/api/v1/session/activate', async context => {
    const headers = writeHeaders(context.req.raw.headers);
    const receipt = await activateMember(context.env.DB, identityFor(context.req.raw), headers.operationId, bodies.get(context.req.raw), clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) }, 201);
  });
  app.post('/api/v1/session/logout', async context => {
    const headers = writeHeaders(context.req.raw.headers);
    const receipt = await logoutSession(context.env.DB, identityFor(context.req.raw), headers.operationId, bodies.get(context.req.raw), clock, context.req.header('X-Account-Id'));
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) });
  });
  app.use('/api/v1/*', async (context, next) => authentication<AppBindings>(async request => identityFor(request), memberLookup(drizzle(context.env.DB), clock))(context, next));
  app.use('/api/v1/*', async (context, next) => {
    // A stale tab's queue may outlive a cookie/account switch. This header is
    // an assertion about the verified account, never an owner selector.
    const expectedOwner = context.req.header('X-Account-Id');
    if (expectedOwner !== undefined && expectedOwner !== context.get('auth').id) throw new DomainError('AUTH_REQUIRED', 401, { reason: 'accountChanged' });
    const expectedEpoch = context.req.header('X-Restore-Epoch');
    if (expectedEpoch !== undefined && expectedEpoch !== context.env.RESTORE_EPOCH) throw new DomainError('SYNC_CURSOR_EXPIRED', 410, { reason: 'restoreEpochChanged' });
    await next();
  });
  app.get('/api/v1/me', async context => {
    z.strictObject({}).parse(context.req.query());
    const readAt = clock();
    const result = await readConsistent(context.env.DB, context.get('auth').id, async () => {
      const profile = await readProfile(context.env.DB, context.get('auth').id);
      const timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, readAt);
      const today = localDateAt(readAt, timezone);
      return { profile, effectiveTimezone: timezone, localDate: today, goal: await readGoal(context.env.DB, profile.ownerId, today), nextGoal: await readGoal(context.env.DB, profile.ownerId, addDays(today, 1)), usage: null, environment: context.env.APP_ENV ?? null };
    });
    return context.json({ data: result.data, meta: meta(context.env, { revision: result.data.profile.revision, dataRevision: result.dataRevision }) });
  });
  app.patch('/api/v1/me', async context => {
    const headers = writeHeaders(context.req.raw.headers, true);
    const receipt = await patchProfile(context.env.DB, context.get('auth'), headers.operationId, headers.expectedRevision!, bodies.get(context.req.raw), clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision, revision: receipt.recordRefs[0].revision }) });
  });
  app.get('/api/v1/goals', async context => {
    const query = z.strictObject({ localDate: localDateSchema.optional() }).parse(context.req.query());
    const readAt = clock();
    const result = await readConsistent(context.env.DB, context.get('auth').id, async () => {
      const profile = await readProfile(context.env.DB, context.get('auth').id);
      const date = query.localDate ?? localDateAt(readAt, effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, readAt));
      return { goal: await readGoal(context.env.DB, profile.ownerId, date), localDate: date };
    });
    return context.json({ data: result.data, meta: meta(context.env, { dataRevision: result.dataRevision }) });
  });
  app.post('/api/v1/goals', async context => {
    const headers = writeHeaders(context.req.raw.headers);
    const receipt = await createGoal(context.env.DB, context.get('auth'), headers.operationId, bodies.get(context.req.raw), clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) }, 201);
  });
  app.get('/api/v1/admin/members', async context => {
    z.strictObject({}).parse(context.req.query());
    return context.json({ data: await listMembers(context.env.DB, context.get('auth')), meta: meta(context.env) });
  });
  app.post('/api/v1/admin/invitations', async context => {
    const headers = writeHeaders(context.req.raw.headers);
    const receipt = await inviteMember(context.env.DB, context.get('auth'), headers.operationId, bodies.get(context.req.raw), context.env.APP_ORIGIN, clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId }) }, 201);
  });
  app.patch('/api/v1/admin/members/:id', async context => {
    const headers = writeHeaders(context.req.raw.headers, true);
    const receipt = await changeMember(context.env.DB, context.get('auth'), headers.operationId, context.req.param('id'), headers.expectedRevision!, bodies.get(context.req.raw), clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId }) });
  });
  app.post('/api/v1/weights', async context => {
    const headers = writeHeaders(context.req.raw.headers);
    const receipt = await createWeight(context.env.DB, context.get('auth'), headers.operationId, bodies.get(context.req.raw), clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) }, 201);
  });
  app.get('/api/v1/weights/:id', async context => {
    const weight = await readWeight(context.env.DB, context.get('auth').id, uuidSchema.parse(context.req.param('id')));
    return context.json({ data: weight, meta: meta(context.env, { revision: weight.revision }) });
  });
  app.patch('/api/v1/weights/:id', async context => {
    const headers = writeHeaders(context.req.raw.headers, true);
    const receipt = await patchWeight(context.env.DB, context.get('auth'), headers.operationId, context.req.param('id'), headers.expectedRevision!, bodies.get(context.req.raw), clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) });
  });
  app.delete('/api/v1/weights/:id', async context => {
    const headers = writeHeaders(context.req.raw.headers, true);
    z.strictObject({}).parse(bodies.get(context.req.raw));
    const receipt = await deleteWeight(context.env.DB, context.get('auth'), headers.operationId, context.req.param('id'), headers.expectedRevision!, clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) });
  });
  app.get('/api/v1/operations/:id', async context => {
    const receipt = await readOperation(context.env.DB, context.get('auth').id, uuidSchema.parse(context.req.param('id')));
    if (!receipt) throw new DomainError('RECORD_NOT_FOUND', 404);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) });
  });
  app.post('/api/v1/operations/:id/undo', async context => {
    const headers = writeHeaders(context.req.raw.headers);
    z.strictObject({}).parse(bodies.get(context.req.raw));
    const id = uuidSchema.parse(context.req.param('id'));
    const operation = await context.env.DB.prepare('SELECT kind FROM command_operations WHERE owner_id=? AND operation_id=?').bind(context.get('auth').id, id).first<{ kind: string }>();
    if (!operation) throw new DomainError('RECORD_NOT_FOUND', 404);
    const receipt = await (operation.kind.startsWith('training.') ? undoTraining : operation.kind.startsWith('nutrition.') ? undoNutrition : undoWeight)(context.env.DB, context.get('auth'), headers.operationId, id, clock);
    return context.json({ data: receipt, meta: meta(context.env, { operationId: receipt.operationId, dataRevision: receipt.dataRevision }) });
  });
  registerTrainingRoutes(app, { bodies, clock, meta });
  registerNutritionRoutes(app, { bodies, clock, meta });
  registerArtifactRoutes(app, { clock, meta });
  registerSyncRoutes(app, { clock, meta });
  app.notFound(context => context.json({ error: { code: 'RECORD_NOT_FOUND', messageKey: 'errors.recordNotFound', retryable: false }, meta: { requestId: crypto.randomUUID() } }, 404));
  app.onError((error, context) => {
    const known = error instanceof DomainError ? error : error instanceof z.ZodError || error instanceof SyntaxError ? new DomainError('INVALID_INPUT', 400) : new DomainError('TEMPORARY_FAILURE', 503);
    const messageKeys: Record<string, string> = { ADMIN_REQUIRED: 'errors.adminRequired', INVITATION_EXPIRED: 'errors.invitationExpired', MEMBER_LIMIT_REACHED: 'errors.memberLimit', LAST_ADMIN_REQUIRED: 'errors.lastAdmin', AUTH_REQUIRED: 'errors.authRequired', MEMBER_SUSPENDED: 'errors.memberSuspended', RECORD_NOT_FOUND: 'errors.recordNotFound', TEMPORARY_FAILURE: 'errors.temporaryFailure', REVISION_CONFLICT: 'errors.recordChanged', NEEDS_CONFIRMATION: 'errors.needsConfirmation', IDEMPOTENCY_KEY_REUSED: 'errors.idempotencyReused', DUPLICATE_CANDIDATE: 'errors.duplicateCandidate' };
    return context.json({ error: { code: known.code, messageKey: messageKeys[known.code] ?? 'errors.invalidRequest', params: known.params, retryable: known.status === 503 }, meta: { requestId: crypto.randomUUID() } }, known.status);
  });
  return app;
}
