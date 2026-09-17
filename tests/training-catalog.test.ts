import { beforeAll, afterAll, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { readFileSync } from 'node:fs';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { catalogReviewSchema, exerciseDisplaySnapshotSchema } from '../src/domain/training.ts';
import { readExercise } from '../src/server/exercises.ts';
const catalog = JSON.parse(readFileSync('db/catalog/training-first-six.json', 'utf8'));
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
it('publishes exactly six approved definitions and eighteen matching labels once', async () => {
  expect(catalog.entries).toHaveLength(6);
  for (const entry of catalog.entries) {
    const row = await readExercise(db, crypto.randomUUID(), entry.id);
    expect(row).toMatchObject({ scope: 'system', ownerId: null, revision: 1, movementPattern: entry.movementPattern, catalogVersion: catalog.version, catalogReview: { ...entry.review, sourceUrls: entry.sourceUrls } });
    const labels = await db.prepare('SELECT locale,display_name FROM exercise_labels WHERE exercise_id=?').bind(entry.id).all<{ locale: string; display_name: string }>();
    expect(Object.fromEntries(labels.results.map(row => [row.locale, row.display_name]))).toEqual(entry.labels);
  }
  expect(await applyMigrations(db)).toEqual([]);
  expect(await db.prepare('SELECT count(*) AS n FROM exercise_definitions').first('n')).toBe(6);
  expect(await db.prepare('SELECT count(*) AS n FROM exercise_labels').first('n')).toBe(18);
});
it('requires a real reviewer and timestamp for approved catalog data', () => {
  const approved = { ...catalog.entries[0].review, sourceUrls: catalog.entries[0].sourceUrls, sourceNote: 'Reviewed source' };
  expect(catalogReviewSchema.safeParse(approved).success).toBe(true);
  expect(catalogReviewSchema.safeParse({ ...approved, reviewedAt: null }).success).toBe(false);
  expect(catalogReviewSchema.safeParse({ ...approved, reviewedBy: null }).success).toBe(false);
  expect(catalogReviewSchema.safeParse({ ...approved, status: 'pending' }).success).toBe(false);
});
it('reads legacy display snapshots without inventing a movement classification', () => {
  const entry = catalog.entries[0];
  const snapshot = exerciseDisplaySnapshotSchema.parse({ schemaVersion: 1, exerciseId: entry.id, catalogVersion: 'legacy', name: 'Original name', locale: 'en', equipmentType: entry.equipmentType, equipmentInstance: null, variant: entry.variant, muscles: entry.muscles, loadSemantics: 'unspecified', includesBar: null, barWeightDecimal: null, barUnit: null });
  expect(snapshot.movementPattern).toBe('unspecified');
  expect(snapshot.name).toBe('Original name');
});

it('catalog defaults retain their origin without asserting a measured bar or RPE', async () => {
  const { defaultSetup } = await import('../src/domain/training-defaults.ts');
  const bench = await readExercise(db, crypto.randomUUID(), catalog.entries[3].id);
  const lb = defaultSetup(bench, 'lb', crypto.randomUUID()), kg = defaultSetup(bench, 'kg', crypto.randomUUID());
  expect(lb).toMatchObject({ loadSemantics: 'external_total', includesBar: true, barWeightDecimal: '45', barUnit: 'lb', defaultsOrigin: { defaultedFields: ['loadSemantics', 'includesBar', 'barWeightDecimal', 'barUnit'], overriddenFields: [] } });
  expect(kg).toMatchObject({ barWeightDecimal: '20', barUnit: 'kg' });
  expect(defaultSetup(await readExercise(db, crypto.randomUUID(), catalog.entries[4].id), 'lb', crypto.randomUUID()).loadSemantics).toBe('per_side');
  expect(defaultSetup(await readExercise(db, crypto.randomUUID(), catalog.entries[2].id), 'kg', crypto.randomUUID()).loadSemantics).toBe('assistance');
  expect(defaultSetup({ ...bench, scope: 'personal', catalogReview: null }, 'kg', crypto.randomUUID())).toMatchObject({ loadSemantics: 'unspecified', defaultsOrigin: null });
});
it('persists default provenance, rejects forged defaults and freezes it in exercise snapshots', async () => {
  const { defaultSetup } = await import('../src/domain/training-defaults.ts');
  const { createSetup, patchSetup, displaySnapshot } = await import('../src/server/exercises.ts');
  const { setups } = await import('../src/server/training-store.ts');
  const owner = crypto.randomUUID(), at = new Date().toISOString(), auth = { id: owner, role: 'member' as const, status: 'active' as const, locale: 'en' as const, timezone: 'UTC' };
  await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','UTC',?)").bind(owner, owner + '@example.invalid', at).run();
  const definition = await readExercise(db, owner, catalog.entries[3].id), input = defaultSetup(definition, 'lb', crypto.randomUUID());
  await expect(createSetup(db, auth, crypto.randomUUID(), { ...input, barWeightDecimal: '25' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await createSetup(db, auth, crypto.randomUUID(), input);
  const before = await setups.read(db, owner, input.id);
  const context = { db, auth, now: at, operationId: crypto.randomUUID() };
  const snapshot = (await displaySnapshot(context as Parameters<typeof displaySnapshot>[0], before)).snapshot;
  await patchSetup(db, auth, crypto.randomUUID(), input.id, before.revision, { loadUnit: 'kg' });
  expect(await setups.read(db, owner, input.id)).toMatchObject({ loadUnit: 'kg', barWeightDecimal: '45', barUnit: 'lb', defaultsOrigin: { overriddenFields: ['loadUnit'] } });
  expect(snapshot).toMatchObject({ barUnit: 'lb', defaultsOrigin: { overriddenFields: [] } });
});
