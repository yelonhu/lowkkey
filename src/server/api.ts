import { Hono } from 'hono';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { AccountDeleteInput, ProductEventInput, PRIVACY_VERSION } from '@lowkkey/protocol';
import { acceptConsent, consentStatus, createConsentIntent, requireConsent } from './privacy.ts';
import * as lifecycle from './lifecycle.ts';
import { z, ZodError } from 'zod';
import { customerAuth, customerSession, requireFresh, ownerForRequest } from './customer-auth.ts';
import type { AuthBindings } from './customer-auth.ts';
import type { IdentityVerifier } from './auth.ts';
import { accountFor, StoreError } from './account.ts';
import * as store from './store.ts';
import * as notes from './notes.ts';

export type Bindings = AuthBindings & { OAUTH_PROVIDER?: OAuthHelpers };
type Environment = { Bindings: Bindings; Variables: { ownerId: string } };
function assertOrigin(request: Request, env: Bindings) {
  if (env.APP_ENV === 'production' && !env.APP_ORIGIN) throw new StoreError('ORIGIN_NOT_CONFIGURED', 503);
  if (
    request.headers.get('Origin') !== (env.APP_ORIGIN ?? 'http://127.0.0.1:5173') ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new StoreError('ORIGIN_REQUIRED', 403);
}
export function createApi(options: { verifyIdentity?: IdentityVerifier } = {}) {
  const app = new Hono<Environment>();
  app.get('/healthz', c =>
    c.json({ status: 'ok', version: typeof __BUILD_SHA__ === 'undefined' ? 'development' : __BUILD_SHA__ }),
  );
  app.get('/api/privacy', c =>
    c.json(
      { version: PRIVACY_VERSION, contact: c.env.PRIVACY_CONTACT_EMAIL ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    ),
  );
  const privacyConfigured = (env: Bindings) => {
    if (env.APP_ENV === 'production' && (!env.PRIVACY_CONTACT_EMAIL || !/^.+@.+\..+$/.test(env.PRIVACY_CONTACT_EMAIL)))
      throw new StoreError('privacy_not_configured', 503);
  };
  app.post('/api/privacy/intent', async c => {
    privacyConfigured(c.env);
    assertOrigin(c.req.raw, c.env);
    const cookie = await createConsentIntent(
      c.env.DB,
      await jsonBody(c.req.raw),
      !!c.env.APP_ORIGIN?.startsWith('https:'),
    );
    return c.json({ ok: true }, 200, { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
  });
  app.get('/api/auth/config', c =>
    c.json(
      {
        mode: c.env.AUTH_MODE ?? 'access',
        local: c.env.AUTH_MODE !== 'customer' && ['test', 'development'].includes(c.env.APP_ENV ?? ''),
        google: !!c.env.GOOGLE_CLIENT_ID && !!c.env.GOOGLE_CLIENT_SECRET,
        email: false,
        aiConnection:
          c.env.AI_CONNECTION_ENABLED === '1' &&
          c.env.AUTH_MODE === 'customer' &&
          c.env.APP_ORIGIN?.startsWith('https://'),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    ),
  );
  app.on(['GET', 'POST'], '/api/auth/*', async c => {
    if (c.env.AUTH_MODE === 'customer') {
      return customerAuth(c.env).handler(c.req.raw);
    }
    if (c.req.path === '/api/auth/sign-out' && c.req.method === 'POST') {
      assertOrigin(c.req.raw, c.env);
      return c.json(
        { success: true, redirect: c.env.APP_ENV === 'production' ? '/cdn-cgi/access/logout' : null },
        200,
        { 'Set-Cookie': 'lowkkey_dev=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' },
      );
    }
    throw new StoreError('NOT_FOUND', 404);
  });
  app.post('/api/local/session', c => {
    if (!['test', 'development'].includes(c.env.APP_ENV ?? '') || c.env.AUTH_MODE === 'customer')
      throw new StoreError('NOT_FOUND', 404);
    assertOrigin(c.req.raw, c.env);
    return c.json({ ok: true }, 200, {
      'Set-Cookie': 'lowkkey_dev=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400',
      'Cache-Control': 'no-store',
    });
  });
  app.use('/v1/*', async (c, next) => {
    const owner = options.verifyIdentity
      ? await accountFor(c.env.DB, await options.verifyIdentity(c.req.raw))
      : await ownerForRequest(c.req.raw, c.env);
    c.set('ownerId', owner);
    const expected = c.req.header('X-Lowkkey-Account');
    if (expected && expected !== owner) throw new StoreError('account_mismatch', 409);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      assertOrigin(c.req.raw, c.env);
      if (c.env.AUTH_MODE === 'customer' && !expected) throw new StoreError('account_required', 409);
    }
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const path = c.req.path;
    if (
      c.env.AUTH_MODE === 'customer' &&
      !['/v1/account', '/v1/account/consent', '/v1/export', '/v1/account/delete', '/v1/clients'].includes(path) &&
      !/^\/v1\/clients\/[^/]+\/revoke$/.test(path)
    )
      await requireConsent(c.env.DB, owner);
    await next();
  });
  app.get('/v1/notes', async c => {
    const query: Record<string, unknown> = { ...c.req.query() };
    if (query.limit !== undefined) query.limit = Number(query.limit);
    else if (!query.date) query.limit = 30;
    return c.json(await notes.readNotes(c.env.DB, c.get('ownerId'), query));
  });
  app.get('/v1/notes/:date', async c => c.json(await notes.readNote(c.env.DB, c.get('ownerId'), c.req.param('date'))));
  app.put('/v1/notes/:date', async c =>
    c.json(
      await notes.saveNote(c.env.DB, c.get('ownerId'), c.req.param('date'), await jsonBody(c.req.raw, 128 * 1024)),
    ),
  );
  app.get('/v1/state', async c => c.json(await store.state(c.env.DB, c.get('ownerId'))));
  app.get('/v1/account', async c => {
    const user = await c.env.DB.prepare('SELECT email,timezone,timezone_initialized FROM users WHERE id=?')
      .bind(c.get('ownerId'))
      .first<{ email: string; timezone: string; timezone_initialized: number }>();
    const session = c.env.AUTH_MODE === 'customer' ? await customerSession(c.req.raw, c.env) : null;
    const providers = session
      ? (
          await c.env.DB.prepare('SELECT providerId FROM auth_account WHERE userId=?')
            .bind(session.user.id)
            .all<{ providerId: string }>()
        ).results.map(p => p.providerId)
      : [];
    return c.json({
      privacy: await consentStatus(c.env.DB, c.get('ownerId')),
      accountId: c.get('ownerId'),
      email: user?.email,
      mode: c.env.AUTH_MODE ?? 'access',
      timezone: user?.timezone ?? 'America/Chicago',
      timezoneInitialized: !!user?.timezone_initialized,
      providers,
      fresh: !!session && Date.now() - new Date(session.session.createdAt).getTime() < 300000,
    });
  });
  async function jsonBody(request: Request, max = 2048) {
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
      throw new StoreError('JSON_REQUIRED');
    const body = await request.text();
    if (new TextEncoder().encode(body).length > max) throw new StoreError('BODY_TOO_LARGE', 413);
    try {
      return JSON.parse(body);
    } catch {
      throw new StoreError('INVALID_JSON');
    }
  }
  app.post('/v1/account/consent', async c => {
    privacyConfigured(c.env);
    return c.json(await acceptConsent(c.env.DB, c.get('ownerId'), await jsonBody(c.req.raw)));
  });
  app.get('/v1/onboarding', async c => c.json(await lifecycle.onboarding(c.env.DB, c.get('ownerId'))));
  app.post('/v1/onboarding', async c =>
    c.json(await lifecycle.updateOnboarding(c.env.DB, c.get('ownerId'), await jsonBody(c.req.raw))),
  );
  app.post('/v1/account/preferences', async c =>
    c.json(await lifecycle.preferences(c.env.DB, c.get('ownerId'), await jsonBody(c.req.raw))),
  );
  app.post('/v1/onboarding/events', async c => {
    const input = ProductEventInput.parse(await jsonBody(c.req.raw));
    if (input.event !== 'returned' || (await lifecycle.onboarding(c.env.DB, c.get('ownerId'))).hasContent)
      await lifecycle.event(c.env.DB, c.get('ownerId'), input.event);
    return c.json({ ok: true });
  });
  app.post('/v1/account/delete', async c => {
    if (c.env.AUTH_MODE !== 'customer') throw new StoreError('NOT_FOUND', 404);
    AccountDeleteInput.parse(await jsonBody(c.req.raw));
    const session = await customerSession(c.req.raw, c.env);
    requireFresh(session);
    await lifecycle.beginDeletion(c.env.DB, c.get('ownerId'), session.user.id, session.user.email);
    await lifecycle.cleanupDeletions(
      c.env.DB,
      c.env.OAUTH_PROVIDER ? (grant, owner) => c.env.OAUTH_PROVIDER!.revokeGrant(grant, owner) : undefined,
    );
    return c.json({ ok: true });
  });
  app.get('/v1/export', async c =>
    c.json({
      format: 'lowkkey.showroom.v5',
      exportedAt: new Date().toISOString(),
      snapshot: await store.state(c.env.DB, c.get('ownerId')),
      notes: await notes.exportNotes(c.env.DB, c.get('ownerId')),
    }),
  );
  app.get('/v1/clients', async c => c.json(await store.listClients(c.env.DB, c.get('ownerId'))));
  app.post('/v1/clients/:id/revoke', async c => {
    if (c.req.header('Content-Type')?.split(';')[0] !== 'application/json') throw new StoreError('JSON_REQUIRED');
    const body = await c.req.text();
    if (body.length > 1024) throw new StoreError('BODY_TOO_LARGE', 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new StoreError('INVALID_JSON');
    }
    z.strictObject({}).parse(parsed);
    const owner = c.get('ownerId'),
      id = c.req.param('id');
    const result = await store.revokeClient(c.env.DB, owner, id);
    const client = await store.oauthClient(c.env.DB, owner, id);
    if (client?.grant_id && c.env.OAUTH_PROVIDER) await c.env.OAUTH_PROVIDER.revokeGrant(client.grant_id, owner);
    return c.json(result);
  });
  app.onError((error, c) => {
    const status = error instanceof StoreError ? error.status : error instanceof ZodError ? 400 : 500;
    const code =
      error instanceof StoreError ? error.code : error instanceof ZodError ? 'invalid_arguments' : 'internal';
    if (status === 500) console.error('REQUEST_FAILED');
    c.header('Cache-Control', 'no-store');
    return Response.json(
      {
        error: {
          code,
          fields:
            error instanceof ZodError
              ? error.issues.map(issue => ({ path: issue.path, message: issue.message }))
              : error instanceof StoreError
                ? error.fields
                : undefined,
        },
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  });
  app.notFound(c => c.json({ error: { code: 'NOT_FOUND' } }, 404));
  return app;
}
