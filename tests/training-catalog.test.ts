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
