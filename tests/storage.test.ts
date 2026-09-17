import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import { applyMigrations } from '../scripts/migrations.mjs';
import { memberLookup } from '../src/server/members.ts';
import { subjectKey } from '../src/server/auth.ts';
import { users } from '../db/schema.ts';

let runtime: Miniflare;
const first = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641';
const second = '29a3d61a-d672-4359-834c-792af3bbce87';
const identity = { issuer: 'https://synthetic-team.cloudflareaccess.com', subject: 'test-subject' };
beforeAll(async () => {
  runtime = new Miniflare({ cf: false, host: '127.0.0.1', modules: true, compatibilityDate: '2026-07-30', d1Databases: ['DB'], r2Buckets: ['MEDIA'], durableObjects: { STORAGE_PROBE: { className: 'StorageProbe', useSQLite: true } }, outboundService: () => { throw new Error('External request forbidden'); },
    script: `import { DurableObject } from 'cloudflare:workers';
      export class StorageProbe extends DurableObject { async fetch() { this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT)'); this.ctx.storage.sql.exec('INSERT OR REPLACE INTO probe VALUES (1, ?)', 'stored'); return Response.json(this.ctx.storage.sql.exec('SELECT value FROM probe').toArray()); } }
      export default { async fetch(request, env) { return env.STORAGE_PROBE.get(env.STORAGE_PROBE.idFromName('test')).fetch(request); } };`,
  });
});
afterAll(async () => { await runtime.dispose(); });
describe('real local D1/R2/SQLite DO foundation', () => {
  it('migrates an empty D1 and applies no changes on repeat', async () => {
    const db = await runtime.getD1Database('DB');
    expect(await applyMigrations(db)).toContain('0000_volatile_oracle.sql'); expect(await applyMigrations(db)).toHaveLength(0);
    const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results.map(row => row.name);
    expect(names).toEqual(expect.arrayContaining(['users', 'invitations', 'user_profiles', '_migrations', 'weight_entries', 'command_operations', 'change_batches', 'operation_revisions', 'mutation_guards']));
  });
  it('uses Drizzle to retrieve a verified member without exposing a public CRUD API', async () => {
    const binding = await runtime.getD1Database('DB');
    const db = drizzle(binding as unknown as D1Database);
    await db.insert(users).values({ id: first, verifiedSubject: subjectKey(identity), emailNormalized: 'member@example.invalid', role: 'member', status: 'active', locale: 'en', timezone: 'America/Chicago', createdAt: '2026-09-16T00:00:00.000Z' });
    expect(await memberLookup(db)(subjectKey(identity))).toMatchObject({ id: first, role: 'member' });
    expect(await memberLookup(db)('unbound')).toBeNull();
  });
  it('enforces foreign keys, unique emails and enum constraints', async () => {
    const db = await runtime.getD1Database('DB');
    await expect(db.prepare("INSERT INTO invitations VALUES (?, ?, ?, 'invited', ?, NULL, ?)").bind(second, 'guest@example.invalid', '2026-09-23T00:00:00.000Z', second, '2026-09-16T00:00:00.000Z').run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO users(id,verified_subject,email_normalized,role,status,locale,timezone,data_revision,created_at,suspended_at) SELECT ?, NULL, email_normalized,role,status,locale,timezone,0,created_at,NULL FROM users WHERE id=?").bind(second, first).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE users SET role='superadmin' WHERE id=?").bind(first).run()).rejects.toThrow();
  });
  it('rolls back every statement when a D1 batch fails', async () => {
    const db = await runtime.getD1Database('DB');
    await expect(db.batch([db.prepare('UPDATE users SET data_revision=1 WHERE id=?').bind(first), db.prepare("UPDATE users SET locale='invalid' WHERE id=?").bind(first)])).rejects.toThrow();
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(first).first('data_revision')).toBe(0);
  });
  it('supports compound ownership constraints for future private children', async () => {
    const db = await runtime.getD1Database('DB');
    await db.prepare("INSERT INTO user_profiles (id, owner_id, created_at, updated_at, display_name, next_digest_at) VALUES (?, ?, ?, ?, 'Synthetic', ?)").bind(second, first, '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z', '2026-09-16T17:00:00.000Z').run();
    await db.prepare('CREATE TABLE probe_children (owner_id TEXT, parent_id TEXT, FOREIGN KEY(owner_id,parent_id) REFERENCES user_profiles(owner_id,id))').run();
    await expect(db.prepare('INSERT INTO probe_children VALUES (?,?)').bind(second, second).run()).rejects.toThrow();
    await db.prepare('INSERT INTO probe_children VALUES (?,?)').bind(first, second).run();
  });
  it('stores and retrieves private local R2 objects', async () => { const bucket = await runtime.getR2Bucket('MEDIA'); await bucket.put('synthetic-owner/probe', 'synthetic media'); expect(await (await bucket.get('synthetic-owner/probe'))?.text()).toBe('synthetic media'); });
  it('runs SQLite-backed DO storage without a budget ledger', async () => expect(await (await runtime.dispatchFetch('http://localhost/probe')).json()).toEqual([{ value: 'stored' }]));
});
