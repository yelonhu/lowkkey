import type { ExecutionContext } from '@cloudflare/workers-types';
import { createApi } from '../../src/server/api.ts';
import type { AppBindings } from '../../src/server/api.ts';
import type { VerifiedIdentity } from '../../src/server/auth.ts';
import { localFixture } from './local-fixture.ts';

const sessions = new Map<string, VerifiedIdentity>();
const cookieName = 'lowkkey_local_session';
function cookie(request: Request) { return request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1); }
const api = createApi({ verifyIdentity: async request => {
  const identity = sessions.get(cookie(request) ?? '');
  if (!identity || !identity.session || identity.session.expiresAt <= new Date().toISOString()) throw new Error('AUTH_REQUIRED');
  return identity;
} });

export default { async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
  const url = new URL(request.url);
  if (!['development', 'test'].includes(env.APP_ENV ?? '') || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Response('DEVELOPMENT_IDENTITY_FORBIDDEN', { status: 403 });
  if (url.pathname === '/api/local/session' && request.method === 'POST') {
    if (request.headers.get('Origin') !== new URL(env.APP_ORIGIN).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return new Response(null, { status: 403 });
    if (request.headers.get('Content-Type') !== 'application/json' || await request.text() !== '{}') return new Response(null, { status: 400 });
    const now = Date.now();
    for (const [key, value] of sessions) if (!value.session || new Date(value.session.expiresAt).getTime() <= now) sessions.delete(key);
    const token = crypto.randomUUID();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    sessions.set(token, { issuer: localFixture.issuer, subject: localFixture.subject, email: localFixture.email, session: { hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), expiresAt: new Date(now + 8 * 3600000).toISOString() } });
    return Response.json({ status: 'authenticated' }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` } });
  }
  if (url.pathname === '/cdn-cgi/access/logout' && request.method === 'GET') {
    sessions.delete(cookie(request) ?? '');
    return new Response(null, { status: 303, headers: { Location: '/today', 'Cache-Control': 'no-store', 'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` } });
  }
  return api.fetch(request, env, context);
} };
