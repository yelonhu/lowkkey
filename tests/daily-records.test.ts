import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdtemp, copyFile, readdir, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import type { AuthContext } from '../src/server/auth.ts';
import { createCustomExercise, createSetup } from '../src/server/exercises.ts';
import { addDailySet, addExercise, addSet, createSession, editSet, readTrainingDay, readSessionTree, transitionSession } from '../src/server/training.ts';
import { createDailyWeight, editDailyWeight, readDailyWeight, createWeight, listWeights, undoWeight } from '../src/server/weights.ts';
import { actualDaySets } from '../src/server/days.ts';
import { dailySetInputSchema, dailyWeightCreateSchema } from '../src/domain/daily-records.ts';
import { prepareMutation, observed } from '../src/domain/manual-commands.ts';

const owner = '451ff7b1-e15b-491a-a96e-4b807796ab49', date = '2026-09-16', timezone = 'America/Chicago';
const auth: AuthContext = { id: owner, role: 'member', locale: 'en', timezone, status: 'active' };
const clock = () => new Date('2026-09-17T17:00:00.000Z'), id = () => crypto.randomUUID();
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  await db.batch(['DROP TRIGGER IF EXISTS daily_reject', ...['change_batches','operation_revisions','command_operations','mutation_guards','workout_sets','session_exercises','workout_sessions','exercise_setups','exercise_labels','exercise_definitions','weight_entries','day_claims','users'].map(table => 'DELETE FROM ' + table)].map(sql => db.prepare(sql)));
  await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en',?,?)").bind(owner, 'daily@example.invalid', timezone, clock().toISOString()).run();
});
async function input(database = db) {
  const exerciseId = id(), setupId = id(), exercise = id();
  await createCustomExercise(database, auth, id(), { id: exerciseId, name: 'Bench', locale: 'en', equipmentType: 'barbell', variant: { schemaVersion: 1, angle: 'flat', grip: 'pronated', laterality: 'bilateral', note: null }, muscles: { schemaVersion: 1, primary: ['chest'], secondary: ['triceps'] } }, clock);
  await createSetup(database, auth, id(), { id: setupId, exerciseId, loadSemantics: 'external_total', loadUnit: 'lb', includesBar: true, barWeightDecimal: '45', barUnit: 'lb' }, clock);
  return { id: id(), sessionId: id(), createSession: true, expectedSessionRevision: null, localDate: date, entryTimezone: timezone, exercise: { id: exercise, setupId, ordinal: 1 }, sessionExerciseId: exercise, ordinal: 1, reps: 10, load: { value: '110', unit: 'lb', semantics: 'external_total' } };
}
const weight = (value = '70') => ({ id: id(), localDate: date, entryTimezone: timezone, value, unit: 'kg', condition: 'unspecified', occurredAt: null, timePrecision: 'date' });
it('creates a neutral date-only day with its first fact atomically and replays one receipt', async () => {
  const value = await input(), operation = id();
  const receipts = await Promise.all([addDailySet(db, auth, operation, date, value, clock), addDailySet(db, auth, operation, date, value, clock)]);
  expect(receipts[0]).toEqual(receipts[1]);
  const day = await readTrainingDay(db, owner, date);
  expect(day.sessions).toHaveLength(1); expect(day.exercises).toHaveLength(1); expect(day.sets).toHaveLength(1);
  expect(day.sessions[0]).toMatchObject({ status: 'recorded', timePrecision: 'date', startedAt: null, endedAt: null });
  expect(day.sets[0]).toMatchObject({ loadDecimal: '110', unit: 'lb', kgMicros: 49895161, reps: 10, rpeHalfUnits: null, setType: 'unknown', completedAt: null });
  expect(await actualDaySets(db, owner, date)).toBe(1);
});
it('concurrent first rows cannot create duplicate day containers; a failed event leaves no root', async () => {
  const value = await input();
  const second = { ...value, id: id(), sessionId: id(), exercise: { ...value.exercise, id: id() } }; second.sessionExerciseId = second.exercise.id;
  const result = await Promise.allSettled([addDailySet(db, auth, id(), date, value, clock), addDailySet(db, auth, id(), date, second, clock)]);
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect((await readTrainingDay(db, owner, date)).sets).toHaveLength(1);
  await db.prepare("CREATE TRIGGER daily_reject BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'test'); END").run();
  const next = { ...value, id: id(), sessionId: id(), localDate: '2026-09-15', exercise: { ...value.exercise, id: id() } }; next.sessionExerciseId = next.exercise.id;
  await expect(addDailySet(db, auth, id(), next.localDate, next, clock)).rejects.toThrow();
  expect((await readTrainingDay(db, owner, next.localDate)).sessions).toEqual([]);
});
it('daily edits bind root and set versions, permit empty days, and never infer an occurrence time', async () => {
  const value = await input(); await addDailySet(db, auth, id(), date, value, clock);
  await editSet(db, auth, id(), value.sessionId, 1, value.id, { expectedRevision: 1, reps: 8 }, false, clock, date);
  await expect(editSet(db, auth, id(), value.sessionId, 1, value.id, { expectedRevision: 1, reps: 9 }, false, clock, date)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await editSet(db, auth, id(), value.sessionId, 2, value.id, { expectedRevision: 2 }, true, clock, date);
  expect((await readTrainingDay(db, owner, date)).sets).toEqual([]); expect(await actualDaySets(db, owner, date)).toBe(0);
});
it('keeps old session IDs, timestamps and snapshots while daily deletion permits the final old set', async () => {
  const value = await input();
  await createSession(db, auth, id(), { id: value.sessionId, localDate: date, entryTimezone: timezone, timePrecision: 'date' }, clock);
  await addExercise(db, auth, id(), value.sessionId, 1, value.exercise, clock);
  await addSet(db, auth, id(), value.sessionId, 2, { id: value.id, sessionExerciseId: value.sessionExerciseId, ordinal: 1, reps: 8, load: value.load }, clock);
  await transitionSession(db, auth, id(), value.sessionId, 3, 'finish', clock);
  const before = await readSessionTree(db, owner, value.sessionId);
  await editSet(db, auth, id(), value.sessionId, 4, value.id, { expectedRevision: 1 }, true, clock, date);
  const day = await readTrainingDay(db, owner, date);
  expect(day.sessions[0].id).toBe(before.session.id); expect(day.sessions[0].startedAt).toBe(before.session.startedAt);
  expect(day.exercises[0].displaySnapshot).toEqual(before.exercises[0].displaySnapshot); expect(day.sets).toEqual([]);
});
it('daily weight edits update one identity, detect stale versions, and never promote legacy extras after delete or undo', async () => {
  const first = weight(); await createDailyWeight(db, auth, id(), date, first, clock);
  const extra = weight('70.1'); await createWeight(db, auth, id(), { ...extra, primaryChoice: 'extra' }, clock);
  await editDailyWeight(db, auth, id(), date, first.id, 1, { value: '70.2' }, false, clock);
  expect(await readDailyWeight(db, owner, date)).toMatchObject({ id: first.id, value: '70.2', revision: 2 });
  await expect(editDailyWeight(db, auth, id(), date, first.id, 1, { value: '71' }, false, clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await editDailyWeight(db, auth, id(), date, first.id, 2, {}, true, clock);
  expect(await readDailyWeight(db, owner, date)).toBeNull();
  expect(await listWeights(db, owner, date, date)).toMatchObject([{ id: extra.id, isPrimary: false }]);
  const next = weight('70.3'), operation = id(); await createDailyWeight(db, auth, operation, date, next, clock);
  await undoWeight(db, auth, id(), operation, clock);
  expect(await readDailyWeight(db, owner, date)).toBeNull();
});
it('concurrent daily weight creates have exactly one primary and no extra side effect', async () => {
  const attempts = await Promise.allSettled([createDailyWeight(db, auth, id(), date, weight(), clock), createDailyWeight(db, auth, id(), date, weight('70.1'), clock)]);
  expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(await listWeights(db, owner, date, date)).toHaveLength(1);
});
it('daily commands skip only an absent root baseline, and strict inputs reject management fields and invented times', async () => {
  const value = await input(), parsed = dailySetInputSchema.parse(Object.fromEntries(Object.entries(value).filter(([key]) => !['sessionId','expectedSessionRevision'].includes(key))));
  const mutation = { kind: 'day-set.create', session: observed({ type: 'workout_session', id: value.sessionId, revision: 1 }), input: parsed };
  expect(prepareMutation(mutation).checks).toEqual([]);
  expect(prepareMutation({ ...mutation, input: { ...parsed, createSession: false } }).checks).toHaveLength(1);
  expect(dailyWeightCreateSchema.safeParse({ ...weight(), primaryChoice: 'extra' }).success).toBe(false);
  expect(dailySetInputSchema.safeParse({ ...parsed, completedAt: clock().toISOString() }).success).toBe(false);
  expect(dailyWeightCreateSchema.safeParse({ ...weight(), ownerId: owner }).success).toBe(false);
});
it('upgrades populated legacy training without altering child foreign keys, snapshots or audits', async () => {
  const isolated = localRuntime(), directory = await mkdtemp('.tmp/daily-upgrade-');
  try {
    const database = await isolated.getD1Database('DB') as unknown as D1Database;
    for (const file of (await readdir('db/migrations')).filter(file => file.endsWith('.sql') && file < '0009')) await copyFile('db/migrations/' + file, directory + '/' + file);
    await applyMigrations(database, directory);
    await database.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en',?,?)").bind(owner, 'upgrade@example.invalid', timezone, clock().toISOString()).run();
    const value = await input(database);
    await createSession(database, auth, id(), { id: value.sessionId, localDate: date, entryTimezone: timezone, timePrecision: 'date' }, clock);
    await addExercise(database, auth, id(), value.sessionId, 1, value.exercise, clock);
    await addSet(database, auth, id(), value.sessionId, 2, { id: value.id, sessionExerciseId: value.sessionExerciseId, ordinal: 1, reps: 8, load: value.load }, clock);
    const before = await readSessionTree(database, owner, value.sessionId);
    expect(await applyMigrations(database)).toEqual(['0009_daily_records.sql']);
    expect(await readSessionTree(database, owner, value.sessionId)).toEqual(before);
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect(await applyMigrations(database)).toEqual([]);
  } finally { await isolated.dispose(); await rm(directory, { recursive: true, force: true }); }
});

it('continues a legacy draft without inventing a start time or losing its identity', async () => {
  const value = await input();
  await createSession(db, auth, id(), { id: value.sessionId, localDate: date, entryTimezone: timezone, status: 'draft' }, clock);
  await addDailySet(db, auth, id(), date, { ...value, createSession: false, expectedSessionRevision: 1 }, clock);
  expect((await readTrainingDay(db, owner, date)).sessions[0]).toMatchObject({ id: value.sessionId, status: 'draft', startedAt: null, endedAt: null });
  expect(await actualDaySets(db, owner, date)).toBe(1);
  await editSet(db, auth, id(), value.sessionId, 2, value.id, { expectedRevision: 1 }, true, clock, date);
  expect(await actualDaySets(db, owner, date)).toBe(0);
});
