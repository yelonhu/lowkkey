import { Hono } from 'hono';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { z, ZodError } from 'zod';
import { customerAuth, ownerForRequest } from './customer-auth.ts';
import type { AuthBindings } from './customer-auth.ts';
import type { IdentityVerifier } from './auth.ts';
import { accountFor, StoreError } from './account.ts';
import * as store from './store.ts';

export type Bindings = AuthBindings & { OAUTH_PROVIDER?: OAuthHelpers };
type Environment = { Bindings: Bindings; Variables: { ownerId: string } };
function assertOrigin(request: Request, env: Bindings) {
  if (env.APP_ENV === 'production' && !env.APP_ORIGIN) throw new StoreError('ORIGIN_NOT_CONFIGURED', 503);
  if (request.headers.get('Origin') !== (env.APP_ORIGIN ?? 'http://127.0.0.1:5173') || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new StoreError('ORIGIN_REQUIRED', 403);
}
export function createApi(options: { verifyIdentity?: IdentityVerifier } = {}) {
  const app = new Hono<Environment>();
  app.get('/healthz', c => c.json({ status: 'ok', version: typeof __BUILD_SHA__ === 'undefined' ? 'development' : __BUILD_SHA__ }));
  app.get('/api/auth/config', c => c.json({
    mode: c.env.AUTH_MODE ?? 'access', local: c.env.AUTH_MODE !== 'customer' && ['test', 'development'].includes(c.env.APP_ENV ?? ''),
    google: !!c.env.GOOGLE_CLIENT_ID && !!c.env.GOOGLE_CLIENT_SECRET, email: !!c.env.RESEND_API_KEY && !!c.env.AUTH_EMAIL_FROM,
    aiConnection: c.env.AI_CONNECTION_ENABLED === '1' && c.env.AUTH_MODE === 'customer' && c.env.APP_ORIGIN?.startsWith('https://'),
  }, { headers: { 'Cache-Control': 'no-store' } }));
  app.on(['GET', 'POST'], '/api/auth/*', async c => {
    if (c.env.AUTH_MODE === 'customer') return customerAuth(c.env).handler(c.req.raw);
    if (c.req.path === '/api/auth/sign-out' && c.req.method === 'POST') {
      assertOrigin(c.req.raw, c.env);
      return c.json({ success: true, redirect: c.env.APP_ENV === 'production' ? '/cdn-cgi/access/logout' : null }, 200, { 'Set-Cookie': 'lowkkey_dev=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }
    throw new StoreError('NOT_FOUND', 404);
  });
  app.post('/api/local/session', c => {
    if (!['test', 'development'].includes(c.env.APP_ENV ?? '') || c.env.AUTH_MODE === 'customer') throw new StoreError('NOT_FOUND', 404);
    assertOrigin(c.req.raw, c.env);
    return c.json({ ok: true }, 200, { 'Set-Cookie': 'lowkkey_dev=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400', 'Cache-Control': 'no-store' });
  });
  app.use('/v1/*', async (c, next) => {
    const owner = options.verifyIdentity ? await accountFor(c.env.DB, await options.verifyIdentity(c.req.raw)) : await ownerForRequest(c.req.raw, c.env);
    c.set('ownerId', owner);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      assertOrigin(c.req.raw, c.env);
      const expected = c.req.header('X-Lowkkey-Account');
      if (c.env.AUTH_MODE === 'customer' && !expected) throw new StoreError('account_required', 409);
      if (expected && expected !== owner) throw new StoreError('account_mismatch', 409);
    }
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.get('/v1/state', async c => c.json(await store.state(c.env.DB, c.get('ownerId'))));
  app.post('/v1/preferences/theme', async c => { if (c.req.header('Content-Type')?.split(';')[0] !== 'application/json') throw new StoreError('JSON_REQUIRED'); const body = await c.req.text(); if (body.length > 1024) throw new StoreError('BODY_TOO_LARGE',413); let value:unknown; try { value=JSON.parse(body); } catch { throw new StoreError('INVALID_JSON'); } return c.json(await store.setTheme(c.env.DB,c.get('ownerId'),value)); });
  app.get('/v1/account', async c => {
    const user = await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(c.get('ownerId')).first<{ email: string }>();
    return c.json({ accountId: c.get('ownerId'), email: user?.email, mode: c.env.AUTH_MODE ?? 'access' });
  });
  app.get('/v1/export', async c => c.json({ format: 'lowkkey.showroom.v5', exportedAt: new Date().toISOString(), snapshot: await store.state(c.env.DB, c.get('ownerId')) }));
  app.get('/v1/clients', async c => c.json(await store.listClients(c.env.DB, c.get('ownerId'))));
  app.post('/v1/clients/:id/revoke', async c => {
    if (c.req.header('Content-Type')?.split(';')[0] !== 'application/json') throw new StoreError('JSON_REQUIRED');
    const body = await c.req.text();
    if (body.length > 1024) throw new StoreError('BODY_TOO_LARGE', 413);
    let parsed: unknown; try { parsed = JSON.parse(body); } catch { throw new StoreError('INVALID_JSON'); }
    z.strictObject({}).parse(parsed);
    const owner = c.get('ownerId'), id = c.req.param('id');
    const result = await store.revokeClient(c.env.DB, owner, id);
    const client = await store.oauthClient(c.env.DB, owner, id);
    if (client?.grant_id && c.env.OAUTH_PROVIDER) await c.env.OAUTH_PROVIDER.revokeGrant(client.grant_id, owner);
    return c.json(result);
  });
  app.onError((error, c) => {
    const status = error instanceof StoreError ? error.status : error instanceof ZodError ? 400 : 500;
    const code = error instanceof StoreError ? error.code : error instanceof ZodError ? 'invalid_arguments' : 'internal';
    if (status === 500) console.error('REQUEST_FAILED');
    c.header('Cache-Control', 'no-store');
    return Response.json({ error: { code, fields: error instanceof ZodError ? error.issues.map(issue => ({ path: issue.path, message: issue.message })) : error instanceof StoreError ? error.fields : undefined } }, { status, headers: { 'Cache-Control': 'no-store' } });
  });
  app.notFound(c => c.json({ error: { code: 'NOT_FOUND' } }, 404));
  return app;
}
