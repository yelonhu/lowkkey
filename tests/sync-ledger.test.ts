import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { ledgerKey, ledgerOwner, snapshotPageSchema, syncPageSchema } from '../src/domain/ledger.ts';
import type { LedgerItem, SnapshotPage } from '../src/domain/ledger.ts';
import { appendSnapshot, applySyncPage, visibleLedgerEntities } from '../src/domain/local-ledger.ts';
import type { LocalLedger, SnapshotAssembly } from '../src/domain/local-ledger.ts';
import { createApi } from '../src/server/api.ts';
import { accessVerifier, subjectKey } from '../src/server/auth.ts';
import type { AuthContext } from '../src/server/auth.ts';
import { readSync, readSyncSnapshot } from '../src/server/sync.ts';
import { createWeight, deleteWeight, patchWeight } from '../src/server/weights.ts';
import { createCustomExercise, createSetup } from '../src/server/exercises.ts';
import { addExercise, addSet, createSession, editSet, transitionSession } from '../src/server/training.ts';
import { createPlan, changePlanSelection } from '../src/server/plans.ts';
import { createCustomFood, savePortion } from '../src/server/foods.ts';
import { createMeal } from '../src/server/meals.ts';
import { saveFavorite, saveRecipe } from '../src/server/nutrition-library.ts';
import { undoTraining } from '../src/server/training-undo.ts';
import { createGoal } from '../src/server/goals.ts';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87', epoch = 'fa682cd1-1d70-4f27-87f0-4b143f53b624';
const auth: AuthContext = { id: owner, role: 'member', status: 'active', timezone: 'America/Chicago', locale: 'en' };
const clock = () => new Date('2026-09-16T20:00:00.000Z'), op = () => crypto.randomUUID();
const occurrence = { localDate: '2026-09-16', entryTimezone: auth.timezone, timePrecision: 'date', occurredAt: null };
const weight = (date = occurrence.localDate) => ({ ...occurrence, id: op(), localDate: date, value: '70', unit: 'kg', condition: 'unspecified' });
const component = () => ({ id: op(), originalName: 'Synthetic meal', quantityDecimal: '1', unit: 'serving', source: { kind: 'manual', nutrients: { energyKcal: '200', proteinG: null, carbsG: '20', fatG: '10' } } });
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  const tables = ['change_batches', 'operation_revisions', 'command_operations', 'mutation_guards', 'import_drafts', 'meal_items', 'meals', 'food_aliases', 'favorites', 'recipe_versions', 'personal_recipes', 'portion_definitions', 'nutrition_references', 'food_labels', 'food_definitions', 'source_assets', 'workout_sets', 'session_exercises', 'workout_sessions', 'scheduled_sessions', 'plan_selections', 'plan_versions', 'exercise_aliases', 'exercise_setups', 'exercise_labels', 'exercise_definitions', 'day_claims', 'weight_entries', 'goal_versions', 'user_profiles', 'invitations', 'users'];
  await db.batch(tables.map(table => db.prepare(`DELETE FROM ${table}`)));
  for (const id of [owner, other]) await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','America/Chicago',?)").bind(id, `${id}@example.invalid`, clock().toISOString()).run();
});
async function snapshot(actor = owner, limit = 100, database = db) {
  let cursor: string | undefined, staging: SnapshotAssembly | null = null;
  const pages: SnapshotPage[] = [];
  for (let count = 0; count < 200; count++) {
    const page = await readSyncSnapshot(database, actor, epoch, { cursor, limit }, clock); pages.push(page);
    const result = appendSnapshot(actor, staging, page);
    if (result.ledger) return { ledger: result.ledger, pages };
    staging = result.staging; cursor = page.nextCursor!;
  }
  throw new Error('Snapshot failed to finish');
}
const delta = (cursor: string, limit = 100, actor = owner, database = db) => readSync(database, actor, epoch, { cursor, limit }, clock);
async function training() {
  const exerciseId = op(), setupId = op(), sessionId = op(), sessionExerciseId = op(), setId = op();
  await createCustomExercise(db, auth, op(), { id: exerciseId, name: 'Fixture bench', locale: 'en', equipmentType: 'barbell', variant: { schemaVersion: 1, angle: 'flat', grip: 'pronated', laterality: 'bilateral', note: null }, muscles: { schemaVersion: 1, primary: ['chest'], secondary: ['triceps'] } }, clock);
  await createSetup(db, auth, op(), { id: setupId, exerciseId, equipmentInstance: 'Fixture bar', loadSemantics: 'external_total', loadUnit: 'lb', includesBar: true, barWeightDecimal: '45', barUnit: 'lb' }, clock);
  await createSession(db, auth, op(), { id: sessionId, localDate: occurrence.localDate, entryTimezone: auth.timezone, timePrecision: 'date' }, clock);
  await addExercise(db, auth, op(), sessionId, 1, { id: sessionExerciseId, setupId, ordinal: 1 }, clock);
  await addSet(db, auth, op(), sessionId, 2, { id: setId, sessionExerciseId, ordinal: 1, reps: 8, load: { value: '110', unit: 'lb', semantics: 'external_total' } }, clock);
  return { exerciseId, setupId, sessionId, sessionExerciseId, setId };
}
function sortedItems(ledger: LocalLedger): LedgerItem[] { return [...ledger.items.values()].sort((a, b) => ledgerKey(a).localeCompare(ledgerKey(b))); }

describe('owner ledger snapshots and changes', () => {
  it('starts an empty owner at a usable cursor without modifying health or membership state', async () => {
    const result = await snapshot(); expect(result.pages).toHaveLength(1); expect(result.ledger.items.size).toBe(0); expect(result.ledger.dataRevision).toBe(0);
    const page = await delta(result.ledger.cursor); expect(page.items).toEqual([]); expect(page.hasMore).toBe(false);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM command_operations').first('n')).toBe(0);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(0);
  });
  it('returns exact committed versions even if the entity has changed again before polling', async () => {
    const baseline = (await snapshot()).ledger, input = weight();
    const first = await createWeight(db, auth, op(), input, clock);
    await patchWeight(db, auth, op(), input.id, 1, { value: '70.2' }, clock);
    const page = await delta(baseline.cursor, 1); expect(page.items).toHaveLength(1); expect(page.items[0].operationId).toBe(first.operationId);
    expect(page.items[0].changes[0]).toMatchObject({ kind: 'weight_entry', value: { revision: 1, value: '70' } }); expect(page.hasMore).toBe(true);
    const afterFirst = applySyncPage(baseline, page); expect(afterFirst.dataRevision).toBe(1); expect(page.dataRevision).toBe(2);
    const final = applySyncPage(afterFirst, await delta(page.nextCursor, 1));
    expect(final.items.get(`weight_entry:${input.id}`)).toMatchObject({ value: { revision: 2, value: '70.2' } });
    expect(sortedItems(final)).toEqual(sortedItems((await snapshot()).ledger));
  });
  it('makes retries and repeated or older pages idempotent without reverting newer facts', async () => {
    const baseline = (await snapshot()).ledger, input = weight(), operation = op();
    await createWeight(db, auth, operation, input, clock); await createWeight(db, auth, operation, input, clock);
    const first = await delta(baseline.cursor), once = applySyncPage(baseline, first), twice = applySyncPage(once, first);
    expect(twice.dataRevision).toBe(1); expect(twice.items.size).toBe(1);
    await patchWeight(db, auth, op(), input.id, 1, { value: '70.3' }, clock);
    const current = applySyncPage(twice, await delta(twice.cursor));
    expect(applySyncPage(current, first)).toBe(current);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM change_batches').first('n')).toBe(2);
  });
  it('keeps complete ordered event batches and locally hides descendants of deleted parents', async () => {
    const baseline = (await snapshot()).ledger, t = await training();
    await editSet(db, auth, op(), t.sessionId, 3, t.setId, { expectedRevision: 1, reps: 5 }, false, clock);
    const afterEdit = applySyncPage(baseline, await delta(baseline.cursor));
    expect(afterEdit.items.get(`workout_set:${t.setId}`)).toMatchObject({ value: { reps: 5, revision: 2 } });
    const removed = await transitionSession(db, auth, op(), t.sessionId, 4, 'delete', clock);
    const page = await delta(afterEdit.cursor); expect(page.items[0].events.some(event => event.action === 'deleted')).toBe(true);
    const deleted = applySyncPage(afterEdit, page); expect(visibleLedgerEntities(deleted).some(item => item.kind === 'workout_set')).toBe(false);
    expect(deleted.items.has(`workout_set:${t.setId}`)).toBe(true);
    expect(sortedItems(deleted)).toEqual(sortedItems((await snapshot()).ledger));
    await undoTraining(db, auth, op(), removed.operationId, clock);
    const restored = applySyncPage(deleted, await delta(deleted.cursor));
    expect(visibleLedgerEntities(restored).find(item => item.kind === 'workout_set')).toMatchObject({ value: { reps: 5 } });
  });
  it('carries plan activation and future archival selections in their original command revisions', async () => {
    const baseline = (await snapshot()).ledger, id = op();
    await createPlan(db, auth, op(), { id, title: 'Future plan', basePlan: null, snapshot: { schemaVersion: 1, templates: [], weeklySchedule: [] } }, clock);
    await changePlanSelection(db, auth, op(), id, 1, { effectiveLocalDate: '2026-09-18', basePlan: { id, revision: 1 } }, 'archive', clock);
    const page = await delta(baseline.cursor);
    expect(page.items[0].supplements).toEqual([expect.objectContaining({ kind: 'plan_selection', value: expect.objectContaining({ planVersionId: id, dataRevision: 1, effectiveLocalDate: '2026-09-17' }) })]);
    expect(page.items[1].supplements[0]).toMatchObject({ value: { planVersionId: null, dataRevision: 2, effectiveLocalDate: '2026-09-18' } });
    expect(sortedItems(applySyncPage(baseline, page))).toEqual(sortedItems((await snapshot()).ledger));
  });
  it('includes frozen recipe versions, raw nutrient references, portions and favorite snapshots', async () => {
    const baseline = (await snapshot()).ledger, food = op(), reference = op(), recipe = op(), portion = op(), meal = op(), favorite = op();
    await createCustomFood(db, auth, op(), { id: food, name: 'Synthetic food', locale: 'en', kind: 'basic_food', referenceState: 'cooked', reference: { id: reference, basis: 'per_100g', nutrients: { energyKcal: '0.00049', proteinG: null, carbsG: null, fatG: null }, sourceName: 'Synthetic label', sourceVersion: 'fixture-v1', provenance: 'label' } }, clock);
    await savePortion(db, auth, op(), { id: portion, foodId: food, label: 'My portion', quantityDecimal: '1', unit: 'count', gramsDecimal: '150' }, undefined, clock);
    await saveRecipe(db, auth, op(), { id: recipe, title: 'My recipe', components: [component()], yieldServings: '2', yieldGramsDecimal: null, confirmYield: true }, undefined, clock);
    await saveRecipe(db, auth, op(), { yieldServings: '3', confirmYield: true }, { id: recipe, revision: 1 }, clock);
    await createMeal(db, auth, op(), { ...occurrence, id: meal, items: [component()] }, clock);
    await saveFavorite(db, auth, op(), { id: favorite, title: 'Breakfast', mealRef: { id: meal, revision: 1 } }, undefined, clock);
    const page = await delta(baseline.cursor), merged = applySyncPage(baseline, page);
    expect(page.items[0].supplements[0]).toMatchObject({ kind: 'nutrition_reference', value: { ownerId: owner, nutrients: { energyKcal: '0.00049', proteinG: null } } });
    expect(merged.items.get(`recipe_version:${recipe}:1`)).toMatchObject({ value: { dataRevision: 3, snapshot: { yieldServings: '2' } } });
    expect(merged.items.get(`recipe_version:${recipe}:2`)).toMatchObject({ value: { dataRevision: 4, snapshot: { yieldServings: '3' } } });
    expect(sortedItems(merged)).toEqual(sortedItems((await snapshot(owner, 3)).ledger));
  });
  it('includes the authoritative aggregate profile and immutable goal raw units in a snapshot', async () => {
    const now = clock().toISOString();
    await db.prepare("INSERT INTO user_profiles(id,owner_id,created_at,updated_at,display_name,next_digest_at) VALUES (?,?,?,?,?,?)").bind(op(), owner, now, now, 'Profile fixture', '2026-09-17T17:00:00.000Z').run();
    await createGoal(db, auth, op(), { id: op(), goalType: 'maintenance', baseGoal: null, amounts: { weightMin: '150', weightMax: '155', weightUnit: 'lb' } }, clock);
    const result = await snapshot();
    expect([...result.ledger.items.values()]).toContainEqual(expect.objectContaining({ kind: 'user_profile', value: expect.objectContaining({ locale: 'en', timezone: 'America/Chicago', bodyWeightUnit: 'kg', autoMemoryEnabled: true }) }));
    expect([...result.ledger.items.values()]).toContainEqual(expect.objectContaining({ kind: 'goal_version', value: expect.objectContaining({ rawInput: expect.objectContaining({ weightMin: '150', weightMax: '155', weightUnit: 'lb' }), effectiveLocalDate: '2026-09-17' }) }));
  });
  it('includes three-language public catalog data and invalidates a cursor when a catalog release changes', async () => {
    const food = op(), reference = op();
    await createCustomFood(db, auth, op(), { id: food, name: 'Synthetic public food', locale: 'en', kind: 'basic_food', referenceState: 'cooked', reference: { id: reference, basis: 'per_100g', nutrients: { energyKcal: '100', proteinG: null, carbsG: null, fatG: null }, sourceName: 'Synthetic fixture only', sourceVersion: 'fixture-v1', provenance: 'label' } }, clock);
    // Deliberately synthetic catalog fixture, not a reviewed nutrition seed.
    await db.prepare("UPDATE food_definitions SET scope='system',owner_id=NULL,personal_name=NULL,personal_locale=NULL,operation_id=NULL,created_operation_id=NULL,catalog_version='fixture-v1' WHERE id=?").bind(food).run();
    for (const [locale, name] of [['en', 'Synthetic food'], ['zh-Hans', '虚构食物'], ['zh-Hant', '虛構食物']]) await db.prepare('INSERT INTO food_labels(food_id,locale,display_name,search_terms) VALUES (?,?,?,?)').bind(food, locale, name, name).run();
    const result = (await snapshot(other, 1)).ledger;
    expect(result.items.get(`catalog_food:${food}`)).toMatchObject({ value: { definition: { scope: 'system', ownerId: null }, labels: expect.arrayContaining([expect.objectContaining({ locale: 'zh-Hant', displayName: '虛構食物' })]) } });
    expect(result.items.get(`nutrition_reference:${reference}`)).toMatchObject({ value: { ownerId: null, nutrients: { energyKcal: '100' } } });
    await db.prepare("UPDATE food_labels SET display_name='Updated fixture label' WHERE food_id=? AND locale='en'").bind(food).run();
    await expect(delta(result.cursor, 100, other)).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED', params: { reason: 'catalogChanged' } });
    const refreshed = (await snapshot(other)).ledger; expect(refreshed.catalogRevision).not.toBe(result.catalogRevision); expect(refreshed.dataRevision).toBe(result.dataRevision);
  });
  it('does not expose another owner, metadata from their recipes, or their cursor', async () => {
    const foreign = { ...auth, id: other };
    await createWeight(db, foreign, op(), weight(), clock);
    await saveRecipe(db, foreign, op(), { id: op(), title: 'Foreign recipe', components: [component()], yieldServings: '2', yieldGramsDecimal: null, confirmYield: true }, undefined, clock);
    const mine = (await snapshot()).ledger, theirs = (await snapshot(other)).ledger;
    expect(mine.items.size).toBe(0); expect([...theirs.items.values()].every(item => ledgerOwner(item) === other)).toBe(true);
    await expect(delta(theirs.cursor)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(() => applySyncPage(mine, { ...awaitablePage(mine), ownerId: other })).toThrow('OWNER_MISMATCH');
  });
  it('refuses expired, future, malformed, wrong-kind and restore-epoch cursors', async () => {
    const baseline = (await snapshot()).ledger;
    await expect(readSync(db, owner, op(), { cursor: baseline.cursor, limit: 20 }, clock)).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED' });
    await expect(readSync(db, owner, epoch, { cursor: baseline.cursor, limit: 20 }, () => new Date('2026-10-17T20:00:00.000Z'))).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED' });
    await expect(readSync(db, owner, epoch, { cursor: baseline.cursor, limit: 20 }, () => new Date('2026-09-15T20:00:00.000Z'))).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED' });
    await expect(delta('not-json')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(readSyncSnapshot(db, owner, epoch, { cursor: baseline.cursor, limit: 20 }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('detects an interior missing batch instead of advancing over the gap', async () => {
    const baseline = (await snapshot()).ledger;
    for (const date of ['2026-09-14', '2026-09-15', '2026-09-16']) await createWeight(db, auth, op(), weight(date), clock);
    await db.prepare('DELETE FROM change_batches WHERE owner_id=? AND data_revision=2').bind(owner).run();
    await expect(delta(baseline.cursor)).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED', params: { reason: 'missingBatches' } });
    expect((await snapshot()).ledger.items.size).toBe(3);
  });
  it('keeps partial snapshot pages invisible and rejects a continuation after a new commit', async () => {
    for (const date of ['2026-09-14', '2026-09-15']) await createWeight(db, auth, op(), weight(date), clock);
    const first = await readSyncSnapshot(db, owner, epoch, { limit: 1 }, clock);
    expect(first.items).toHaveLength(1); expect(first.syncCursor).toBeNull();
    const result = appendSnapshot(owner, null, first); expect(result.ledger).toBeNull(); expect(result.staging?.items.size).toBe(1);
    await createWeight(db, auth, op(), weight(), clock);
    await expect(readSyncSnapshot(db, owner, epoch, { limit: 1, cursor: first.nextCursor! }, clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', params: { reason: 'snapshotChanged' } });
    expect(() => appendSnapshot(owner, result.staging, { ...first, dataRevision: 3 })).toThrow('SNAPSHOT_CHANGED');
    expect((await snapshot(owner, 1)).ledger.items.size).toBe(3);
  });
  it('rebuilds a first snapshot when a real commit arrives between its revision checks', async () => {
    let changed = false;
    const racing = new Proxy(db, { get(target, property) {
      if (property !== 'prepare') return Reflect.get(target, property, target);
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.startsWith('SELECT status,data_revision,membership_revision')) return statement;
        return { bind: (...values: Array<string | number | null>) => ({ first: async () => {
          const result = await statement.bind(...values).first();
          if (!changed) { changed = true; await createWeight(db, auth, op(), weight(), clock); }
          return result;
        } }) };
      };
    } });
    const result = await snapshot(owner, 100, racing); expect(result.ledger.dataRevision).toBe(1); expect(result.ledger.items.size).toBe(1);
  });
  it('fails closed on malformed persisted changes and leaves the local cache intact', async () => {
    const baseline = (await snapshot()).ledger, input = weight(); await createWeight(db, auth, op(), input, clock);
    const row = await db.prepare('SELECT changes_json FROM change_batches WHERE owner_id=?').bind(owner).first<string>('changes_json');
    const changes = JSON.parse(row!) as Array<{ value: { ownerId: string } }>; changes[0].value.ownerId = other;
    await db.prepare('UPDATE change_batches SET changes_json=? WHERE owner_id=?').bind(JSON.stringify(changes), owner).run();
    await expect(delta(baseline.cursor)).rejects.toMatchObject({ code: 'TEMPORARY_FAILURE' }); expect(baseline.items.size).toBe(0);
  });
  it('validates client gaps, owners and baselines before applying any part of a batch', async () => {
    const baseline = (await snapshot()).ledger, input = weight(); await createWeight(db, auth, op(), input, clock);
    const first = await delta(baseline.cursor), once = applySyncPage(baseline, first);
    await patchWeight(db, auth, op(), input.id, 1, { value: '70.1' }, clock);
    const second = await delta(once.cursor);
    expect(() => applySyncPage(baseline, second)).toThrow('SYNC_GAP');
    expect(() => applySyncPage({ ...once, items: new Map() }, second)).toThrow('INVALID_LOCAL_BASELINE');
    expect(() => applySyncPage({ ...once, restoreEpoch: op() }, second)).toThrow('SNAPSHOT_REQUIRED');
    expect(once.items.get(`weight_entry:${input.id}`)).toMatchObject({ value: { value: '70', revision: 1 } });
    expect(syncPageSchema.safeParse({ ...second, items: [...second.items, ...second.items] }).success).toBe(false);
    expect(snapshotPageSchema.safeParse({ ...(await snapshot()).pages[0], injected: true }).success).toBe(false);
  });
  it('returns private snapshot and delta endpoints through a real signed identity', async () => {
    const issuer = 'https://sync-fixture.cloudflareaccess.com', pair = await generateKeyPair('RS256'), origin = 'http://127.0.0.1:5173';
    const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture', alg: 'RS256' }] });
    await db.prepare('UPDATE users SET verified_subject=? WHERE id=?').bind(subjectKey({ issuer, subject: owner }), owner).run();
    const api = createApi({ clock, verifyIdentity: accessVerifier({ teamDomain: 'sync-fixture.cloudflareaccess.com', audience: 'sync-test' }, resolver, clock) });
    const token = await new SignJWT({ email: `${owner}@example.invalid` }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(owner).setIssuer(issuer).setAudience('sync-test').setIssuedAt(Math.floor(clock().getTime() / 1000)).setExpirationTime(Math.floor(clock().getTime() / 1000) + 60).sign(pair.privateKey);
    const request = (path: string) => api.request(`/api/v1${path}`, { headers: { 'Cf-Access-Jwt-Assertion': token } }, { DB: db, APP_ORIGIN: origin, RESTORE_EPOCH: epoch });
    const response = await request('/sync/snapshot'); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const cursor = (await response.json()).data.syncCursor;
    const input = weight(); await createWeight(db, auth, op(), input, clock); await deleteWeight(db, auth, op(), input.id, 1, clock);
    const update = await request(`/sync?cursor=${encodeURIComponent(cursor)}&limit=1`); expect(update.status).toBe(200); expect((await update.json()).data.hasMore).toBe(true);
    for (const path of ['/sync', '/sync/snapshot?ownerId=other', '/sync/snapshot?threadId=anything', '/sync/snapshot?limit=101']) expect((await request(path)).status).toBe(400);
    await db.prepare("UPDATE users SET status='suspended',membership_revision=membership_revision+1 WHERE id=?").bind(owner).run();
    expect((await request('/sync/snapshot')).status).toBe(403);
  });
});
function awaitablePage(ledger: LocalLedger) { return { schemaVersion: 1, ownerId: ledger.ownerId, restoreEpoch: ledger.restoreEpoch, dataRevision: ledger.dataRevision, catalogRevision: ledger.catalogRevision, capturedAt: clock().toISOString(), fromRevision: ledger.dataRevision, items: [], nextCursor: ledger.cursor, hasMore: false }; }
