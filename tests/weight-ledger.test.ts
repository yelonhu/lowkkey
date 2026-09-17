import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { createWeight, deleteWeight, listWeights, patchWeight, readWeight, undoWeight } from '../src/server/weights.ts';
import { executeCommand, readOperation } from '../src/server/commands.ts';
import { DomainError } from '../src/server/errors.ts';
import { weightTrend } from '../src/domain/weight.ts';
import type { AuthContext } from '../src/server/auth.ts';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87';
const auth: AuthContext = { id: owner, role: 'member', locale: 'en', timezone: 'America/Chicago', status: 'active' };
const now = () => new Date('2026-09-16T20:00:00.000Z');
const input = (value = '70', date = '2026-09-16') => ({ id: crypto.randomUUID(), localDate: date, entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date', value, unit: 'kg', condition: 'unspecified' });
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  await db.batch(['DROP TRIGGER IF EXISTS reject_event', 'DROP TRIGGER IF EXISTS reject_audit', 'DELETE FROM change_batches', 'DELETE FROM operation_revisions', 'DELETE FROM command_operations', 'DELETE FROM mutation_guards', 'DELETE FROM weight_entries', 'DELETE FROM users'].map(sql => db.prepare(sql)));
  for (const id of [owner, other]) await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','America/Chicago',?)").bind(id, `${id}@example.invalid`, now().toISOString()).run();
});
async function count(table: string) { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n'); }
describe('weight commands on real D1', () => {
  it('retains original units and atomically stores fact, audit, revision and batch', async () => {
    const entry = { ...input(), value: '110', unit: 'lb' }, operationId = crypto.randomUUID();
    const receipt = await createWeight(db, auth, operationId, entry, now);
    const row = await readWeight(db, owner, entry.id);
    expect(row).toMatchObject({ value: '110', unit: 'lb', kgMicros: 49_895_161, isPrimary: true, occurredAt: null, revision: 1 });
    expect(receipt).toMatchObject({ operationId, dataRevision: 1, recordRefs: [{ id: entry.id, revision: 1, type: 'weight_entry' }] });
    for (const table of ['weight_entries', 'operation_revisions', 'command_operations', 'change_batches']) expect(await count(table)).toBe(1);
    expect(await count('mutation_guards')).toBe(0);
    const batch = await db.prepare('SELECT events_json,changes_json FROM change_batches').first<{ events_json: string; changes_json: string }>();
    expect(JSON.parse(batch!.events_json)).toMatchObject([{ eventId: `${operationId}:0`, source: 'user', beforeRevision: null, afterRevision: 1 }]);
    expect(JSON.parse(batch!.changes_json)[0].value).toEqual(row);
  });
  it('returns the exact original receipt after a lost response or concurrent duplicate', async () => {
    const entry = input(), operationId = crypto.randomUUID();
    const receipts = await Promise.all([createWeight(db, auth, operationId, entry, now), createWeight(db, auth, operationId, entry, now)]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await readOperation(db, owner, operationId)).toEqual(receipts[0]);
    expect(await count('change_batches')).toBe(1);
    await expect(createWeight(db, auth, operationId, { ...entry, value: '71' }, now)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await count('weight_entries')).toBe(1);
  });
  it('requires a same-day choice and guards the primary being replaced', async () => {
    const a = input(), b = input('70.1'), c = input('70.2');
    await createWeight(db, auth, crypto.randomUUID(), a, now);
    await expect(createWeight(db, auth, crypto.randomUUID(), b, now)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'sameDayPrimary' } });
    await createWeight(db, auth, crypto.randomUUID(), { ...b, primaryChoice: 'extra' }, now);
    await expect(createWeight(db, auth, crypto.randomUUID(), { ...c, primaryChoice: 'replace', expectedPrimary: { id: a.id, revision: 9 } }, now)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await createWeight(db, auth, crypto.randomUUID(), { ...c, primaryChoice: 'replace', expectedPrimary: { id: a.id, revision: 1 } }, now);
    expect((await listWeights(db, owner, a.localDate, a.localDate)).filter(entry => entry.isPrimary).map(entry => entry.id)).toEqual([c.id]);
    expect((await readWeight(db, owner, a.id)).revision).toBe(2);
  });
  it('allows unrelated concurrent appends without forcing a stale record revision', async () => {
    const receipts = await Promise.all([createWeight(db, auth, crypto.randomUUID(), input('70', '2026-09-14'), now), createWeight(db, auth, crypto.randomUUID(), input('70.1', '2026-09-15'), now)]);
    expect(receipts.map(receipt => receipt.dataRevision).sort()).toEqual([1, 2]);
    expect(await count('weight_entries')).toBe(2); expect(await count('change_batches')).toBe(2);
  });
  it('undoes an initial primary without leaving a later independent extra orphaned', async () => {
    const a = input(), b = input('70.1');
    const original = await createWeight(db, auth, crypto.randomUUID(), a, now);
    await createWeight(db, auth, crypto.randomUUID(), { ...b, primaryChoice: 'extra' }, now);
    await undoWeight(db, auth, crypto.randomUUID(), original.operationId, now);
    expect((await readWeight(db, owner, b.id)).isPrimary).toBe(true);
    await expect(readWeight(db, owner, a.id)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('deleting a primary promotes the earliest remaining valid record and can undo atomically', async () => {
    const a = { ...input(), occurredAt: '2026-09-16T12:00:00.000Z', timePrecision: 'instant' }, b = { ...input('70.1'), occurredAt: '2026-09-16T13:00:00.000Z', timePrecision: 'instant' };
    await createWeight(db, auth, crypto.randomUUID(), a, now);
    await createWeight(db, auth, crypto.randomUUID(), { ...b, primaryChoice: 'extra' }, now);
    const deleted = await deleteWeight(db, auth, crypto.randomUUID(), a.id, 1, now);
    expect(deleted.result.replacementPrimaryId).toBe(b.id);
    expect((await readWeight(db, owner, b.id)).isPrimary).toBe(true);
    await undoWeight(db, auth, crypto.randomUUID(), deleted.operationId, now);
    expect((await readWeight(db, owner, a.id)).isPrimary).toBe(true);
    expect((await readWeight(db, owner, b.id)).isPrimary).toBe(false);
  });
  it('guards against stale edits and stale undo without overwriting later facts', async () => {
    const entry = input(), initial = await createWeight(db, auth, crypto.randomUUID(), entry, now);
    const edits = await Promise.allSettled([patchWeight(db, auth, crypto.randomUUID(), entry.id, 1, { value: '70.1' }, now), patchWeight(db, auth, crypto.randomUUID(), entry.id, 1, { value: '70.2' }, now)]);
    expect(edits.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(edits.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'REVISION_CONFLICT' } }]);
    await expect(undoWeight(db, auth, crypto.randomUUID(), initial.operationId, now)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await readWeight(db, owner, entry.id)).revision).toBe(2);
    expect(await count('change_batches')).toBe(2);
  });
  it.each(['event', 'audit'])('rolls back every write if %s persistence fails', async kind => {
    const entry = input();
    await db.prepare(`CREATE TRIGGER reject_${kind} BEFORE INSERT ON ${kind === 'event' ? 'change_batches' : 'operation_revisions'} BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run();
    await expect(createWeight(db, auth, crypto.randomUUID(), entry, now)).rejects.toThrow();
    for (const table of ['weight_entries', 'command_operations', 'operation_revisions', 'change_batches', 'mutation_guards']) expect(await count(table)).toBe(0);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(0);
  });
  it('rolls back primary demotion as well as the new record on a later failure', async () => {
    const first = input(); await createWeight(db, auth, crypto.randomUUID(), first, now);
    await db.prepare("CREATE TRIGGER reject_event BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'injected failure'); END").run();
    await expect(createWeight(db, auth, crypto.randomUUID(), { ...input('70.1'), primaryChoice: 'replace', expectedPrimary: { id: first.id, revision: 1 } }, now)).rejects.toThrow();
    expect(await readWeight(db, owner, first.id)).toMatchObject({ revision: 1, isPrimary: true });
    expect(await count('weight_entries')).toBe(1); expect(await count('change_batches')).toBe(1);
  });
  it('rechecks guards inside the transaction; zero matching updates cannot pass', async () => {
    await expect(executeCommand(db, auth, { operationId: crypto.randomUUID(), kind: 'test.guard', payload: {}, entryPoint: 'test', plan: async context => {
      const entity = { ...input(), ownerId: owner, revision: 1, createdAt: context.now, updatedAt: context.now, deletedAt: null };
      return { guards: [{ predicate: 'EXISTS(SELECT 1 FROM weight_entries WHERE owner_id=? AND id=?)', values: [owner, entity.id], error: new DomainError('REVISION_CONFLICT', 409) }], statements: [db.prepare('UPDATE users SET data_revision=99 WHERE id=?').bind(owner)], entities: [{ type: 'weight_entry', before: null, after: entity, action: 'created', changes: [] }], result: {}, undoable: false };
    } }, now)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await count('command_operations')).toBe(0);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(0);
  });
  it('requires confirmed outliers and rejects future actual dates', async () => {
    const first = input('70', '2026-09-15'); await createWeight(db, auth, crypto.randomUUID(), first, now);
    const next = input('80');
    await expect(createWeight(db, auth, crypto.randomUUID(), next, now)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'weightOutlier' } });
    await createWeight(db, auth, crypto.randomUUID(), { ...next, confirmedOutlier: true, outlierReference: { id: first.id, revision: 1 } }, now);
    await expect(createWeight(db, auth, crypto.randomUUID(), input('80', '2026-09-17'), now)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('validates the date against the current persisted timezone, not stale request context', async () => {
    await expect(createWeight(db, { ...auth, timezone: 'Pacific/Kiritimati' }, crypto.randomUUID(), input('70', '2026-09-17'), now)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await db.prepare("UPDATE users SET timezone='Pacific/Kiritimati' WHERE id=?").bind(owner).run();
    await expect(createWeight(db, auth, crypto.randomUUID(), input('70', '2026-09-17'), now)).resolves.toMatchObject({ dataRevision: 1 });
  });
  it('never reads another owner and refuses inactive members even for retries', async () => {
    const entry = input(), operationId = crypto.randomUUID(); await createWeight(db, auth, operationId, entry, now);
    await expect(readWeight(db, other, entry.id)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(patchWeight(db, { ...auth, id: other }, crypto.randomUUID(), entry.id, 1, { value: '60' }, now)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(await readOperation(db, other, operationId)).toBeNull();
    await db.prepare("UPDATE users SET status='suspended' WHERE id=?").bind(owner).run();
    await expect(createWeight(db, auth, operationId, entry, now)).rejects.toMatchObject({ code: 'MEMBER_SUSPENDED' });
  });
});

describe('deterministic weight trend', () => {
  const sample = (localDate: string, kgMicros: number) => ({ localDate, kgMicros, isPrimary: true, deletedAt: null });
  it('averages measured primary days only and requires three days', () => {
    const entries = [sample('2026-09-07', 70_000_000), sample('2026-09-09', 70_400_000), sample('2026-09-12', 70_200_000)];
    expect(weightTrend(entries, '2026-09-13', '2026-09-13').trend).toEqual([{ localDate: '2026-09-13', meanKgMicros: 70_200_000, sampleDays: 3 }]);
    expect(weightTrend(entries.slice(0, 2), '2026-09-13', '2026-09-13').trend[0].meanKgMicros).toBeNull();
  });
  it('uses two non-overlapping weeks with four measured days each', () => {
    const entries = [1, 2, 3, 4].map(day => sample(`2026-09-0${day}`, 70_000_000)).concat([8, 9, 10, 11].map(day => sample(`2026-09-${String(day).padStart(2, '0')}`, 70_200_000)));
    const trend = weightTrend(entries, '2026-09-14', '2026-09-14');
    expect(trend.weeklyChangeKgMicros).toBe(200_000); expect(trend.weeklyChangePct).toBeCloseTo(0.285714);
    expect(weightTrend(entries.slice(1), '2026-09-14', '2026-09-14').weeklyChangeKgMicros).toBeNull();
  });
});
