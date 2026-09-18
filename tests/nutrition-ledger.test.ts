import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { calculateItemNutrition, mealInputSchema, mealItemSnapshotSchema, nutritionReferenceSchema, referenceInputSchema } from '../src/domain/nutrition.ts';
import type { NutrientBasis, RawNutrients } from '../src/domain/nutrition.ts';
import { accessVerifier, subjectKey } from '../src/server/auth.ts';
import type { AuthContext } from '../src/server/auth.ts';
import { createApi } from '../src/server/api.ts';
import { createCustomFood, foodReferences, saveFoodAlias, savePortion, searchFoods } from '../src/server/foods.ts';
import { createMeal, createMealDraft, editMeal, editMealDraft, readMealTree } from '../src/server/meals.ts';
import { copyFavorite, readRecipeVersion, saveFavorite, saveRecipe } from '../src/server/nutrition-library.ts';
import { favorites, foodAliases, mealDrafts, mealItems, meals, portions, recipes } from '../src/server/nutrition-store.ts';
import { nutritionDaySummary } from '../src/server/nutrition-days.ts';
import { patchDayClaim, patchTrainingClaim } from '../src/server/days.ts';
import { claims } from '../src/server/training-store.ts';
import { undoNutrition } from '../src/server/nutrition-undo.ts';
import { createGoal } from '../src/server/goals.ts';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87';
const auth: AuthContext = { id: owner, role: 'member', locale: 'en', timezone: 'America/Chicago', status: 'active' };
const clock = () => new Date('2026-09-16T20:00:00.000Z');
const op = () => crypto.randomUUID();
const occurrence = { localDate: '2026-09-16', entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date' as const };
const raw: RawNutrients = { energyKcal: '200', proteinG: '20', carbsG: '5', fatG: '10' };
const unknown: RawNutrients = { energyKcal: null, proteinG: null, carbsG: null, fatG: null };
const manual = (nutrients: RawNutrients = raw) => ({ id: op(), originalName: 'My meal 我的餐', quantityDecimal: '1', unit: 'serving', source: { kind: 'manual', nutrients } });
const mealInput = (items = [manual()]) => ({ id: op(), ...occurrence, mealType: 'lunch', title: 'Lunch', items });
const draftInput = () => ({ id: op(), kind: 'meal', ...occurrence, description: 'Shared meal; portion still unknown' });
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  const tables = ['change_batches', 'operation_revisions', 'command_operations', 'mutation_guards', 'import_drafts', 'meal_items', 'meals', 'food_aliases', 'favorites', 'recipe_versions', 'personal_recipes', 'portion_definitions', 'nutrition_references', 'food_labels', 'food_definitions', 'source_assets', 'day_claims', 'goal_versions', 'users'];
  await db.batch(['DROP TRIGGER IF EXISTS reject_nutrition_event', ...tables.map(table => `DELETE FROM ${table}`)].map(sql => db.prepare(sql)));
  for (const id of [owner, other]) await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','America/Chicago',?)").bind(id, `${id}@example.invalid`, clock().toISOString()).run();
});
async function reference(nutrients = raw, actor = auth, basis = 'per_100g') {
  const id = op(), referenceId = op();
  await createCustomFood(db, actor, op(), { id, name: '本人熟食 Cooked food', locale: 'zh-Hant', kind: 'basic_food', referenceState: 'cooked', reference: { id: referenceId, basis, nutrients, sourceName: 'Synthetic label', sourceVersion: 'fixture-v1', provenance: 'label' } }, clock);
  return { id, referenceId };
}
async function recorded(input = mealInput()) { await createMeal(db, auth, op(), input, clock); return input; }
async function complete(date = occurrence.localDate, explicitZeroIntake?: boolean) {
  const existing = (await claims.list(db, owner, 'local_date=?', [date]))[0];
  return patchDayClaim(db, auth, op(), date, existing?.revision, { id: existing?.id ?? op(), entryTimezone: occurrence.entryTimezone, nutritionCompleteness: 'complete', expectedNutritionContentRevision: existing?.nutritionContentRevision ?? 0, ...(explicitZeroIntake === undefined ? {} : { explicitZeroIntake }) }, clock);
}
async function source(actor = owner) {
  const id = op(), now = clock().toISOString();
  await db.prepare("INSERT INTO source_assets(id,owner_id,revision,created_at,updated_at,kind,object_key,mime,byte_size,width,height,sha256,status,last_used_at) VALUES (?,?,1,?,?,'image',?,'image/png',70,1,1,?,'ready',?)").bind(id, actor, now, now, `${actor}/${id}`, 'a'.repeat(64), now).run();
  return id;
}

describe('nutrition values and source boundaries', () => {
  it('scales a 150 g portion consumed halfway once, retaining the raw reference', async () => {
    const food = await reference(), item = { id: op(), originalName: 'Cooked food', quantityDecimal: '150', unit: 'g', consumptionFraction: '0.5', source: { kind: 'reference', referenceId: food.referenceId } }, input = { ...mealInput(), items: [item] };
    await createMeal(db, auth, op(), input, clock);
    expect((await readMealTree(db, owner, input.id)).items[0].snapshot).toMatchObject({ referenceState: 'cooked', quantityDecimal: '150', consumptionFraction: '0.5', nutrientBasis: { nutrients: raw }, nutrientSnapshot: { energyMkcal: 150000, proteinMg: 15000, carbsMg: 3750, fatMg: 7500, provenance: 'label' } });
  });
  it('does not round a reference before multiplying, and repeated edits reuse its original basis', async () => {
    const food = await reference({ ...unknown, energyKcal: '0.00049' }), id = op(), item = { id: op(), originalName: 'Tiny synthetic reference', quantityDecimal: '1000', unit: 'g', source: { kind: 'reference', referenceId: food.referenceId } };
    await createMeal(db, auth, op(), { ...mealInput(), id, items: [item] }, clock);
    expect((await readMealTree(db, owner, id)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(5);
    for (const [revision, quantityDecimal, expected] of [[1, '100', 0], [2, '1000', 5]] as const) {
      await editMeal(db, auth, op(), id, revision, { items: [{ ...item, quantityDecimal, expectedRevision: revision, source: { kind: 'existing' } }] }, false, clock);
      expect((await readMealTree(db, owner, id)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(expected);
    }
  });
  it('retains a manual calorie value even when macros imply a different value', async () => {
    const input = await recorded(mealInput([manual({ energyKcal: '123', proteinG: '10', carbsG: '10', fatG: '10' })]));
    expect((await readMealTree(db, owner, input.id)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(123000);
    const item = manual({ energyKcal: '123', proteinG: '0.00004', carbsG: '0.00004', fatG: '0.00004' });
    const selected = { ...mealInput(), items: [{ ...item, source: { ...item.source, calculateEnergy: true } }] };
    await createMeal(db, auth, op(), selected, clock);
    expect((await readMealTree(db, owner, selected.id)).items[0].snapshot).toMatchObject({ nutrientBasis: { nutrients: { energyKcal: '0.00068' }, calculationInput: { provenance: 'user_entered', nutrients: { energyKcal: '123' } } }, nutrientSnapshot: { energyMkcal: 1, provenance: 'calculated', estimated: true, calculationVersion: 'macro-4-4-9-v1' } });
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [{ ...manual(), source: { kind: 'manual', nutrients: unknown, calculateEnergy: true } }] }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
  });
  it('requires an actual food-specific conversion; ml never becomes g implicitly', async () => {
    const food = await reference(), portionId = op(), item = { id: op(), originalName: 'Food', quantityDecimal: '150', unit: 'ml', source: { kind: 'reference', referenceId: food.referenceId } };
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [item] }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'portionConversionUnknown' } });
    await savePortion(db, auth, op(), { id: portionId, foodId: food.id, label: 'Known density', quantityDecimal: '1', unit: 'ml', densityDecimal: '0.5', estimated: false }, undefined, clock);
    const input = { ...mealInput(), items: [{ ...item, source: { ...item.source, portionRef: { id: portionId, revision: 1 } } }] };
    await createMeal(db, auth, op(), input, clock);
    expect((await readMealTree(db, owner, input.id)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(150000);
    const otherFood = await reference();
    await expect(createMeal(db, auth, op(), { ...input, id: op(), items: [{ ...input.items[0], id: op(), source: { ...input.items[0].source, referenceId: otherFood.referenceId } }] }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'portionFoodMismatch' } });
  });
  it('preserves a frozen portion after its definition changes or is deleted', async () => {
    const food = await reference(), portionId = op();
    await savePortion(db, auth, op(), { id: portionId, foodId: food.id, label: '我的碗', quantityDecimal: '1', unit: 'count', gramsDecimal: '150' }, undefined, clock);
    const item = { id: op(), originalName: '我的碗', quantityDecimal: '1', unit: 'count', source: { kind: 'reference', referenceId: food.referenceId, portionRef: { id: portionId, revision: 1 } } }, input = { ...mealInput(), items: [item] };
    await createMeal(db, auth, op(), input, clock);
    await savePortion(db, auth, op(), { gramsDecimal: '200' }, { id: portionId, revision: 1 }, clock);
    await savePortion(db, auth, op(), {}, { id: portionId, revision: 2, deleting: true }, clock);
    await editMeal(db, auth, op(), input.id, 1, { items: [{ ...item, quantityDecimal: '2', expectedRevision: 1, source: { kind: 'existing' } }] }, false, clock);
    expect((await readMealTree(db, owner, input.id)).items[0].snapshot).toMatchObject({ portionSnapshot: { revision: 1, gramsDecimal: '150', estimated: true }, nutrientSnapshot: { energyMkcal: 600000, estimated: true } });
  });
  it('does not treat a generic bowl as a food-specific weight', async () => {
    const food = await reference(), id = op();
    await savePortion(db, auth, op(), { id, label: 'Bowl', quantityDecimal: '1', unit: 'count', gramsDecimal: '150' }, undefined, clock);
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [{ ...manual(), unit: 'count', source: { kind: 'reference', referenceId: food.referenceId, portionRef: { id, revision: 1 } } }] }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
  });
  it('enforces the unrounded amount and requires large-portion confirmation', async () => {
    const item = manual({ ...unknown, energyKcal: '3000.00000001' });
    await expect(createMeal(db, auth, op(), mealInput([item]), clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
    await createMeal(db, auth, op(), { ...mealInput(), items: [{ ...item, confirmLargePortion: true }] }, clock);
    const food = await reference({ ...unknown, energyKcal: '10000' });
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [{ ...manual(), unit: 'g', quantityDecimal: '100.000000001', confirmLargePortion: true, source: { kind: 'reference', referenceId: food.referenceId } }] }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT', params: { reason: 'nutrientOutOfRange' } });
  });
  it('rejects invalid basis, mass-assignment and forged source flags', () => {
    expect(referenceInputSchema.safeParse({ id: op(), basis: 'per_serving', nutrients: raw, sourceName: 'Test', sourceVersion: 'v1', provenance: 'label' }).success).toBe(false);
    expect(referenceInputSchema.safeParse({ id: op(), basis: 'per_100g', nutrients: raw, sourceName: 'Test', sourceVersion: 'v1', provenance: 'reference' }).success).toBe(false);
    expect(nutritionReferenceSchema.safeParse({ id: op(), foodId: op(), basis: 'per_serving', nutrients: raw, sourceName: 'Test', sourceVersion: 'v1', provenance: 'reference', retrievedAt: clock().toISOString() }).success).toBe(false);
    expect(mealInputSchema.safeParse({ ...mealInput(), ownerId: other }).success).toBe(false);
    expect(mealInputSchema.safeParse(mealInput([manual({ ...raw, proteinG: '2000.00001' })])).success).toBe(false);
  });
  it('retains unknown values even for a zero consumption fraction and blocks invented AI precision', () => {
    const basis: NutrientBasis = { schemaVersion: 1, nutrients: { ...unknown, energyKcal: '200' }, quantityDecimal: '100', unit: 'g', provenance: 'ai_estimate', estimated: true, referenceVersion: null, calculationVersion: null, calculationInput: null, recipeId: null, recipeVersion: null };
    const snapshot = calculateItemNutrition(basis, '100', 'g', '0', null);
    expect(snapshot).toMatchObject({ energyMkcal: 0, proteinMg: null, estimated: true });
    expect(mealItemSnapshotSchema.safeParse({ schemaVersion: 1, originalName: 'Estimate', foodId: null, referenceId: null, referenceState: 'unknown', quantityDecimal: '100', unit: 'g', consumptionFraction: '0', portionSnapshot: null, nutrientBasis: basis, nutrientSnapshot: snapshot, provenance: 'ai_estimate', estimated: false, assumptionNote: null }).success).toBe(false);
  });
});

describe('nutrition completion, dates and drafts', () => {
  it('keeps empty days unknown until explicitly confirming no intake', async () => {
    expect((await nutritionDaySummary(db, owner, occurrence.localDate)).knownSum.energyMkcal).toBeNull();
    await expect(complete()).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'confirmZeroIntake' } });
    await complete(occurrence.localDate, true);
    expect((await nutritionDaySummary(db, owner, occurrence.localDate)).knownSum).toMatchObject({ energyMkcal: 0, proteinMg: 0 });
    await recorded();
    expect((await nutritionDaySummary(db, owner, occurrence.localDate)).claim).toMatchObject({ nutritionCompleteness: 'partial', explicitZeroIntake: false, nutritionReviewedAt: clock().toISOString(), reviewInvalidatedReason: 'mealCreated' });
  });
  it('counts every unknown metric separately even on a complete day', async () => {
    await recorded(mealInput([manual({ ...unknown, energyKcal: '100', proteinG: '80' }), manual({ ...unknown, energyKcal: '50' })]));
    await complete();
    const result = await nutritionDaySummary(db, owner, occurrence.localDate);
    expect(result).toMatchObject({ completeness: 'complete', knownSum: { energyMkcal: 150000, proteinMg: 80000, carbsMg: null }, unknownCounts: { energy: 0, protein: 1, carbs: 2, fat: 2 }, metrics: { proteinMg: { knownSum: 80000, unknownItemCount: 1, target: null, remaining: null } } });
  });
  it('shows relative target remaining or overage without inventing an energy deficit', async () => {
    await createGoal(db, auth, op(), { id: op(), goalType: 'maintenance', baseGoal: null, effectiveLocalDate: occurrence.localDate, confirmToday: true, amounts: { energyKcal: '100', proteinG: '50' } }, clock);
    await recorded();
    expect((await nutritionDaySummary(db, owner, occurrence.localDate)).metrics).toMatchObject({ energyMkcal: { knownSum: 200000, remaining: 0, overTarget: 100000, dayCompleteness: 'unreviewed' }, proteinMg: { remaining: 30000, overTarget: 0 } });
  });
  it('keeps text/photo drafts out of confirmed totals and invalidates a previous review', async () => {
    await recorded(); await complete();
    const input = { ...draftInput(), sourceIds: [await source()] }; await createMealDraft(db, auth, op(), input, clock);
    expect(await nutritionDaySummary(db, owner, occurrence.localDate)).toMatchObject({ mealCount: 1, pendingDraftCount: 1, completeness: 'partial', knownSum: { energyMkcal: 200000 }, claim: { reviewInvalidatedReason: 'mealDraftAdded', nutritionReviewedAt: clock().toISOString() } });
    await expect(complete()).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'pendingMeals' } });
    await editMealDraft(db, auth, op(), input.id, 1, {}, true, clock); await complete();
  });
  it('saves description-only input as a draft and confirms it once with the meal in one batch', async () => {
    await expect(createMeal(db, auth, op(), mealInput([manual(unknown)]), clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'saveAsDraft' } });
    const draft = draftInput(); await createMealDraft(db, auth, op(), draft, clock);
    const input = { ...mealInput(), draftRef: { id: draft.id, revision: 1 } }, operationId = op();
    const first = await createMeal(db, auth, operationId, input, clock);
    expect(await createMeal(db, auth, operationId, input, clock)).toEqual(first);
    expect(await mealDrafts.read(db, owner, draft.id)).toMatchObject({ status: 'confirmed', confirmedMealId: input.id, revision: 2 });
    expect(await nutritionDaySummary(db, owner, occurrence.localDate)).toMatchObject({ mealCount: 1, pendingDraftCount: 0 });
    await expect(createMeal(db, auth, op(), { ...input, id: op() }, clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('invalidates both dates when moving a meal, but leaves other days and training claims intact', async () => {
    const input = await recorded(), today = occurrence.localDate, yesterday = '2026-09-15';
    await complete(); await complete(yesterday, true);
    const claim = (await claims.list(db, owner, 'local_date=?', [today]))[0];
    await patchTrainingClaim(db, auth, op(), today, claim.revision, { id: claim.id, entryTimezone: occurrence.entryTimezone, trainingClaim: 'rest_confirmed' }, clock);
    expect((await nutritionDaySummary(db, owner, today)).completeness).toBe('complete');
    await editMeal(db, auth, op(), input.id, 1, { localDate: yesterday }, false, clock);
    expect((await nutritionDaySummary(db, owner, today)).claim).toMatchObject({ nutritionCompleteness: 'partial', trainingClaim: 'rest_confirmed' });
    expect((await nutritionDaySummary(db, owner, yesterday)).completeness).toBe('partial');
    expect((await nutritionDaySummary(db, owner, '2026-09-14')).completeness).toBe('unreviewed');
  });
  it('preserves null vs omission and does not convert future intent into an actual meal', async () => {
    const input = await recorded();
    await editMeal(db, auth, op(), input.id, 1, { mealType: 'dinner' }, false, clock);
    expect((await meals.read(db, owner, input.id)).title).toBe('Lunch');
    await editMeal(db, auth, op(), input.id, 2, { title: null }, false, clock);
    expect(await meals.read(db, owner, input.id)).toMatchObject({ title: null, occurredAt: null, timePrecision: 'date' });
    await expect(createMeal(db, auth, op(), { ...mealInput(), localDate: '2026-09-17' }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(createMeal(db, auth, op(), { ...mealInput(), localDate: '2026-09-15', occurredAt: clock().toISOString(), timePrecision: 'instant' }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await createMealDraft(db, auth, op(), { ...draftInput(), localDate: '2026-09-17' }, clock);
    expect((await nutritionDaySummary(db, owner, '2026-09-17')).knownSum.energyMkcal).toBeNull();
  });
  it('refuses a stale claim and impossible explicit-zero declaration', async () => {
    await recorded(); await complete();
    await expect(complete(occurrence.localDate, true)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT' });
    const claim = (await claims.list(db, owner))[0];
    await expect(patchDayClaim(db, auth, op(), occurrence.localDate, undefined, { id: claim.id, entryTimezone: occurrence.entryTimezone, nutritionCompleteness: 'partial' }, clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
});

describe('nutrition atomic edits, ownership and undo', () => {
  it('returns one receipt for concurrent duplicate requests and rejects a reused key with new content', async () => {
    const input = mealInput(), operationId = op();
    const result = await Promise.all([createMeal(db, auth, operationId, input, clock), createMeal(db, auth, operationId, input, clock)]);
    expect(result[0]).toEqual(result[1]);
    await expect(createMeal(db, auth, operationId, { ...input, title: 'Changed' }, clock)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await meals.list(db, owner))).toHaveLength(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM change_batches WHERE operation_id=?').bind(operationId).first('n')).toBe(1);
  });
  it('permits only one edit at the root version and stages item swaps atomically', async () => {
    const input = await recorded(mealInput([manual(), manual({ ...raw, energyKcal: '300' })]));
    const items = input.items.slice().reverse().map(item => ({ ...item, expectedRevision: 1, source: { kind: 'existing' } }));
    await editMeal(db, auth, op(), input.id, 1, { items }, false, clock);
    expect((await readMealTree(db, owner, input.id)).items.map(item => item.id)).toEqual(items.map(item => item.id));
    const results = await Promise.allSettled([editMeal(db, auth, op(), input.id, 2, { title: 'A' }, false, clock), editMeal(db, auth, op(), input.id, 2, { title: 'B' }, false, clock)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'REVISION_CONFLICT' } }]);
  });
  it('rolls back meal, completeness, versions, receipt and audit on event failure', async () => {
    await complete(occurrence.localDate, true);
    const input = mealInput(), operationId = op(), revision = await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision');
    await db.prepare("CREATE TRIGGER reject_nutrition_event BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'injected'); END").run();
    await expect(createMeal(db, auth, operationId, input, clock)).rejects.toThrow();
    expect(await meals.list(db, owner)).toHaveLength(0); expect(await mealItems.list(db, owner)).toHaveLength(0);
    expect((await claims.list(db, owner))[0]).toMatchObject({ revision: 1, nutritionCompleteness: 'complete', explicitZeroIntake: true });
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(revision);
    for (const table of ['command_operations', 'operation_revisions', 'change_batches']) expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE operation_id=?`).bind(operationId).first('n')).toBe(0);
  });
  it('does not mark a draft confirmed when the meal transaction fails', async () => {
    const draft = draftInput(); await createMealDraft(db, auth, op(), draft, clock);
    await db.prepare("CREATE TRIGGER reject_nutrition_event BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'injected'); END").run();
    await expect(createMeal(db, auth, op(), { ...mealInput(), draftRef: { id: draft.id, revision: 1 } }, clock)).rejects.toThrow();
    expect(await mealDrafts.read(db, owner, draft.id)).toMatchObject({ status: 'needs_input', revision: 1, confirmedMealId: null });
    expect(await meals.list(db, owner)).toHaveLength(0);
  });
  it('rejects another owner’s meal, reference, portion, draft and photo', async () => {
    const input = await recorded(), foreignFood = await reference(raw, { ...auth, id: other }), draft = draftInput(); await createMealDraft(db, auth, op(), draft, clock);
    await expect(readMealTree(db, other, input.id)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [{ ...manual(), source: { kind: 'reference', referenceId: foreignFood.referenceId } }] }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(createMeal(db, { ...auth, id: other }, op(), { ...mealInput(), draftRef: { id: draft.id, revision: 1 } }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(createMealDraft(db, auth, op(), { ...draftInput(), sourceIds: [await source(other)] }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    const food = await reference(), portionId = op(); await savePortion(db, { ...auth, id: other }, op(), { id: portionId, label: 'Other bowl', quantityDecimal: '1', unit: 'count', gramsDecimal: '150' }, undefined, clock);
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [{ ...manual(), source: { kind: 'reference', referenceId: food.referenceId, portionRef: { id: portionId, revision: 1 } } }] }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('rejects a same-owner child from another meal and enforces composite foreign keys', async () => {
    const first = await recorded(), second = await recorded();
    await expect(editMeal(db, auth, op(), second.id, 1, { items: [{ ...first.items[0], expectedRevision: 1, source: { kind: 'existing' } }] }, false, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(db.prepare('UPDATE meal_items SET owner_id=? WHERE id=?').bind(other, first.items[0].id).run()).rejects.toThrow();
  });
  it('undoes a swapped tree but rejects old undo after later modifications', async () => {
    const input = await recorded(mealInput([manual(), manual()])), operationId = op();
    await editMeal(db, auth, operationId, input.id, 1, { items: input.items.slice().reverse().map(item => ({ ...item, expectedRevision: 1, source: { kind: 'existing' } })) }, false, clock);
    await undoNutrition(db, auth, op(), operationId, clock);
    expect((await readMealTree(db, owner, input.id)).items.map(item => item.id)).toEqual(input.items.map(item => item.id));
    const next = op(); await editMeal(db, auth, next, input.id, 3, { title: 'First edit' }, false, clock);
    await editMeal(db, auth, op(), input.id, 4, { title: 'Later edit' }, false, clock);
    await expect(undoNutrition(db, auth, op(), next, clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await meals.read(db, owner, input.id)).title).toBe('Later edit');
  });
  it('excludes tombstoned meals from totals and makes a later completeness review partial on undo', async () => {
    const input = await recorded(), removed = op(); await editMeal(db, auth, removed, input.id, 1, {}, true, clock);
    expect((await nutritionDaySummary(db, owner, occurrence.localDate)).knownSum.energyMkcal).toBeNull();
    await complete(occurrence.localDate, true);
    await undoNutrition(db, auth, op(), removed, clock);
    expect(await nutritionDaySummary(db, owner, occurrence.localDate)).toMatchObject({ knownSum: { energyMkcal: 200000 }, completeness: 'partial', claim: { explicitZeroIntake: false, reviewInvalidatedReason: 'nutritionUndo' } });
  });
  it('undoes draft confirmation to a pending draft without duplicating its meal', async () => {
    const draft = draftInput(); await createMealDraft(db, auth, op(), draft, clock);
    const input = { ...mealInput(), draftRef: { id: draft.id, revision: 1 } }, operationId = op(); await createMeal(db, auth, operationId, input, clock);
    await undoNutrition(db, auth, op(), operationId, clock);
    expect(await mealDrafts.read(db, owner, draft.id)).toMatchObject({ status: 'needs_input', confirmedMealId: null, revision: 3 });
    expect(await nutritionDaySummary(db, owner, occurrence.localDate)).toMatchObject({ mealCount: 0, pendingDraftCount: 1 });
  });
});

describe('recipes, favorites and personal catalogue', () => {
  it('retains immutable recipe versions and old meal snapshots after editing yield or ingredients', async () => {
    const id = op(), component = manual({ ...raw, energyKcal: '600' });
    await saveRecipe(db, auth, op(), { id, title: 'My recipe', yieldServings: '3', yieldGramsDecimal: null, components: [component], confirmYield: true }, undefined, clock);
    const item = { ...manual(), source: { kind: 'recipe', id, revision: 1 } }, input = { ...mealInput(), items: [item] };
    await createMeal(db, auth, op(), input, clock);
    await saveRecipe(db, auth, op(), { yieldServings: '2', components: [{ ...component, source: { ...component.source, nutrients: { ...raw, energyKcal: '1000' } } }], confirmYield: true }, { id, revision: 1 }, clock);
    expect(await readRecipeVersion(db, owner, id, 1)).toMatchObject({ yieldServings: '3', nutrientSnapshot: { energyMkcal: 600000 } });
    expect(await readRecipeVersion(db, owner, id, 2)).toMatchObject({ yieldServings: '2', nutrientSnapshot: { energyMkcal: 1000000 } });
    expect((await readMealTree(db, owner, input.id)).items[0].snapshot).toMatchObject({ nutrientBasis: { recipeId: id, recipeVersion: 1 }, nutrientSnapshot: { energyMkcal: 200000 } });
    await editMeal(db, auth, op(), input.id, 1, { items: [{ ...item, quantityDecimal: '2', expectedRevision: 1, source: { kind: 'existing' } }] }, false, clock);
    expect((await readMealTree(db, owner, input.id)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(400000);
    const fresh = { ...mealInput(), items: [{ ...item, id: op(), source: { kind: 'recipe', id, revision: 2 } }] }; await createMeal(db, auth, op(), fresh, clock);
    expect((await readMealTree(db, owner, fresh.id)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(500000);
  });
  it('does not turn a partial recipe sum into a known total or invent gram yield', async () => {
    const id = op(); await saveRecipe(db, auth, op(), { id, title: 'Partial recipe', yieldServings: '2', yieldGramsDecimal: null, components: [manual(), manual({ ...raw, energyKcal: null })], confirmYield: true }, undefined, clock);
    expect((await recipes.read(db, owner, id)).nutrientSnapshot).toMatchObject({ energyMkcal: null, proteinMg: 40000 });
    await expect(createMeal(db, auth, op(), { ...mealInput(), items: [{ ...manual(), unit: 'g', quantityDecimal: '100', source: { kind: 'recipe', id, revision: 1 } }] }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'recipeYieldUnknown' } });
  });
  it('requires yield confirmation on recipe content edits and keeps serving arithmetic exact', async () => {
    const id = op(), component = manual(); await saveRecipe(db, auth, op(), { id, title: 'Recipe', yieldServings: '3', yieldGramsDecimal: null, components: [component], confirmYield: true }, undefined, clock);
    await expect(saveRecipe(db, auth, op(), { yieldServings: '2' }, { id, revision: 1 }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
    await saveRecipe(db, auth, op(), { components: [{ ...component, quantityDecimal: '2', source: { kind: 'existing' } }], confirmYield: true }, { id, revision: 1 }, clock);
    expect((await recipes.read(db, owner, id)).nutrientSnapshot.energyMkcal).toBe(400000);
    await expect(readRecipeVersion(db, other, id, 1)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('copies a favorite to independent item IDs and keeps older meals when it changes', async () => {
    const original = await recorded(), favoriteId = op(); await saveFavorite(db, auth, op(), { id: favoriteId, title: 'Breakfast', mealRef: { id: original.id, revision: 1 } }, undefined, clock);
    const first = op(); await copyFavorite(db, auth, op(), favoriteId, { id: first, ...occurrence, expectedRevision: 1 }, clock);
    const firstTree = await readMealTree(db, owner, first); expect(firstTree.items[0].id).not.toBe(original.items[0].id);
    await editMeal(db, auth, op(), original.id, 1, { items: [{ ...original.items[0], expectedRevision: 1, quantityDecimal: '2', source: { kind: 'existing' } }] }, false, clock);
    await saveFavorite(db, auth, op(), { mealRef: { id: original.id, revision: 2 } }, { id: favoriteId, revision: 1 }, clock);
    const next = op(); await copyFavorite(db, auth, op(), favoriteId, { id: next, ...occurrence, expectedRevision: 2 }, clock);
    expect((await readMealTree(db, owner, first)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(200000);
    expect((await readMealTree(db, owner, next)).items[0].snapshot.nutrientSnapshot.energyMkcal).toBe(400000);
    expect((await favorites.read(db, owner, favoriteId)).version).toBe(2);
    await expect(copyFavorite(db, { ...auth, id: other }, op(), favoriteId, { id: op(), ...occurrence, expectedRevision: 2 }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('supports three-language standard labels and owner-specific ambiguous aliases', async () => {
    const first = await reference(), second = await reference();
    for (const id of [first.id, second.id]) await saveFoodAlias(db, auth, op(), { id: op(), type: 'food', text: '我的早餐', target: { type: 'food', id } }, undefined, clock);
    expect((await searchFoods(db, owner, { q: '我的早餐', locale: 'en', limit: 20 })).items).toHaveLength(2);
    expect((await searchFoods(db, other, { q: '我的早餐', locale: 'zh-Hant', limit: 20 })).items).toHaveLength(0);
    const standard = op(), now = clock().toISOString();
    await db.prepare("INSERT INTO food_definitions(id,revision,created_at,updated_at,scope,catalog_version,kind,reference_state,status) VALUES (?,1,?,?,'system','synthetic-catalog','basic_food','raw','active')").bind(standard, now, now).run();
    for (const [locale, name] of [['zh-Hans', '三文鱼'], ['zh-Hant', '鮭魚'], ['en', 'Salmon']]) await db.prepare('INSERT INTO food_labels(food_id,locale,display_name,search_terms) VALUES (?,?,?,?)').bind(standard, locale, name, '三文鱼 鮭魚 salmon').run();
    for (const query of ['三文鱼', '鮭魚', 'SALMON']) expect((await searchFoods(db, owner, { q: query, locale: 'zh-Hant', limit: 20 })).items).toMatchObject([{ id: standard, name: '鮭魚' }]);
    expect((await foodReferences(db, owner, first.id))[0].sourceVersion).toBe('fixture-v1');
  });
  it('keeps omitted portion and alias fields unchanged while allowing explicit null', async () => {
    const food = await reference(), portionId = op(); await savePortion(db, auth, op(), { id: portionId, foodId: food.id, label: 'Bowl', quantityDecimal: '1', unit: 'count', gramsDecimal: '100', estimated: false }, undefined, clock);
    await savePortion(db, auth, op(), { label: 'My bowl' }, { id: portionId, revision: 1 }, clock);
    expect(await portions.read(db, owner, portionId)).toMatchObject({ gramsDecimal: '100', gramsMilli: 100000, estimated: false, foodId: food.id });
    await savePortion(db, auth, op(), { gramsDecimal: null }, { id: portionId, revision: 2 }, clock);
    expect(await portions.read(db, owner, portionId)).toMatchObject({ gramsDecimal: null, gramsMilli: null });
    const aliasId = op(); await saveFoodAlias(db, auth, op(), { id: aliasId, type: 'food', text: '午餐', localeHint: 'zh-Hans', target: { type: 'food', id: food.id } }, undefined, clock);
    await saveFoodAlias(db, auth, op(), { text: 'Lunch' }, { id: aliasId, revision: 1 }, clock);
    expect((await foodAliases.read(db, owner, aliasId)).localeHint).toBe('zh-Hans');
    await saveFoodAlias(db, auth, op(), { localeHint: null }, { id: aliasId, revision: 2 }, clock);
    expect((await foodAliases.read(db, owner, aliasId)).localeHint).toBeNull();
  });
});

describe('authenticated nutrition API', () => {
  async function client() {
    const issuer = 'https://nutrition-fixture.cloudflareaccess.com', pair = await generateKeyPair('RS256'), origin = 'http://127.0.0.1:5173';
    const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture', alg: 'RS256' }] });
    for (const user of [owner, other]) await db.prepare('UPDATE users SET verified_subject=? WHERE id=?').bind(subjectKey({ issuer, subject: user }), user).run();
    const app = createApi({ clock, verifyIdentity: accessVerifier({ teamDomain: 'nutrition-fixture.cloudflareaccess.com', audience: 'nutrition-test' }, resolver, clock) });
    return async (path: string, method = 'GET', payload?: unknown, user = owner, expectedRevision?: number, operationId = op()) => {
      const jwt = await new SignJWT({ email: `${user}@example.invalid` }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(user).setIssuer(issuer).setAudience('nutrition-test').setIssuedAt(Math.floor(clock().getTime() / 1000)).setExpirationTime(Math.floor(clock().getTime() / 1000) + 60).sign(pair.privateKey);
      return app.request(`/api/v1${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwt, 'Idempotency-Key': operationId, ...(expectedRevision ? { 'If-Match': `"${expectedRevision}"` } : {}) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }, { DB: db, APP_ORIGIN: origin, RESTORE_EPOCH: 'fa682cd1-1d70-4f27-87f0-4b143f53b624' });
    };
  }
  it('executes capture, manual confirmation, edit, completeness, copy and undo through authenticated routes', async () => {
    const request = await client(), draft = draftInput(), input = { ...mealInput(), draftRef: { id: draft.id, revision: 1 } };
    expect((await request('/imports', 'POST', draft)).status).toBe(201);
    expect((await request('/imports?kind=meal')).status).toBe(200);
    const response = await request('/meals', 'POST', input); expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const saved = await response.json(); expect((await request(`/operations/${saved.data.operationId}`)).status).toBe(200);
    expect((await request(`/meals/${input.id}`, 'PATCH', { title: null }, owner, 1)).status).toBe(200);
    const dayClaim = (await claims.list(db, owner, 'local_date=?', [occurrence.localDate]))[0];
    expect((await request('/days/2026-09-16', 'PATCH', { id: dayClaim.id, entryTimezone: occurrence.entryTimezone, nutritionCompleteness: 'complete', expectedNutritionContentRevision: dayClaim.nutritionContentRevision }, owner, dayClaim.revision)).status).toBe(200);
    const summary = await (await request('/nutrition/summary')).json(); expect(summary.data.days[0]).toMatchObject({ completeness: 'complete', knownSum: { energyMkcal: 200000 } });
    const favoriteId = op(); expect((await request('/favorites', 'POST', { id: favoriteId, title: 'Favorite', mealRef: { id: input.id, revision: 2 } })).status).toBe(201);
    const copied = await request(`/favorites/${favoriteId}/copy`, 'POST', { id: op(), ...occurrence, expectedRevision: 1 }); expect(copied.status).toBe(201);
    expect((await request(`/operations/${(await copied.json()).data.operationId}/undo`, 'POST', {})).status).toBe(200);
    expect((await request('/meals?limit=1')).status).toBe(200);
  });
  it('rejects foreign IDs, unknown fields, excessive ranges and missing versions', async () => {
    const input = await recorded(), request = await client();
    expect((await request(`/meals/${input.id}`, 'GET', undefined, other)).status).toBe(404);
    expect((await request(`/meals/${input.id}`, 'PATCH', { title: 'X' })).status).toBe(400);
    expect((await request('/meals', 'POST', { ...mealInput(), ownerId: owner })).status).toBe(400);
    expect((await request('/nutrition/summary?from=2026-01-01&to=2026-09-16')).status).toBe(400);
    expect((await request('/catalog/foods?limit=101')).status).toBe(400);
    expect((await request('/imports', 'POST', { ...draftInput(), model: 'invented' })).status).toBe(400);
  });
  it('routes food and exercise aliases explicitly without publishing personal names globally', async () => {
    const food = await reference(), request = await client(), aliasId = op();
    expect((await request('/aliases', 'POST', { id: aliasId, type: 'food', text: 'Lunch', target: { type: 'food', id: food.id } })).status).toBe(201);
    expect((await (await request('/aliases?type=food')).json()).data.items).toHaveLength(1);
    expect((await (await request('/aliases?type=exercise')).json()).data.items).toHaveLength(0);
    expect((await request(`/aliases/${aliasId}?type=food`, 'PATCH', { text: 'Dinner' }, owner, 1)).status).toBe(200);
    expect((await request(`/aliases/${aliasId}?type=food`, 'DELETE', {}, owner, 2)).status).toBe(200);
  });
});
