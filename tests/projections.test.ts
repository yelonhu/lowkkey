import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { readArtifacts } from '../src/server/artifacts.ts';
import { createWeight, deleteWeight } from '../src/server/weights.ts';
import { createCustomExercise, createSetup } from '../src/server/exercises.ts';
import { addExercise, addSet, createSession, editSet, transitionSession } from '../src/server/training.ts';
import { createMeal, editMeal } from '../src/server/meals.ts';
import { createApi } from '../src/server/api.ts';
import { accessVerifier, subjectKey } from '../src/server/auth.ts';
import type { AuthContext } from '../src/server/auth.ts';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87';
const auth: AuthContext = { id: owner, role: 'member', locale: 'en', timezone: 'America/Chicago', status: 'active' };
const clock = () => new Date('2026-09-16T20:00:00.000Z');
const op = () => crypto.randomUUID();
const date = '2026-09-16', occurrence = { localDate: date, entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date' };
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  const tables = ['change_batches', 'operation_revisions', 'command_operations', 'mutation_guards', 'meal_items', 'meals', 'workout_sets', 'session_exercises', 'workout_sessions', 'exercise_setups', 'exercise_labels', 'exercise_definitions', 'weight_entries', 'day_claims', 'users'];
  await db.batch(tables.map(table => db.prepare(`DELETE FROM ${table}`)));
  for (const id of [owner, other]) await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','America/Chicago',?)").bind(id, `${id}@example.invalid`, clock().toISOString()).run();
});
const weight = (value: string, localDate = date) => ({ id: op(), ...occurrence, value, localDate, unit: 'kg', condition: 'unspecified' });
const meal = () => ({ id: op(), ...occurrence, items: [{ id: op(), originalName: 'Synthetic meal', quantityDecimal: '1', unit: 'serving', source: { kind: 'manual', nutrients: { energyKcal: '200', proteinG: null, carbsG: '20', fatG: null } } }] });
async function training() {
  const exerciseId = op(), setupId = op(), sessionId = op(), sessionExerciseId = op();
  await createCustomExercise(db, auth, op(), { id: exerciseId, name: 'Synthetic bench', locale: 'en', equipmentType: 'barbell', variant: { schemaVersion: 1, angle: 'flat', grip: 'pronated', laterality: 'bilateral', note: null }, muscles: { schemaVersion: 1, primary: ['chest'], secondary: ['triceps'] } }, clock);
  await createSetup(db, auth, op(), { id: setupId, exerciseId, equipmentInstance: 'Fixture bench', loadSemantics: 'external_total', loadUnit: 'kg' }, clock);
  await createSession(db, auth, op(), { id: sessionId, localDate: date, entryTimezone: occurrence.entryTimezone, timePrecision: 'date' }, clock);
  await addExercise(db, auth, op(), sessionId, 1, { id: sessionExerciseId, setupId, ordinal: 1 }, clock);
  const first = op(), second = op();
  await addSet(db, auth, op(), sessionId, 2, { id: first, sessionExerciseId, ordinal: 1, reps: 8, load: { value: '40', unit: 'kg', semantics: 'external_total' }, setType: 'work' }, clock);
  await addSet(db, auth, op(), sessionId, 3, { id: second, sessionExerciseId, ordinal: 2, reps: 8, load: { value: '40', unit: 'kg', semantics: 'external_total' } }, clock);
  return { sessionId, first, second };
}
async function requestClient() {
  const issuer = 'https://projection-fixture.cloudflareaccess.com', pair = await generateKeyPair('RS256'), origin = 'http://127.0.0.1:5173';
  const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture', alg: 'RS256' }] });
  for (const user of [owner, other]) await db.prepare('UPDATE users SET verified_subject=? WHERE id=?').bind(subjectKey({ issuer, subject: user }), user).run();
  const app = createApi({ clock, verifyIdentity: accessVerifier({ teamDomain: 'projection-fixture.cloudflareaccess.com', audience: 'projection-test' }, resolver, clock) });
  return async (path: string, user = owner) => {
    const jwt = await new SignJWT({ email: `${user}@example.invalid` }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(user).setIssuer(issuer).setAudience('projection-test').setIssuedAt(Math.floor(clock().getTime() / 1000)).setExpirationTime(Math.floor(clock().getTime() / 1000) + 60).sign(pair.privateKey);
    return app.request(`/api/v1${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }, { DB: db, APP_ORIGIN: origin, RESTORE_EPOCH: 'fa682cd1-1d70-4f27-87f0-4b143f53b624' });
  };
}

describe('deterministic three-artifact projection', () => {
  it('returns exactly three empty views at one revision without creating records', async () => {
    const result = await readArtifacts(db, auth, {}, clock);
    expect(result.views.map(view => view.kind)).toEqual(['SessionArtifact', 'WeightArtifact', 'DietArtifact']);
    expect(result.views.map(view => view.dataRevision)).toEqual([0, 0, 0]);
    expect(result.views.every(view => view.quality === 'empty')).toBe(true);
    expect(result.views[1]).toMatchObject({ props: { primaryKgMicros: null, primaryEntryId: null } });
    expect(result.views[2]).toMatchObject({ props: { knownSum: { energyMkcal: null }, completeness: 'unreviewed' } });
    expect(result.query.ranges).toEqual({ training: { from: '2026-09-14', to: '2026-09-20' }, weight: { from: '2026-08-20', to: '2026-09-16' } });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM change_batches').first('n')).toBe(0);
  });
  it('derives weight, direct/secondary work groups, and partial nutrition from facts', async () => {
    for (const [day, value] of [['2026-09-14', '70.0'], ['2026-09-15', '70.4'], ['2026-09-16', '70.2']]) await createWeight(db, auth, op(), weight(value, day), clock);
    const t = await training(), m = meal(); await createMeal(db, auth, op(), m, clock);
    const result = await readArtifacts(db, auth, {}, clock);
    expect(result.views[0]).toMatchObject({ quality: 'partial', props: { activeSessionId: t.sessionId, completedWorkingSets: 1, unknownTypeSets: 1, muscleVolume: [{ muscleId: 'chest', directSets: 1, secondarySets: 0 }, { muscleId: 'triceps', directSets: 0, secondarySets: 1 }] } });
    const w = result.views.find(view => view.kind === 'WeightArtifact')!;
    expect(w.props.trend.at(-1)).toEqual({ localDate: date, meanKgMicros: 70200000, sampleDays: 3 });
    expect(result.views[2]).toMatchObject({ props: { mealIds: [m.id], knownSum: { energyMkcal: 200000, proteinMg: null }, unknownCounts: { protein: 1, fat: 1 } } });
    expect(new Set(result.views.map(view => view.dataRevision)).size).toBe(1);
    const previousRevision = result.dataRevision;
    await editSet(db, auth, op(), t.sessionId, 4, t.first, { expectedRevision: 1, reps: 5 }, false, clock);
    const next = await readArtifacts(db, auth, { kind: 'SessionArtifact' }, clock);
    expect(next.dataRevision).toBe(previousRevision + 1);
    expect(next.views[0].entityRefs).toContainEqual({ type: 'workout_session', id: t.sessionId, revision: 5 });
    expect((await db.prepare('SELECT reps FROM workout_sets WHERE id=?').bind(t.first).first('reps'))).toBe(5);
  });
  it('does not include tombstoned parents in work groups or nutrition totals', async () => {
    const t = await training(), m = meal(); await createMeal(db, auth, op(), m, clock);
    await transitionSession(db, auth, op(), t.sessionId, 4, 'delete', clock); await editMeal(db, auth, op(), m.id, 1, {}, true, clock);
    const result = await readArtifacts(db, auth, {}, clock);
    expect(result.views[0]).toMatchObject({ props: { completedWorkingSets: 0, unknownTypeSets: 0, muscleVolume: [] } });
    expect(result.views[2]).toMatchObject({ props: { mealIds: [], knownSum: { energyMkcal: null } } });
  });
  it('scopes every view and explicit session to the authenticated owner', async () => {
    const t = await training(); await createWeight(db, auth, op(), weight('70'), clock); await createMeal(db, auth, op(), meal(), clock);
    const result = await readArtifacts(db, { ...auth, id: other }, {}, clock);
    expect(result.views.every(view => view.quality === 'empty')).toBe(true);
    await expect(readArtifacts(db, { ...auth, id: other }, { sessionId: t.sessionId }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('uses explicit date ranges and preserves insufficient data as null', async () => {
    await createWeight(db, auth, op(), weight('70'), clock); await training();
    const result = await readArtifacts(db, auth, { kind: 'SessionArtifact', range: { from: '2026-09-01', to: '2026-09-10' } }, clock);
    expect(result.views[0]).toMatchObject({ props: { completedWorkingSets: 0, unknownTypeSets: 0 } });
    const w = (await readArtifacts(db, auth, { kind: 'WeightArtifact' }, clock)).views[0];
    expect(w).toMatchObject({ quality: 'partial', props: { primaryKgMicros: 70000000 } });
    if (w.kind !== 'WeightArtifact') throw new Error('Expected weight view');
    expect(w.props.trend.every(point => point.meanKgMicros === null)).toBe(true);
    await expect(readArtifacts(db, auth, { kind: 'WeightArtifact', range: { from: '2025-01-01', to: date } }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('rebuilds all views when a commit changes the shared cutoff during a read', async () => {
    const input = weight('70'); let inserted = false, revisionReads = 0;
    const racing = new Proxy(db, { get(target, key) {
      if (key !== 'prepare') return Reflect.get(target, key, target);
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.startsWith('SELECT status,data_revision,membership_revision')) return statement;
        return { bind: (...args: Array<string | number | null>) => ({ first: async () => {
          const value = await statement.bind(...args).first(); revisionReads++;
          if (!inserted) { inserted = true; await createWeight(db, auth, op(), input, clock); }
          return value;
        } }) };
      };
    } });
    const result = await readArtifacts(racing, auth, {}, clock);
    expect(revisionReads).toBe(4); expect(result.views.map(view => view.dataRevision)).toEqual([1, 1, 1]);
    expect(result.views[1]).toMatchObject({ props: { primaryEntryId: input.id, primaryKgMicros: 70000000 } });
  });
});

describe('artifact and weight read API', () => {
  it('has strict selectors and no conversation-specific or client-authored view state', async () => {
    const request = await requestClient();
    const response = await request('/artifacts'); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = await response.json(); expect(result.data).toHaveLength(3); expect(result.meta.query.ranges.training).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    for (const path of ['/artifacts?kind=FourthArtifact', `/artifacts?threadId=${op()}`, '/artifacts?energyMkcal=123', '/artifacts?from=2026-09-14', '/artifacts?kind=DietArtifact&from=2026-09-14&to=2026-09-16']) expect((await request(path)).status).toBe(400);
    const t = await training(); expect((await request(`/artifacts?kind=SessionArtifact&sessionId=${t.sessionId}`, other)).status).toBe(404);
  });
  it('paginates weight history and exposes raw trend points without filling gaps', async () => {
    const first = weight('70', '2026-09-14'); await createWeight(db, auth, op(), first, clock); await createWeight(db, auth, op(), weight('70.2'), clock);
    const request = await requestClient(), page = await (await request('/weights?limit=1')).json();
    expect(page.data.items).toHaveLength(1); expect(page.data.nextCursor).not.toBeNull();
    const next = await (await request(`/weights?limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`)).json(); expect(next.data.items).toHaveLength(1); expect(next.data.items[0].id).not.toBe(page.data.items[0].id);
    const trend = await (await request('/trends/weight?from=2026-09-14&to=2026-09-16')).json(); expect(trend.data.rawPoints).toHaveLength(2); expect(trend.data.trend[2]).toMatchObject({ meanKgMicros: null, sampleDays: 2 }); expect(trend.data.weeklyChangePct).toBeNull();
    await deleteWeight(db, auth, op(), first.id, 1, clock);
    expect((await (await request('/trends/weight?from=2026-09-14&to=2026-09-16')).json()).data.rawPoints).toHaveLength(1);
    expect((await request('/weights?limit=101')).status).toBe(400);
  });
  it('bounds previews while including every confirmed meal in the aggregate', async () => {
    for (let i = 0; i < 21; i++) await createMeal(db, auth, op(), meal(), clock);
    const request = await requestClient(), result = await (await request(`/artifacts?kind=DietArtifact&localDate=${date}`)).json();
    expect(result.data[0].props.mealIds).toHaveLength(20); expect(result.data[0].props.knownSum.energyMkcal).toBe(4200000); expect(result.data[0].props.unknownCounts.protein).toBe(21);
    expect(result.data[0].entityRefs.length).toBeLessThanOrEqual(100);
    const cursor = result.meta.query.collections.meals.nextCursor; expect(cursor).not.toBeNull();
    const page = await (await request(`/meals?from=${date}&to=${date}&cursor=${encodeURIComponent(cursor)}`)).json(); expect(page.data.items).toHaveLength(1);
  });
});
