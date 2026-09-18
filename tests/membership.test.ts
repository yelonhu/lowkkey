import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import { createApi } from '../src/server/api.ts';
import { accessVerifier, subjectKey } from '../src/server/auth.ts';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { nextProfileNoon, localNoon } from '../src/domain/time.ts';
import { goalSnapshotSchema } from '../src/domain/profile.ts';
import { readConsistent } from '../src/server/read-model.ts';

const admin = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', invited = '29a3d61a-d672-4359-834c-792af3bbce87', other = 'fa682cd1-1d70-4f27-87f0-4b143f53b624';
const epoch = 'b5d4131b-f7ae-4e97-b572-bcabaf9527f1', origin = 'http://127.0.0.1:5173', issuer = 'https://synthetic-team.cloudflareaccess.com';
const start = '2026-09-16T20:00:00.000Z';
let now: Date, runtime: ReturnType<typeof localRuntime>, db: D1Database, app: ReturnType<typeof createApi>, pair: Awaited<ReturnType<typeof generateKeyPair>>;
const email = (id: string) => `${id}@example.invalid`;
const activation = { displayName: 'Synthetic member', goalType: 'maintenance', locale: 'zh-Hant', timezone: 'America/Chicago' };
const bindings = () => ({ DB: db, RESTORE_EPOCH: epoch, APP_ORIGIN: origin, APP_ENV: 'test' as const });
async function token(id: string, subject = id) {
  return new SignJWT({ email: email(id) }).setProtectedHeader({ alg: 'RS256', kid: 'local-test' }).setSubject(subject).setIssuer(issuer).setAudience('local-audience').setIssuedAt(Math.floor(now.getTime() / 1000)).setExpirationTime(Math.floor(now.getTime() / 1000) + 3600).sign(pair.privateKey);
}
async function request(route: string, id = invited, method = 'GET', body?: unknown, options: { key?: string; revision?: number; subject?: string; jwt?: string } = {}) {
  const headers: Record<string, string> = { Origin: origin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': options.jwt ?? await token(id, options.subject), 'Idempotency-Key': options.key ?? crypto.randomUUID() };
  if (options.revision !== undefined) headers['If-Match'] = `"${options.revision}"`;
  return app.request(`/api/v1${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, bindings());
}
const count = (table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n');
async function seed(id: string, status: 'active' | 'invited', role = 'member') {
  await db.prepare('INSERT INTO users(id,verified_subject,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, status === 'active' ? subjectKey({ issuer, subject: id }) : null, email(id), role, status, 'en', 'America/Chicago', start).run();
  if (status === 'invited') await db.prepare("INSERT INTO invitations(id,email_normalized,expires_at,status,created_by,created_at) VALUES (?,?,?,'invited',?,?)").bind(crypto.randomUUID(), email(id), '2026-09-23T20:00:00.000Z', admin, start).run();
}
async function activate() {
  const response = await request('/session/activate', invited, 'POST', activation);
  expect(response.status).toBe(201);
  return (await response.json()).data;
}
beforeAll(async () => {
  runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db);
  pair = await generateKeyPair('RS256');
  const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'local-test', alg: 'RS256' }] });
  app = createApi({ verifyIdentity: accessVerifier({ teamDomain: 'synthetic-team.cloudflareaccess.com', audience: 'local-audience' }, resolver, () => now), clock: () => now });
});
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  now = new Date(start);
  await db.batch(['change_batches', 'operation_revisions', 'command_operations', 'mutation_guards', 'weight_entries', 'goal_versions', 'revoked_sessions', 'user_profiles', 'invitations', 'users'].map(table => db.prepare(`DELETE FROM ${table}`)));
  await db.prepare('UPDATE membership_state SET revision=1 WHERE id=1').run();
  await seed(admin, 'active', 'admin'); await seed(invited, 'invited');
});

describe('invitation activation and membership authorization', () => {
  it('exposes only the verified invitation shell and requires all activation fields', async () => {
    const shell = await request('/session');
    expect(shell.status).toBe(200); expect((await shell.json()).data).toEqual({ status: 'invited', userId: invited, email: email(invited), invitationExpiresAt: '2026-09-23T20:00:00.000Z' });
    expect((await request('/me')).status).toBe(401);
    for (const field of Object.keys(activation)) {
      const incomplete = Object.fromEntries(Object.entries(activation).filter(([key]) => key !== field));
      expect((await request('/session/activate', invited, 'POST', incomplete)).status).toBe(400);
    }
    expect((await request('/session/activate', invited, 'POST', { ...activation, ownerId: other })).status).toBe(400);
    expect((await request('/session/activate', other, 'POST', activation)).status).toBe(401);
    expect(await count('user_profiles')).toBe(0); expect(await count('goal_versions')).toBe(0);
  });
  it('activates exactly once with a profile, initial goal and one atomic change batch', async () => {
    const key = crypto.randomUUID();
    const responses = await Promise.all([request('/session/activate', invited, 'POST', activation, { key }), request('/session/activate', invited, 'POST', activation, { key })]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    const receipts = await Promise.all(responses.map(response => response.json()));
    expect(receipts[0].data).toEqual(receipts[1].data);
    expect(receipts[0].data).toMatchObject({ dataRevision: 1, recordRefs: [{ type: 'user_profile', revision: 1 }, { type: 'goal_version', revision: 1 }] });
    expect(await count('user_profiles')).toBe(1); expect(await count('goal_versions')).toBe(1); expect(await count('change_batches')).toBe(1); expect(await count('command_operations')).toBe(1);
    expect(await db.prepare('SELECT status,accepted_user_id FROM invitations WHERE email_normalized=?').bind(email(invited)).first()).toEqual({ status: 'accepted', accepted_user_id: invited });
    const me = await (await request('/me')).json();
    expect(me.data.profile).toMatchObject({ displayName: activation.displayName, locale: 'zh-Hant', bodyWeightUnit: 'kg', autoMemoryEnabled: true });
    expect(me.data.goal).toMatchObject({ goalType: 'maintenance', effectiveLocalDate: '2026-09-16', energyTargetMkcal: null, proteinTargetMg: null });
    expect(me.data.usage).toBeNull(); expect(me.meta).toMatchObject({ dataRevision: 1, revision: 1, restoreEpoch: epoch });
    expect((await request('/session/activate', invited, 'POST', { ...activation, displayName: 'Changed' }, { key })).status).toBe(409);
    expect((await request('/session/activate', invited, 'POST', activation)).status).toBe(409);
  });
  it('does not bind an existing active email to another verified subject', async () => {
    await activate();
    expect((await request('/session', invited, 'GET', undefined, { subject: 'different-subject' })).status).toBe(401);
    expect((await request('/session/activate', invited, 'POST', activation, { subject: 'different-subject' })).status).toBe(401);
    expect(await count('goal_versions')).toBe(1);
  });
  it('rejects expiry and renews only with an explicit administrator action', async () => {
    await db.prepare('UPDATE invitations SET expires_at=? WHERE email_normalized=?').bind(start, email(invited)).run();
    expect((await request('/session')).status).toBe(410);
    expect((await request('/session/activate', invited, 'POST', activation)).status).toBe(410);
    expect((await request('/admin/invitations', admin, 'POST', { email: email(invited) })).status).toBe(422);
    const renewed = await request('/admin/invitations', admin, 'POST', { email: ` ${email(invited).toUpperCase()} `, renew: true });
    expect(renewed.status).toBe(201);
    expect((await renewed.json()).data.result).toMatchObject({ member: { id: invited, status: 'invited' }, invitation: { expiresAt: '2026-09-23T20:00:00.000Z' }, loginUrl: `${origin}/today` });
    expect(await count('users')).toBe(2); expect(await count('invitations')).toBe(2); await activate();
  });
  it('reuses valid invitations and active members without creating health changes', async () => {
    const pending = await request('/admin/invitations', admin, 'POST', { email: email(invited) });
    expect(pending.status).toBe(201); expect((await pending.json()).data.result.reused).toBe(true);
    expect(await count('invitations')).toBe(1); expect(await count('change_batches')).toBe(0);
    await activate();
    const existing = await (await request('/admin/invitations', admin, 'POST', { email: email(invited) })).json();
    expect(existing.data.result).toMatchObject({ member: { id: invited, status: 'active' }, reused: true });
    expect(await count('users')).toBe(2); expect(await count('change_batches')).toBe(1);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(admin).first('data_revision')).toBe(0);
  });
  it('serializes concurrent invitations at the five-member cap', async () => {
    await seed(crypto.randomUUID(), 'invited'); await seed(crypto.randomUUID(), 'invited');
    const responses = await Promise.all(['fifth', 'sixth'].map(name => request('/admin/invitations', admin, 'POST', { email: `${name}@example.invalid` })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await count('users')).toBe(5); expect(await count('invitations')).toBe(4); expect(await count('change_batches')).toBe(0);
    const rejected = await responses.find(response => response.status === 409)!.json(); expect(rejected.error.code).toBe('MEMBER_LIMIT_REACHED');
  });
  it('protects the last admin against both sequential and concurrent demotion', async () => {
    for (const body of [{ status: 'suspended' }, { role: 'member', confirmRoleChange: true }]) {
      const response = await request(`/admin/members/${admin}`, admin, 'PATCH', body, { revision: 1 });
      expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('LAST_ADMIN_REQUIRED');
    }
    await seed(other, 'active', 'admin');
    const responses = await Promise.all([admin, other].map(id => request(`/admin/members/${id}`, id, 'PATCH', { role: 'member', confirmRoleChange: true }, { revision: 1 })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM users WHERE status='active' AND role='admin'").first('n')).toBe(1);
  });
  it('requires explicit role changes, rejects stale membership edits and scopes admin data', async () => {
    await activate();
    expect((await request(`/admin/members/${invited}`, admin, 'PATCH', { role: 'admin' }, { revision: 2 })).status).toBe(422);
    expect((await request('/admin/members')).status).toBe(403);
    expect((await request('/admin/invitations', invited, 'POST', { email: 'not-authorized@example.invalid' })).status).toBe(403);
    expect((await request(`/admin/members/${invited}`, admin, 'PATCH', { status: 'suspended' }, { revision: 1 })).status).toBe(409);
    const listing = await (await request('/admin/members', admin)).json();
    expect(listing.data.items).toHaveLength(2);
    expect(JSON.stringify(listing)).not.toContain('Synthetic member'); expect(JSON.stringify(listing)).not.toContain('verifiedSubject'); expect(JSON.stringify(listing)).not.toContain('maintenance');
    expect((await request(`/admin/members/${invited}`, admin, 'PATCH', { status: 'suspended' }, { revision: 2 })).status).toBe(200);
    expect((await request('/me')).status).toBe(403);
    expect((await request('/me', invited, 'PATCH', { displayName: 'Denied' }, { revision: 1 })).status).toBe(403);
    expect(await count('change_batches')).toBe(1);
  });
  it('rolls back invitation acceptance and both health entities when event insertion fails', async () => {
    await db.prepare("CREATE TRIGGER activation_event_failure BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END").run();
    try {
      expect((await request('/session/activate', invited, 'POST', activation)).status).toBe(503);
      expect(await count('user_profiles')).toBe(0); expect(await count('goal_versions')).toBe(0); expect(await count('command_operations')).toBe(0);
      expect(await db.prepare('SELECT status,verified_subject,data_revision,membership_revision FROM users WHERE id=?').bind(invited).first()).toEqual({ status: 'invited', verified_subject: null, data_revision: 0, membership_revision: 1 });
      expect(await db.prepare('SELECT status FROM invitations').first('status')).toBe('invited');
      expect(await db.prepare('SELECT revision FROM membership_state').first('revision')).toBe(1);
    } finally { await db.prepare('DROP TRIGGER activation_event_failure').run(); }
  });
});

describe('profile and immutable goal APIs', () => {
  it('uses one revision for preferences, preserves omitted fields and clears explicit null', async () => {
    await activate();
    const first = await request('/me', invited, 'PATCH', { locale: 'en', bodyWeightUnit: 'lb', constraintsText: 'Synthetic note', heightCm: 170.5 }, { revision: 1 });
    expect(first.status).toBe(200); expect((await first.json()).meta).toMatchObject({ revision: 2, dataRevision: 2 });
    const next = await request('/me', invited, 'PATCH', { constraintsText: null }, { revision: 2 }); expect(next.status).toBe(200);
    const me = await (await request('/me')).json();
    expect(me.data.profile).toMatchObject({ revision: 3, locale: 'en', bodyWeightUnit: 'lb', defaultLoadUnit: 'kg', constraintsText: null, heightCm: 170.5, timezone: 'America/Chicago' });
    expect((await request('/me', invited, 'PATCH', { locale: 'zh-Hans' }, { revision: 2 })).status).toBe(409);
    expect((await request('/me', invited, 'PATCH', { role: 'admin' }, { revision: 3 })).status).toBe(400);
    expect((await request('/me', invited, 'PATCH', { dailyEnergyKcal: '2000' }, { revision: 3 })).status).toBe(400);
    expect(await count('change_batches')).toBe(3);
  });
  it('defers timezone effects until the next day and protects dates using the effective zone', async () => {
    await activate();
    const changed = await request('/me', invited, 'PATCH', { timezone: 'Asia/Tokyo' }, { revision: 1 }); expect(changed.status).toBe(200);
    let me = await (await request('/me')).json();
    expect(me.data).toMatchObject({ effectiveTimezone: 'America/Chicago', localDate: '2026-09-16', profile: { timezone: 'America/Chicago', pendingTimezone: 'Asia/Tokyo', timezoneEffectiveDate: '2026-09-17', nextDigestAt: '2026-09-18T03:00:00.000Z' } });
    const weight = { id: crypto.randomUUID(), localDate: '2026-09-17', entryTimezone: 'Asia/Tokyo', occurredAt: null, timePrecision: 'date', value: '70', unit: 'kg', condition: 'unspecified' };
    expect((await request('/weights', invited, 'POST', weight)).status).toBe(400);
    now = new Date('2026-09-17T05:01:00.000Z');
    me = await (await request('/me')).json(); expect(me.data).toMatchObject({ effectiveTimezone: 'Asia/Tokyo', localDate: '2026-09-17' });
    expect(me.data.profile.revision).toBe(2); // GET does not mutate preferences.
    expect((await request('/weights', invited, 'POST', weight)).status).toBe(201);
    expect((await request('/me', invited, 'PATCH', { locale: 'en' }, { revision: 2 })).status).toBe(200);
    me = await (await request('/me')).json(); expect(me.data.profile).toMatchObject({ timezone: 'Asia/Tokyo', pendingTimezone: null, timezoneEffectiveDate: null });
    expect(await db.prepare('SELECT local_date,entry_timezone FROM weight_entries').first()).toEqual({ local_date: '2026-09-17', entry_timezone: 'Asia/Tokyo' });
  });
  it('creates future goal versions without rewriting today or any prior snapshot', async () => {
    const initial = await activate();
    const base = initial.result.goal;
    const input = { id: crypto.randomUUID(), goalType: 'lean_bulk', amounts: { energyKcal: '2300.1234', proteinG: '140', carbsG: null, fatG: '0', weightMin: '150', weightMax: '160', weightUnit: 'lb' }, baseGoal: { id: base.id, revision: 1 } };
    const response = await request('/goals', invited, 'POST', input); expect(response.status).toBe(201);
    const next = (await response.json()).data.result.goal;
    expect(next).toMatchObject({ effectiveLocalDate: '2026-09-17', supersedesId: base.id, energyTargetMkcal: 2300123, proteinTargetMg: 140000, carbsTargetMg: null, fatTargetMg: 0, weightMinKgMicros: 68038856, rawInput: input.amounts });
    const me = await (await request('/me')).json(); expect(me.data.goal).toEqual(base); expect(me.data.nextGoal).toEqual(next);
    expect(goalSnapshotSchema.safeParse({ ...next, energyTargetMkcal: next.energyTargetMkcal + 1 }).success).toBe(false);
    const stale = await request('/goals', invited, 'POST', { ...input, id: crypto.randomUUID() }); expect(stale.status).toBe(409);
    expect(await count('goal_versions')).toBe(2);
  });
  it('requires today, historical and unusually large energy confirmation independently', async () => {
    const base = (await activate()).result.goal;
    const today = { id: crypto.randomUUID(), goalType: 'fat_loss', amounts: { energyKcal: '9000' }, baseGoal: { id: base.id, revision: 1 }, effectiveLocalDate: '2026-09-16' };
    expect((await request('/goals', invited, 'POST', today)).status).toBe(422);
    expect((await request('/goals', invited, 'POST', { ...today, confirmToday: true })).status).toBe(422);
    expect((await request('/goals', invited, 'POST', { ...today, confirmToday: true, amounts: { energyKcal: '8000.0004' } })).status).toBe(422);
    expect((await request('/goals', invited, 'POST', { ...today, confirmToday: true, confirmLargeEnergy: true })).status).toBe(201);
    const historical = { ...today, id: crypto.randomUUID(), baseGoal: null, amounts: {}, effectiveLocalDate: '2026-09-15' };
    expect((await request('/goals', invited, 'POST', historical)).status).toBe(422);
    expect((await request('/goals', invited, 'POST', { ...historical, confirmHistorical: true })).status).toBe(201);
    const query = await (await request('/goals?localDate=2026-09-16')).json(); expect(query.data.goal.id).toBe(today.id);
    expect((await request('/goals?ownerId=' + admin)).status).toBe(400);
  });
  it('allows exactly one concurrent replacement of the same goal baseline', async () => {
    const base = (await activate()).result.goal;
    const responses = await Promise.all(['2100', '2200'].map(energyKcal => request('/goals', invited, 'POST', { id: crypto.randomUUID(), goalType: 'maintenance', amounts: { energyKcal }, baseGoal: { id: base.id, revision: 1 } })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]); expect(await count('goal_versions')).toBe(2); expect(await count('change_batches')).toBe(2);
  });
  it('rebuilds an aggregate when a commit occurs between its reads', async () => {
    await activate(); let reads = 0;
    const result = await readConsistent(db, invited, async () => {
      const before = await db.prepare('SELECT display_name FROM user_profiles WHERE owner_id=?').bind(invited).first('display_name');
      if (++reads === 1) expect((await request('/me', invited, 'PATCH', { displayName: 'New name' }, { revision: 1 })).status).toBe(200);
      return before;
    });
    expect(result).toEqual({ data: 'New name', dataRevision: 2 }); expect(reads).toBe(2);
  });
});

describe('logout and migration continuity', () => {
  it('can end a verified invitation session before onboarding', async () => {
    const jwt = await token(invited);
    expect((await request('/session/logout', invited, 'POST', { localDataDisposition: 'synced' }, { jwt })).status).toBe(200);
    expect((await request('/session', invited, 'GET', undefined, { jwt })).status).toBe(401);
    expect(await count('user_profiles')).toBe(0); expect(await count('change_batches')).toBe(0);
  });
  it('requires a local-data decision and revokes the exact verified token with an idempotent receipt', async () => {
    await activate(); const jwt = await token(invited), key = crypto.randomUUID();
    expect((await request('/session/logout', invited, 'POST', {}, { jwt, key })).status).toBe(400);
    const first = await request('/session/logout', invited, 'POST', { localDataDisposition: 'exported' }, { jwt, key }); expect(first.status).toBe(200);
    const receipt = (await first.json()).data;
    expect(receipt).toMatchObject({ dataRevision: 1, recordRefs: [], result: { logoutUrl: '/cdn-cgi/access/logout' } });
    expect((await request('/me', invited, 'GET', undefined, { jwt })).status).toBe(401);
    const repeat = await request('/session/logout', invited, 'POST', { localDataDisposition: 'exported' }, { jwt, key }); expect((await repeat.json()).data).toEqual(receipt);
    expect((await request('/session/logout', invited, 'POST', { localDataDisposition: 'discarded' }, { jwt, key })).status).toBe(409);
    expect(await count('revoked_sessions')).toBe(1); expect(await count('change_batches')).toBe(1);
  });
  it('allows a suspended member to revoke their session without permitting a health write', async () => {
    await activate(); const jwt = await token(invited);
    expect((await request(`/admin/members/${invited}`, admin, 'PATCH', { status: 'suspended' }, { revision: 2 })).status).toBe(200);
    expect((await request('/session/logout', invited, 'POST', { localDataDisposition: 'discarded' }, { jwt })).status).toBe(200);
    expect(await count('revoked_sessions')).toBe(1);
  });
  it('computes local noon across DST and a scheduled timezone change', () => {
    expect(localNoon('2026-03-07', 'America/Chicago').toISOString()).toBe('2026-03-07T18:00:00.000Z');
    expect(localNoon('2026-03-08', 'America/Chicago').toISOString()).toBe('2026-03-08T17:00:00.000Z');
    expect(nextProfileNoon(new Date('2026-09-16T15:00:00.000Z'), 'America/Chicago', 'Asia/Tokyo', '2026-09-17')).toBe('2026-09-16T17:00:00.000Z');
    expect(nextProfileNoon(new Date(start), 'America/Chicago', 'Asia/Tokyo', '2026-09-17')).toBe('2026-09-18T03:00:00.000Z');
  });
  it('upgrades a populated M0 without rebuilding or losing identity relationships', async () => {
    const legacy = localRuntime(), directory = await mkdtemp(path.resolve('.tmp/m0-upgrade-'));
    try {
      const binding = await legacy.getD1Database('DB');
      await copyFile('db/migrations/0000_volatile_oracle.sql', path.join(directory, '0000_volatile_oracle.sql'));
      await applyMigrations(binding, directory);
      await binding.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'admin','active','en','UTC',?)").bind(admin, email(admin), start).run();
      await binding.prepare('INSERT INTO user_profiles(id,owner_id,created_at,updated_at,display_name,next_digest_at) VALUES (?,?,?,?,?,?)').bind(other, admin, start, start, 'Retained profile', start).run();
      await binding.prepare("INSERT INTO invitations(id,email_normalized,expires_at,status,created_by,created_at) VALUES (?,?,'2026-09-23T20:00:00.000Z','invited',?,?)").bind(invited, email(invited), admin, start).run();
      expect(await applyMigrations(binding)).toEqual(['0001_youthful_professor_monster.sql', '0002_cloudy_angel.sql', '0003_charming_cyclops.sql', '0004_keen_night_thrasher.sql', '0005_polite_jackpot.sql', '0006_low_adam_destine.sql', '0007_training_catalog.sql', '0008_setup_default_origin.sql', '0009_daily_records.sql', '0010_diet_notes.sql']);
      expect(await applyMigrations(binding)).toEqual([]);
      expect(await binding.prepare('SELECT display_name,auto_memory_enabled FROM user_profiles').first()).toEqual({ display_name: 'Retained profile', auto_memory_enabled: 1 });
      expect(await binding.prepare('SELECT membership_revision FROM users').first('membership_revision')).toBe(1);
      expect(await binding.prepare('SELECT created_by FROM invitations').first('created_by')).toBe(admin);
      await expect(binding.prepare('DELETE FROM users WHERE id=?').bind(admin).run()).rejects.toThrow();
      await expect(binding.prepare('UPDATE user_profiles SET auto_memory_enabled=2').run()).rejects.toThrow();
      await expect(binding.prepare('UPDATE users SET membership_revision=0').run()).rejects.toThrow();
    } finally { await legacy.dispose(); await rm(directory, { recursive: true, force: true }); }
  });
});
