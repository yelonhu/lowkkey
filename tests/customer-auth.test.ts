import { googleAttempt, googleLogin } from './google-auth-helper.ts';
import { beginDeletion, cleanupDeletions } from '../src/server/lifecycle.ts';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, readdir, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { customerAuth, ownerForRequest } from '../src/server/customer-auth.ts';
import type { AuthBindings } from '../src/server/customer-auth.ts';
import { createApi } from '../src/server/api.ts';
const directory = `.data/auth-test/${crypto.randomUUID()}`,
  origin = 'http://127.0.0.1:5370';
let mf: Miniflare, env: AuthBindings;
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-30',
    cf: false,
    host: '127.0.0.1',
    d1Databases: { DB: '11111111-1111-4111-8111-111111111111' },
    d1Persist: `${directory}/d1`,
    outboundService: () => {
      throw new Error('no outbound');
    },
  });
  env = {
    DB: (await mf.getD1Database('DB')) as D1Database,
    APP_ENV: 'test',
    AUTH_MODE: 'customer',
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: 'test-only-secret-never-use-in-production-123456',
  };
  for (const name of (await readdir('db/showroom-migrations')).filter(n => n.endsWith('.sql')).sort())
    await env.DB.batch(
      (await readFile(`db/showroom-migrations/${name}`, 'utf8'))
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(Boolean)
        .map(sql => env.DB.prepare(sql)),
    );
});
afterAll(async () => {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
});
const request = (path: string, body?: unknown, cookie = '') =>
  new Request(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'cf-connecting-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const login = (email: string) => googleLogin(env, email);
describe('open Google authentication on isolated D1', () => {
  it('registers without invitations, repeats the same identity and isolates accounts', async () => {
    const cookie = await login('one@example.com'),
      owner = await ownerForRequest(request('/v1/state', undefined, cookie), env);
    expect(await ownerForRequest(request('/v1/state', undefined, await login('one@example.com')), env)).toBe(owner);
    expect((await env.DB.prepare('SELECT count(*) n FROM auth_invites').first<{ n: number }>())?.n).toBe(0);
    const wrong = request('/v1/clients/other/revoke', {}, await login('two@example.com'));
    wrong.headers.set('X-Lowkkey-Account', owner);
    expect((await createApi().fetch(wrong, env)).status).toBe(409);
    expect((await customerAuth(env).handler(request('/api/auth/sign-out', {}, cookie))).ok).toBe(true);
    await expect(ownerForRequest(request('/v1/state', undefined, cookie), env)).rejects.toThrow('unauthorized');
  });
  it('rejects cancelled, invalid, replayed and unverified Google callbacks', async () => {
    for (const options of [{ cancel: true }, { invalidState: true }, { invalidCode: true }, { verified: false }]) {
      const result = await googleAttempt(env, 'rejected@example.com', options);
      expect(result.cookie).not.toContain('session_token');
      expect(result.response.headers.get('Location')).not.toBe(origin + '/#next');
    }
    const valid = await googleAttempt(env, 'replay@example.com');
    const replay = await valid.auth.handler(new Request(valid.callback, { headers: { Cookie: valid.cookieBefore } }));
    expect(replay.headers.get('Set-Cookie') ?? '').not.toContain('session_token');
  });
  it('never merges a different Google subject sharing an email', async () => {
    await login('same@example.com');
    const result = await googleAttempt(env, 'same@example.com', { subject: 'another-google-identity' });
    expect(result.cookie).not.toContain('session_token');
  });
  it('disables email login and account linking and rejects local or foreign-origin bypasses', async () => {
    const auth = customerAuth(env);
    for (const path of ['/email-otp/send-verification-otp', '/sign-in/email-otp', '/link-social', '/unlink-account'])
      expect(
        (
          await auth.handler(
            request('/api/auth' + path, {
              email: 'one@example.com',
              otp: '123456',
              provider: 'google',
              providerId: 'google',
            }),
          )
        ).ok,
      ).toBe(false);
    await expect(ownerForRequest(request('/v1/state', undefined, 'lowkkey_dev=1'), env)).rejects.toThrow(
      'unauthorized',
    );
    const foreign = request('/api/auth/sign-out', {});
    foreign.headers.set('Origin', 'https://foreign.invalid');
    expect((await auth.handler(foreign)).status).toBe(403);
    const config = (await (await createApi().fetch(request('/api/auth/config'), env)).json()) as {
      email: boolean;
      google: boolean;
    };
    expect(config.email).toBe(false);
    expect(config.google).toBe(false);
  });
  it('expires sessions and revokes other devices', async () => {
    const first = await login('devices@example.com'),
      second = await login('devices@example.com');
    expect((await customerAuth(env).handler(request('/api/auth/revoke-other-sessions', {}, second))).ok).toBe(true);
    await expect(ownerForRequest(request('/v1/state', undefined, first), env)).rejects.toThrow('unauthorized');
    expect(await ownerForRequest(request('/v1/state', undefined, second), env)).toBeTruthy();
    await env.DB.prepare('UPDATE auth_session SET expiresAt=0 WHERE userId IN (SELECT id FROM auth_user WHERE email=?)')
      .bind('devices@example.com')
      .run();
    await expect(ownerForRequest(request('/v1/state', undefined, second), env)).rejects.toThrow('unauthorized');
  });
  it('blocks Google login while a deletion job is pending', async () => {
    const cookie = await login('pending@example.com'),
      owner = await ownerForRequest(request('/v1/state', undefined, cookie), env);
    const user = await env.DB.prepare('SELECT id FROM auth_user WHERE email=?')
      .bind('pending@example.com')
      .first<{ id: string }>();
    await beginDeletion(env.DB, owner, user!.id, 'pending@example.com');
    expect((await googleAttempt(env, 'pending@example.com')).cookie).not.toContain('session_token');
    await expect(ownerForRequest(request('/v1/state', undefined, cookie), env)).rejects.toThrow('unauthorized');
    await cleanupDeletions(env.DB);
  });
  it('requires fresh deletion and creates a new empty owner after cleanup', async () => {
    let cookie = await login('delete@example.com');
    const owner = await ownerForRequest(request('/v1/state', undefined, cookie), env),
      app = createApi();
    const post = (body: unknown) => {
      const req = request('/v1/account/delete', body, cookie);
      req.headers.set('X-Lowkkey-Account', owner);
      return app.fetch(req, env);
    };
    await env.DB.prepare('UPDATE auth_session SET createdAt=? WHERE userId IN (SELECT id FROM auth_user WHERE email=?)')
      .bind(Date.now() - 600000, 'delete@example.com')
      .run();
    expect((await post({ confirm: 'DELETE' })).status).toBe(403);
    cookie = await login('delete@example.com');
    expect((await post({ confirm: 'wrong' })).status).toBe(400);
    expect((await post({ confirm: 'DELETE' })).status).toBe(200);
    await expect(ownerForRequest(request('/v1/state', undefined, cookie), env)).rejects.toThrow('unauthorized');
    await cleanupDeletions(env.DB);
    const newOwner = await ownerForRequest(request('/v1/state', undefined, await login('delete@example.com')), env);
    expect(newOwner).not.toBe(owner);
    expect(await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(owner).first()).toBeNull();
    expect(
      (
        await env.DB.prepare('SELECT count(*) n FROM daily_notes WHERE owner_id=?')
          .bind(newOwner)
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  }, 15_000); // Three full Google sign-ins plus deletion exceed 5s on slower CI hosts.
});

describe('privacy belongs to an authenticated account', () => {
  it('blocks first use, preserves export and checks version, origin and account', async () => {
    const cookie = await login('one@example.com'),
      app = createApi();
    const account = (await (await app.fetch(request('/v1/account', undefined, cookie), env)).json()) as {
      accountId: string;
      privacy: { acceptedAt: string | null };
    };
    expect(account.privacy.acceptedAt).toBeNull();
    expect((await app.fetch(request('/v1/state', undefined, cookie), env)).status).toBe(403);
    expect((await app.fetch(request('/v1/export', undefined, cookie), env)).status).toBe(200);
    const post = (body: unknown, owner = account.accountId, originValue = origin) => {
      const req = request('/v1/account/consent', body, cookie);
      req.headers.set('X-Lowkkey-Account', owner);
      req.headers.set('Origin', originValue);
      return app.fetch(req, env);
    };
    expect((await post({ accepted: true, version: 'old' })).status).toBe(400);
    expect((await post({ accepted: false, version: '2026-10-13-notes-write' })).status).toBe(400);
    expect((await post({ accepted: true, version: '2026-10-13-notes-write' }, 'wrong')).status).toBe(409);
    expect(
      (await post({ accepted: true, version: '2026-10-13-notes-write' }, account.accountId, 'https://foreign.invalid'))
        .status,
    ).toBe(403);
    const first = await (await post({ accepted: true, version: '2026-10-13-notes-write' })).json();
    expect(await (await post({ accepted: true, version: '2026-10-13-notes-write' })).json()).toEqual(first);
    expect((await app.fetch(request('/v1/state', undefined, cookie), env)).status).toBe(200);
  });
  it('carries a one-use pre-login intent across the callback, without consenting a second account', async () => {
    const app = createApi(),
      intent = await app.fetch(
        request('/api/privacy/intent', { accepted: true, version: '2026-10-13-notes-write' }),
        env,
      );
    expect(intent.status).toBe(200);
    expect(intent.headers.get('Set-Cookie')).toContain('HttpOnly');
    const token = intent.headers.get('Set-Cookie')!.split(';')[0],
      one = await login('two@example.com');
    const first = (await (await app.fetch(request('/v1/account', undefined, one + '; ' + token), env)).json()) as {
      privacy: { acceptedAt: string | null };
    };
    expect(first.privacy.acceptedAt).toBeTruthy();
    // A new identity cannot reuse the first identity's consumed consent intent.
    const another = await login('mail@example.com');
    const second = (await (await app.fetch(request('/v1/account', undefined, another + '; ' + token), env)).json()) as {
      privacy: { acceptedAt: string | null };
    };
    expect(second.privacy.acceptedAt).toBeNull();
    const expired = await app.fetch(
      request('/api/privacy/intent', { accepted: true, version: '2026-10-13-notes-write' }),
      env,
    );
    await env.DB.prepare("UPDATE privacy_intents SET expires_at='2000-01-01'").run();
    const third = (await (
      await app.fetch(
        request('/v1/account', undefined, another + '; ' + expired.headers.get('Set-Cookie')!.split(';')[0]),
        env,
      )
    ).json()) as { privacy: { acceptedAt: string | null } };
    expect(third.privacy.acceptedAt).toBeNull();
  });
});
