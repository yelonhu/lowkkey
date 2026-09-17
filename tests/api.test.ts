import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { D1Database } from '@cloudflare/workers-types';
import { createApi } from '../src/server/api.ts';
import { accessVerifier, subjectKey } from '../src/server/auth.ts';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87', epoch = 'fa682cd1-1d70-4f27-87f0-4b143f53b624';
const now = new Date('2026-09-16T20:00:00.000Z'), issuer = 'https://synthetic-team.cloudflareaccess.com';
const origin = 'http://127.0.0.1:5173';
let runtime: ReturnType<typeof localRuntime>, db: D1Database, app: ReturnType<typeof createApi>, pair: Awaited<ReturnType<typeof generateKeyPair>>;
async function token(id = owner) {
  return new SignJWT({ email: `${id}@example.invalid` }).setProtectedHeader({ alg: 'RS256', kid: 'local-test' }).setSubject(id).setIssuer(issuer).setAudience('local-audience').setIssuedAt(Math.floor(now.getTime() / 1000)).setExpirationTime(Math.floor(now.getTime() / 1000) + 60).sign(pair.privateKey);
}
const input = () => ({ id: crypto.randomUUID(), localDate: '2026-09-16', entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date', value: '70', unit: 'kg', condition: 'unspecified' });
const bindings = () => ({ DB: db, RESTORE_EPOCH: epoch, APP_ORIGIN: origin });
beforeAll(async () => {
  runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db);
  pair = await generateKeyPair('RS256');
  const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'local-test', alg: 'RS256' }] });
  app = createApi({ verifyIdentity: accessVerifier({ teamDomain: 'synthetic-team.cloudflareaccess.com', audience: 'local-audience' }, resolver, () => now), clock: () => now });
});
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  await db.batch(['DELETE FROM change_batches', 'DELETE FROM operation_revisions', 'DELETE FROM command_operations', 'DELETE FROM mutation_guards', 'DELETE FROM weight_entries', 'DELETE FROM users'].map(sql => db.prepare(sql)));
  for (const id of [owner, other]) await db.prepare("INSERT INTO users(id,verified_subject,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,?,'member','active','en','America/Chicago',?)").bind(id, subjectKey({ issuer, subject: id }), `${id}@example.invalid`, now.toISOString()).run();
});
async function headers(id = owner) { return { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'Cf-Access-Jwt-Assertion': await token(id) }; }
describe('authenticated weight API', () => {
  it('commits a write and exposes its owner-bound immutable operation receipt', async () => {
    const entry = input(), requestHeaders = await headers();
    const response = await app.request('/api/v1/weights', { method: 'POST', headers: requestHeaders, body: JSON.stringify(entry) }, bindings());
    expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const saved = await response.json();
    expect(saved.meta).toMatchObject({ restoreEpoch: epoch, dataRevision: 1, operationId: requestHeaders['Idempotency-Key'] });
    const receipt = await app.request(`/api/v1/operations/${requestHeaders['Idempotency-Key']}`, { headers: await headers() }, bindings());
    expect((await receipt.json()).data).toEqual(saved.data);
    const foreign = await app.request(`/api/v1/weights/${entry.id}`, { headers: await headers(other) }, bindings());
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { code: 'RECORD_NOT_FOUND', messageKey: 'errors.recordNotFound', params: {}, retryable: false }, meta: { requestId: expect.any(String) } });
  });
  it('does not accept standalone email headers or signed non-members', async () => {
    const forged = await app.request('/api/v1/weights', { method: 'POST', headers: { 'Cf-Access-Authenticated-User-Email': `${owner}@example.invalid` }, body: '{}' }, bindings());
    expect(forged.status).toBe(401);
    expect((await app.request('/api/v1/weights', { method: 'POST', headers: await headers(crypto.randomUUID()), body: '{}' }, bindings())).status).toBe(401);
  });
  it('enforces same-origin writes independently of authentication', async () => {
    const trusted = await headers();
    const patches: Array<Record<string, string>> = [{ Origin: 'https://attacker.invalid' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const patch of patches) {
      expect((await app.request('/api/v1/weights', { method: 'POST', headers: { ...trusted, ...patch }, body: JSON.stringify(input()) }, bindings())).status).toBe(401);
    }
    expect(await db.prepare('SELECT COUNT(*) AS n FROM weight_entries').first('n')).toBe(0);
  });
  it('rejects missing versions, mass assignment and malformed JSON with no effects', async () => {
    const entry = input();
    for (const body of [JSON.stringify({ ...entry, ownerId: other }), JSON.stringify({ ...entry, role: 'admin' }), '{']) {
      const response = await app.request('/api/v1/weights', { method: 'POST', headers: await headers(), body }, bindings());
      expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('INVALID_INPUT');
    }
    await app.request('/api/v1/weights', { method: 'POST', headers: await headers(), body: JSON.stringify(entry) }, bindings());
    const response = await app.request(`/api/v1/weights/${entry.id}`, { method: 'PATCH', headers: await headers(), body: JSON.stringify({ value: '71' }) }, bindings());
    expect(response.status).toBe(400);
    expect(await db.prepare('SELECT revision FROM weight_entries WHERE id=?').bind(entry.id).first('revision')).toBe(1);
  });
  it('does not provide an event or Artifact mutation route', async () => {
    for (const path of ['/api/v1/events', '/api/v1/artifacts']) {
      const response = await app.request(path, { method: 'POST', headers: await headers(), body: '{}' }, bindings());
      expect(response.status).toBe(404);
    }
  });
  it('rejects oversized bodies and misleading JSON media types', async () => {
    const large = await app.request('/api/v1/weights', { method: 'POST', headers: await headers(), body: JSON.stringify({ text: 'x'.repeat(65536) }) }, bindings());
    expect(large.status).toBe(400);
    const wrongType = await app.request('/api/v1/weights', { method: 'POST', headers: { ...await headers(), 'Content-Type': 'application/json-invalid' }, body: '{}' }, bindings());
    expect(wrongType.status).toBe(400);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM command_operations').first('n')).toBe(0);
  });
  it('protects original health facts when a user retries a stale edit', async () => {
    const entry = input(); await app.request('/api/v1/weights', { method: 'POST', headers: await headers(), body: JSON.stringify(entry) }, bindings());
    const first = await app.request(`/api/v1/weights/${entry.id}`, { method: 'PATCH', headers: { ...await headers(), 'If-Match': '"1"' }, body: JSON.stringify({ value: '71' }) }, bindings());
    expect(first.status).toBe(200);
    const stale = await app.request(`/api/v1/weights/${entry.id}`, { method: 'PATCH', headers: { ...await headers(), 'If-Match': '"1"' }, body: JSON.stringify({ value: '72' }) }, bindings());
    expect(stale.status).toBe(409); expect((await stale.json()).error.code).toBe('REVISION_CONFLICT');
    expect(await db.prepare('SELECT value_decimal FROM weight_entries WHERE id=?').bind(entry.id).first('value_decimal')).toBe('71');
  });
});
