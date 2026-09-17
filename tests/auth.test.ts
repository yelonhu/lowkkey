import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Hono } from 'hono';
import { accessVerifier, authentication, normalizeEmail, subjectKey } from '../src/server/auth.ts';
import type { AuthEnvironment, Member } from '../src/server/auth.ts';
import { developmentIdentity } from './support/development-identity.ts';
const issuer = 'https://synthetic-team.cloudflareaccess.com';
const now = new Date('2026-09-16T12:00:00.000Z');
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;
const alice = { issuer, subject: 'synthetic-alice', email: 'alice@example.invalid' };
const bob = { issuer, subject: 'synthetic-bob', email: 'bob@example.invalid' };
const members: Member[] = [alice, bob].map((identity, index) => ({ id: index === 0 ? 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641' : '29a3d61a-d672-4359-834c-792af3bbce87', verifiedSubject: subjectKey(identity), emailNormalized: identity.email, role: index === 0 ? 'admin' : 'member', status: 'active', locale: 'en', timezone: 'America/Chicago' }));
beforeAll(async () => { pair = await generateKeyPair('RS256'); resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'synthetic-key', alg: 'RS256' }] }); });
async function token(options: { subject?: string; email?: string; issuer?: string; audience?: string; expiry?: number; wrongKey?: boolean; omitExpiry?: boolean } = {}) {
  const key = options.wrongKey ? (await generateKeyPair('RS256')).privateKey : pair.privateKey;
  let jwt = new SignJWT({ email: options.email ?? alice.email }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).setSubject(options.subject ?? alice.subject).setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? 'synthetic-audience').setIssuedAt(Math.floor(now.getTime() / 1000));
  if (!options.omitExpiry) jwt = jwt.setExpirationTime(options.expiry ?? Math.floor(now.getTime() / 1000) + 60);
  return jwt.sign(key);
}
function app(rows = members) {
  const application = new Hono<AuthEnvironment>();
  application.use('*', authentication(accessVerifier({ teamDomain: 'synthetic-team.cloudflareaccess.com', audience: 'synthetic-audience' }, resolver, () => now), async key => rows.find(member => member.verifiedSubject === key) ?? null));
  application.all('/test-only', context => context.json(context.get('auth')));
  return application;
}
describe('Access verification and member authorization skeleton', () => {
  it('ignores forged owner/email headers and binds identity on the server', async () => {
    const response = await app().request('/test-only', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await token(), 'Cf-Access-Authenticated-User-Email': bob.email, 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: members[1].id }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ id: members[0].id, role: 'admin', locale: 'en', timezone: 'America/Chicago', status: 'active' });
  });
  it('rejects an email header without JWT', async () => expect((await app().request('/test-only', { headers: { 'Cf-Access-Authenticated-User-Email': alice.email } })).status).toBe(401));
  it.each([{ issuer: 'https://attacker.invalid' }, { audience: 'wrong' }, { expiry: 1 }, { wrongKey: true }, { omitExpiry: true }, { subject: 'uninvited' }, { email: bob.email }])('rejects invalid identity %j', async options => {
    expect((await app().request('/test-only', { headers: { 'Cf-Access-Jwt-Assertion': await token(options) } })).status).toBe(401);
  });
  it.each(['invited', 'suspended', 'deletion_pending', 'deleted'] as const)('rejects %s membership', async status => expect((await app([{ ...members[0], status }]).request('/test-only', { headers: { 'Cf-Access-Jwt-Assertion': await token() } })).status).toBe(403));
  it('keeps simultaneous members separate', async () => {
    const application = app();
    const tokens = await Promise.all([token(), token({ subject: bob.subject, email: bob.email })]);
    const responses = await Promise.all(tokens.map(async jwt => { const response = await application.request('/test-only', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }); return await response.json() as { id: string }; }));
    expect(responses.map(response => response.id)).toEqual(members.map(member => member.id));
  });
  it('never merges Gmail dots or plus aliases', () => expect(normalizeEmail(' A.B+tag@gmail.com ')).toBe('a.b+tag@gmail.com'));
  it('keeps local identities exclusively in development/test', async () => {
    expect(await developmentIdentity('test', alice)(new Request('http://localhost'))).toEqual(alice);
    for (const environment of ['staging', 'production', '']) expect(() => developmentIdentity(environment, alice)).toThrow('DEVELOPMENT_IDENTITY_FORBIDDEN');
  });
  it('rejects arbitrary JWKS hosts from configuration', () => expect(() => accessVerifier({ teamDomain: 'attacker.invalid/path', audience: 'a' })).toThrow('INVALID_ACCESS_CONFIG'));
});
