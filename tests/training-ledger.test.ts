import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { AuthContext } from '../src/server/auth.ts';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { createCustomExercise, createExerciseAlias, createSetup, patchSetup, readExercise, searchExercises } from '../src/server/exercises.ts';
import { addExercise, addSet, createSession, editExercise, editSet, readSessionTree, trainingHistory, transitionSession } from '../src/server/training.ts';
import { undoTraining } from '../src/server/training-undo.ts';
import { sessions, sets, setups } from '../src/server/training-store.ts';
import { setupInputSchema } from '../src/domain/training.ts';
import type { ExerciseSetup } from '../src/domain/training.ts';
import { createPlan, changePlanSelection, createSchedule, editSchedule, readActivePlan, readScheduleDay } from '../src/server/plans.ts';
import { patchTrainingClaim } from '../src/server/days.ts';
import { createApi } from '../src/server/api.ts';
import { accessVerifier, subjectKey } from '../src/server/auth.ts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87';
const auth: AuthContext = { id: owner, role: 'member', locale: 'en', timezone: 'America/Chicago', status: 'active' };
const clock = () => new Date('2026-09-16T20:00:00.000Z');
const op = () => crypto.randomUUID();
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  const tables = ['change_batches', 'operation_revisions', 'command_operations', 'mutation_guards', 'workout_sets', 'session_exercises', 'workout_sessions', 'scheduled_sessions', 'plan_selections', 'plan_versions', 'exercise_aliases', 'exercise_setups', 'exercise_labels', 'exercise_definitions', 'day_claims', 'users'];
  await db.batch(['DROP TRIGGER IF EXISTS reject_training_event', ...tables.map(table => `DELETE FROM ${table}`)].map(sql => db.prepare(sql)));
  for (const id of [owner, other]) await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','America/Chicago',?)").bind(id, `${id}@example.invalid`, clock().toISOString()).run();
});
async function makeSetup(semantics: ExerciseSetup['loadSemantics'] = 'external_total', actor = auth) {
  const exerciseId = op(), setupId = op();
  await createCustomExercise(db, actor, op(), { id: exerciseId, name: '我的槓鈴 Bench', locale: 'zh-Hant', equipmentType: 'barbell', variant: { schemaVersion: 1, angle: 'flat', grip: 'pronated', laterality: 'bilateral', note: null }, muscles: { schemaVersion: 1, primary: ['chest'], secondary: ['triceps'] } }, clock);
  await createSetup(db, actor, op(), { id: setupId, exerciseId, equipmentInstance: 'Home rack', loadSemantics: semantics, loadUnit: 'lb', ...(semantics === 'external_total' ? { includesBar: true, barWeightDecimal: '45', barUnit: 'lb' } : {}) }, clock);
  return { setupId, exerciseId };
}
const sessionInput = () => ({ id: op(), localDate: '2026-09-16', entryTimezone: 'America/Chicago', timePrecision: 'date' });
async function training(semantics: ExerciseSetup['loadSemantics'] = 'external_total') {
  const definition = await makeSetup(semantics), input = sessionInput(), exercise = op();
  await createSession(db, auth, op(), input, clock);
  await addExercise(db, auth, op(), input.id, 1, { id: exercise, setupId: definition.setupId, ordinal: 1 }, clock);
  return { id: input.id, exercise, ...definition };
}
const group = (sessionExerciseId: string, ordinal = 1, semantics: Exclude<ExerciseSetup['loadSemantics'], 'bodyweight_only'> = 'external_total') => ({ id: op(), sessionExerciseId, ordinal, reps: 8, load: { value: '110', unit: 'lb', semantics } });
const revision = async (id: string) => (await sessions.read(db, owner, id)).revision;

describe('training facts and setup semantics on D1', () => {
  it('preserves 110 lb including the bar; changes 8 to 5 in one ordered batch', async () => {
    const t = await training(), input = group(t.exercise); await addSet(db, auth, op(), t.id, 2, input, clock);
    const operationId = op();
    const receipt = await editSet(db, auth, operationId, t.id, 3, input.id, { expectedRevision: 1, reps: 5 }, false, clock);
    expect(await sets.read(db, owner, input.id)).toMatchObject({ reps: 5, loadDecimal: '110', unit: 'lb', kgMicros: 49_895_161, loadSemantics: 'external_total', setType: 'unknown', rpeHalfUnits: null, revision: 2, completedAt: null });
    expect(receipt.recordRefs).toEqual([{ type: 'workout_session', id: t.id, revision: 4 }, { type: 'workout_set', id: input.id, revision: 2 }]);
    const events = await db.prepare('SELECT events_json FROM change_batches WHERE owner_id=? AND operation_id=?').bind(owner, operationId).first<string>('events_json');
    expect(JSON.parse(events!)).toMatchObject([{ eventId: `${operationId}:0` }, { eventId: `${operationId}:1`, changes: [{ field: 'reps', before: 8, after: 5 }] }]);
  });
  it('does not double per-side loads or invent bodyweight loads', async () => {
    const t = await training('per_side'), input = { ...group(t.exercise, 1, 'per_side'), load: { value: '35', unit: 'lb', semantics: 'per_side' } };
    await addSet(db, auth, op(), t.id, 2, input, clock);
    expect(await sets.read(db, owner, input.id)).toMatchObject({ loadDecimal: '35', kgMicros: 15_875_733 });
    await transitionSession(db, auth, op(), t.id, 3, 'pause', clock);
    const bodyweight = await training('bodyweight_only'), set = { ...group(bodyweight.exercise), load: null };
    await addSet(db, auth, op(), bodyweight.id, 2, set, clock);
    expect(await sets.read(db, owner, set.id)).toMatchObject({ loadDecimal: null, unit: null, kgMicros: null });
    await expect(addSet(db, auth, op(), bodyweight.id, 3, group(bodyweight.exercise, 2), clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
  });
  it('retains increment and available-load units when display preference changes', async () => {
    const { setupId } = await makeSetup();
    await patchSetup(db, auth, op(), setupId, 1, { incrementDecimal: '5', incrementUnit: 'lb', availableLoads: { schemaVersion: 1, unit: 'lb', values: ['95', '110'] } }, clock);
    await patchSetup(db, auth, op(), setupId, 2, { loadUnit: 'kg' }, clock);
    expect(await setups.read(db, owner, setupId)).toMatchObject({ loadUnit: 'kg', incrementDecimal: '5', incrementUnit: 'lb', availableLoads: { unit: 'lb', values: ['95', '110'] } });
    expect(() => patchSetup(db, auth, op(), setupId, 3, { loadSemantics: 'per_side' }, clock)).toThrow();
    expect(setupInputSchema.safeParse({ id: op(), exerciseId: op(), loadSemantics: 'external_total', loadUnit: 'kg', incrementDecimal: '5' }).success).toBe(false);
  });
  it('protects child ownership and same-owner parent paths independently', async () => {
    const t = await training(), input = group(t.exercise); await addSet(db, auth, op(), t.id, 2, input, clock);
    await expect(editSet(db, { ...auth, id: other }, op(), t.id, 3, input.id, { expectedRevision: 1, reps: 7 }, false, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await transitionSession(db, auth, op(), t.id, 3, 'pause', clock);
    const second = await training();
    await expect(editSet(db, auth, op(), second.id, 2, input.id, { expectedRevision: 1, reps: 7 }, false, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(addExercise(db, auth, op(), second.id, 2, { id: op(), setupId: (await makeSetup('external_total', { ...auth, id: other })).setupId, ordinal: 2 }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('permits one edit at the expected root version and returns one original receipt on replay', async () => {
    const t = await training(), input = group(t.exercise), operationId = op();
    const created = await Promise.all([addSet(db, auth, operationId, t.id, 2, input, clock), addSet(db, auth, operationId, t.id, 2, input, clock)]);
    expect(created[0]).toEqual(created[1]);
    const results = await Promise.allSettled([editSet(db, auth, op(), t.id, 3, input.id, { expectedRevision: 1, reps: 5 }, false, clock), editSet(db, auth, op(), t.id, 3, input.id, { expectedRevision: 1, reps: 6 }, false, clock)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'REVISION_CONFLICT' } }]);
  });
  it('rolls back facts, root revision, audit and receipt when the event insert fails', async () => {
    const t = await training(), dataRevision = await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision');
    await db.prepare("CREATE TRIGGER reject_training_event BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'injected'); END").run();
    const operationId = op(), input = group(t.exercise);
    await expect(addSet(db, auth, operationId, t.id, 2, input, clock)).rejects.toThrow();
    expect(await revision(t.id)).toBe(2);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(dataRevision);
    for (const table of ['command_operations', 'operation_revisions', 'change_batches']) expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE operation_id=?`).bind(operationId).first('n')).toBe(0);
    await expect(sets.read(db, owner, input.id)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('requires explicit ordering when two valid groups request the same ordinal', async () => {
    const t = await training(); await addSet(db, auth, op(), t.id, 2, group(t.exercise), clock);
    await expect(addSet(db, auth, op(), t.id, 3, group(t.exercise), clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', params: { reason: 'ordinalOccupied' } });
    expect((await readSessionTree(db, owner, t.id)).sets).toHaveLength(1);
  });
  it('enforces owner foreign keys and complete normalized loads at the database boundary', async () => {
    const t = await training(), input = group(t.exercise); await addSet(db, auth, op(), t.id, 2, input, clock);
    for (const sql of ['UPDATE workout_sets SET kg_micros=NULL WHERE id=?', 'UPDATE workout_sets SET unit=NULL WHERE id=?', 'UPDATE workout_sets SET kg_micros=1.5 WHERE id=?']) await expect(db.prepare(sql).bind(input.id).run()).rejects.toThrow();
    await expect(db.prepare('UPDATE workout_sets SET owner_id=? WHERE id=?').bind(other, input.id).run()).rejects.toThrow();
    expect(await sets.read(db, owner, input.id)).toMatchObject({ kgMicros: 49_895_161, unit: 'lb' });
  });
  it('keeps null RPE separate from omitted fields and rejects future facts', async () => {
    const t = await training(), input = { ...group(t.exercise), rpe: 8.5 }; await addSet(db, auth, op(), t.id, 2, input, clock);
    await editSet(db, auth, op(), t.id, 3, input.id, { expectedRevision: 1, reps: 9 }, false, clock);
    expect((await sets.read(db, owner, input.id)).rpeHalfUnits).toBe(17);
    await editSet(db, auth, op(), t.id, 4, input.id, { expectedRevision: 2, rpe: null }, false, clock);
    expect((await sets.read(db, owner, input.id)).rpeHalfUnits).toBeNull();
    await expect(createSession(db, auth, op(), { ...sessionInput(), localDate: '2026-09-17' }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(addSet(db, auth, op(), t.id, 5, { ...group(t.exercise, 2), completedAt: clock().toISOString() }, clock)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('training lifecycle and version-safe undo', () => {
  it('supports pause/resume but never completes an empty session', async () => {
    const t = await training();
    await expect(transitionSession(db, auth, op(), t.id, 2, 'finish', clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'noActualSets' } });
    await transitionSession(db, auth, op(), t.id, 2, 'pause', clock);
    await transitionSession(db, auth, op(), t.id, 3, 'resume', clock);
    await expect(createSession(db, auth, op(), sessionInput(), clock)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT' });
  });
  it('requires keep-and-finish or explicit deletion when cancelling actual work', async () => {
    const t = await training(); await addSet(db, auth, op(), t.id, 2, group(t.exercise), clock);
    await expect(transitionSession(db, auth, op(), t.id, 3, 'cancel', clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { actualSets: 1 } });
    await transitionSession(db, auth, op(), t.id, 3, 'finish', clock);
    expect((await readSessionTree(db, owner, t.id)).sets).toHaveLength(1);
    const removed = await transitionSession(db, auth, op(), t.id, 4, 'delete', clock);
    await expect(readSessionTree(db, owner, t.id)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect((await trainingHistory(db, owner, t.setupId, '2026-09-01', '2026-09-16')).items).toHaveLength(0);
    await undoTraining(db, auth, op(), removed.operationId, clock);
    expect((await readSessionTree(db, owner, t.id)).sets).toHaveLength(1);
  });
  it('copies actions and target references with zero actual groups', async () => {
    const t = await training(); await addSet(db, auth, op(), t.id, 2, group(t.exercise), clock); await transitionSession(db, auth, op(), t.id, 3, 'finish', clock);
    const input = { ...sessionInput(), copySessionId: t.id, expectedCopyRevision: 4 };
    await createSession(db, auth, op(), input, clock);
    const copy = await readSessionTree(db, owner, input.id);
    expect(copy.exercises).toHaveLength(1); expect(copy.sets).toHaveLength(0);
    expect(copy.session).toMatchObject({ sourceKind: 'copied', sourceRef: t.id, status: 'in_progress', endedAt: null, recovery: null });
  });
  it('safely undoes set changes and refuses to overwrite any later root edit', async () => {
    const t = await training(), input = group(t.exercise), created = await addSet(db, auth, op(), t.id, 2, input, clock);
    const changed = await editSet(db, auth, op(), t.id, 3, input.id, { expectedRevision: 1, reps: 5 }, false, clock);
    await undoTraining(db, auth, op(), changed.operationId, clock);
    expect(await sets.read(db, owner, input.id)).toMatchObject({ reps: 8, revision: 3 });
    await expect(undoTraining(db, auth, op(), created.operationId, clock)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('soft-deletes exercises with their visible descendants and restores them together', async () => {
    const t = await training(); await addSet(db, auth, op(), t.id, 2, group(t.exercise), clock);
    const removed = await editExercise(db, auth, op(), t.id, 3, t.exercise, { expectedRevision: 1 }, true, clock);
    expect((await readSessionTree(db, owner, t.id)).sets).toHaveLength(0);
    await undoTraining(db, auth, op(), removed.operationId, clock);
    expect((await readSessionTree(db, owner, t.id)).sets).toHaveLength(1);
  });
  it('does not leave a completed session without actual groups', async () => {
    const t = await training(), input = group(t.exercise); await addSet(db, auth, op(), t.id, 2, input, clock); await transitionSession(db, auth, op(), t.id, 3, 'finish', clock);
    await expect(editSet(db, auth, op(), t.id, 4, input.id, { expectedRevision: 1 }, true, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
    await expect(editExercise(db, auth, op(), t.id, 4, t.exercise, { expectedRevision: 1 }, true, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
  });
});

describe('personal catalog and history', () => {
  it('preserves original custom names and allows conflicting personal aliases as candidates', async () => {
    const a = await makeSetup(), b = await makeSetup();
    for (const exerciseId of [a.exerciseId, b.exerciseId]) await createExerciseAlias(db, auth, op(), { id: op(), type: 'exercise', text: '胸推', targetId: exerciseId }, clock);
    const result = await searchExercises(db, owner, { q: '胸推', locale: 'en', limit: 20 });
    expect(result.items).toHaveLength(2); expect(result.items.every(item => item.name === '我的槓鈴 Bench')).toBe(true);
    expect((await searchExercises(db, other, { q: '胸推', locale: 'en', limit: 20 })).items).toHaveLength(0);
    await expect(readExercise(db, other, a.exerciseId)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
  it('binds cursor to owner, locale and search, including non-ASCII queries', async () => {
    await makeSetup(); await makeSetup();
    const first = await searchExercises(db, owner, { q: '我的', locale: 'zh-Hant', limit: 1 }); expect(first.nextCursor).not.toBeNull();
    const second = await searchExercises(db, owner, { q: '我的', locale: 'zh-Hant', limit: 1, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1); expect(second.items[0].id).not.toBe(first.items[0].id);
    await expect(searchExercises(db, other, { q: '我的', locale: 'zh-Hant', limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('limits history to the same setup and keeps unknown semantics explicit', async () => {
    const t = await training('unspecified'); await addSet(db, auth, op(), t.id, 2, group(t.exercise, 1, 'unspecified'), clock);
    const history = await trainingHistory(db, owner, t.setupId, '2026-09-01', '2026-09-16');
    expect(history).toMatchObject({ comparable: false, comparisonUnavailableReason: 'loadSemanticsUnspecified' }); expect(history.items).toHaveLength(1);
    const second = await makeSetup('unspecified'); expect((await trainingHistory(db, owner, second.setupId, '2026-09-01', '2026-09-16')).items).toHaveLength(0);
  });
});

describe('immutable plans, schedules and actual rest', () => {
  const snapshot = (setupId: string) => { const templateId = op(); return { schemaVersion: 1, templates: [{ templateId, title: 'Upper', exercises: [{ setupId, ordinal: 1, plannedSets: 3, repMin: 8, repMax: 10, targetRpe: null, note: null }] }], weeklySchedule: [{ weekday: 3, templateIds: [templateId], plannedRest: false }] }; };
  it('defaults plans to tomorrow and freezes started-session targets across a new version', async () => {
    const setup = await makeSetup(), firstId = op(), first = snapshot(setup.setupId);
    await createPlan(db, auth, op(), { id: firstId, title: 'First', snapshot: first, basePlan: null, effectiveLocalDate: '2026-09-16', confirmToday: true }, clock);
    const input = { ...sessionInput(), planVersionId: firstId, templateId: first.templates[0].templateId, expectedPlanRevision: 1 };
    await createSession(db, auth, op(), input, clock);
    const second = snapshot(setup.setupId); second.templates[0].exercises[0].plannedSets = 4;
    const secondId = op(); await createPlan(db, auth, op(), { id: secondId, title: 'Second', snapshot: second, basePlan: { id: firstId, revision: 1 } }, clock);
    expect((await readActivePlan(db, owner, '2026-09-16'))?.id).toBe(firstId);
    expect((await readActivePlan(db, owner, '2026-09-17'))?.id).toBe(secondId);
    const tree = await readSessionTree(db, owner, input.id); expect(tree.sets).toHaveLength(0); expect(tree.exercises[0].targetSnapshot?.plannedSets).toBe(3); expect(tree.session.planSnapshot).toEqual(first);
  });
  it('requires independent today/history confirmation and guards JSON setup ownership', async () => {
    const foreign = await makeSetup('external_total', { ...auth, id: other });
    await expect(createPlan(db, auth, op(), { id: op(), title: 'Other', snapshot: snapshot(foreign.setupId), basePlan: null }, clock)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    const own = await makeSetup();
    await expect(createPlan(db, auth, op(), { id: op(), title: 'Today', snapshot: snapshot(own.setupId), basePlan: null, effectiveLocalDate: '2026-09-16' }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'planToday' } });
    await expect(createPlan(db, auth, op(), { id: op(), title: 'Past', snapshot: snapshot(own.setupId), basePlan: null, effectiveLocalDate: '2026-09-15', confirmToday: true }, clock)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', params: { reason: 'planHistorical' } });
  });
  it('allows one concurrent plan replacement and preserves effective dates when archiving', async () => {
    const setup = await makeSetup(), firstId = op(); await createPlan(db, auth, op(), { id: firstId, title: 'One', snapshot: snapshot(setup.setupId), basePlan: null }, clock);
    const replace = () => createPlan(db, auth, op(), { id: op(), title: 'New', snapshot: snapshot(setup.setupId), basePlan: { id: firstId, revision: 1 } }, clock);
    const results = await Promise.allSettled([replace(), replace()]); expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'REVISION_CONFLICT' } }]);
    const selected = (await readActivePlan(db, owner, '2026-09-17'))!;
    await changePlanSelection(db, auth, op(), selected.id, 1, { effectiveLocalDate: '2026-09-18', basePlan: { id: selected.id, revision: 1 } }, 'archive', clock);
    expect((await readActivePlan(db, owner, '2026-09-17'))?.id).toBe(selected.id); expect(await readActivePlan(db, owner, '2026-09-18')).toBeNull();
  });
  it('projects weekly schedules without writes and atomically moves explicit overrides', async () => {
    const setup = await makeSetup(), planId = op(), plan = snapshot(setup.setupId);
    await createPlan(db, auth, op(), { id: planId, title: 'Weekly', snapshot: plan, basePlan: null, effectiveLocalDate: '2026-09-16', confirmToday: true }, clock);
    const dataRevision = await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision');
    expect((await readScheduleDay(db, owner, '2026-09-16')).weeklyTemplates).toHaveLength(1);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(dataRevision);
    const scheduleId = op(), movedId = op(); await createSchedule(db, auth, op(), { id: scheduleId, localDate: '2026-09-16', entryTimezone: 'America/Chicago', planVersionId: planId, templateId: plan.templates[0].templateId, overrideMode: 'template' }, clock);
    await editSchedule(db, auth, op(), scheduleId, 1, { action: 'move', id: movedId, localDate: '2026-09-17', entryTimezone: 'America/Chicago' }, clock);
    const old = await readScheduleDay(db, owner, '2026-09-16'), next = await readScheduleDay(db, owner, '2026-09-17');
    expect(old.weeklyTemplates).toHaveLength(0); expect(old.scheduledSessions[0].status).toBe('moved'); expect(next.scheduledSessions[0]).toMatchObject({ id: movedId, movedFromId: scheduleId, status: 'planned' });
  });
  it('does not move or instantiate the same started schedule again', async () => {
    const scheduleId = op(); await createSchedule(db, auth, op(), { id: scheduleId, localDate: '2026-09-16', entryTimezone: 'America/Chicago', planVersionId: null, templateId: null }, clock);
    const input = { ...sessionInput(), scheduledSessionId: scheduleId, expectedScheduleRevision: 1 }; await createSession(db, auth, op(), input, clock);
    await expect(editSchedule(db, auth, op(), scheduleId, 1, { action: 'skip' }, clock)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT', params: { reason: 'scheduleAlreadyStarted' } });
    await transitionSession(db, auth, op(), input.id, 1, 'pause', clock);
    await expect(createSession(db, auth, op(), { ...input, id: op() }, clock)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT', params: { reason: 'scheduleAlreadyStarted' } });
  });
  it('moves one weekly template without dropping the other or replacing the destination day', async () => {
    const setup = await makeSetup(), planId = op(), plan = snapshot(setup.setupId), second = { ...plan.templates[0], templateId: op(), title: 'Second session' };
    plan.templates.push(second); plan.weeklySchedule[0].templateIds.push(second.templateId);
    await createPlan(db, auth, op(), { id: planId, title: 'Two sessions', snapshot: plan, basePlan: null, effectiveLocalDate: '2026-09-16', confirmToday: true }, clock);
    const scheduled = { id: op(), localDate: '2026-09-16', entryTimezone: 'America/Chicago', planVersionId: planId, templateId: plan.templates[0].templateId, overrideMode: 'template' };
    await createSchedule(db, auth, op(), scheduled, clock);
    await expect(createSchedule(db, auth, op(), { ...scheduled, id: op() }, clock)).rejects.toMatchObject({ code: 'DUPLICATE_CANDIDATE' });
    const movedId = op(); await editSchedule(db, auth, op(), scheduled.id, 1, { action: 'move', id: movedId, localDate: '2026-09-17', entryTimezone: 'America/Chicago' }, clock);
    const old = await readScheduleDay(db, owner, '2026-09-16'), next = await readScheduleDay(db, owner, '2026-09-17');
    expect(old.weeklyTemplates.map(value => value.template.templateId)).toEqual([second.templateId]);
    expect(next.scheduledSessions[0]).toMatchObject({ id: movedId, overrideMode: 'additional' });
  });
  it('keeps rest separate from an empty plan and refuses restoration over a new rest claim', async () => {
    const t = await training(), claim = { id: op(), entryTimezone: 'America/Chicago', trainingClaim: 'rest_confirmed' };
    await patchTrainingClaim(db, auth, op(), '2026-09-16', undefined, claim, clock);
    await expect(addSet(db, auth, op(), t.id, 2, group(t.exercise), clock)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT', params: { reason: 'restConfirmed' } });
    await patchTrainingClaim(db, auth, op(), '2026-09-16', 1, { ...claim, trainingClaim: 'unspecified' }, clock);
    await addSet(db, auth, op(), t.id, 2, group(t.exercise), clock);
    await expect(patchTrainingClaim(db, auth, op(), '2026-09-16', 2, claim, clock)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT' });
    const deleted = await transitionSession(db, auth, op(), t.id, 3, 'delete', clock);
    await patchTrainingClaim(db, auth, op(), '2026-09-16', 2, claim, clock);
    await expect(undoTraining(db, auth, op(), deleted.operationId, clock)).rejects.toMatchObject({ code: 'DAY_STATE_CONFLICT', params: { reason: 'restConfirmed' } });
  });
});

describe('authenticated training API', () => {
  async function client() {
    const issuer = 'https://training-fixture.cloudflareaccess.com', pair = await generateKeyPair('RS256'), origin = 'http://127.0.0.1:5173';
    const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture', alg: 'RS256' }] });
    for (const user of [owner, other]) await db.prepare('UPDATE users SET verified_subject=? WHERE id=?').bind(subjectKey({ issuer, subject: user }), user).run();
    const app = createApi({ clock, verifyIdentity: accessVerifier({ teamDomain: 'training-fixture.cloudflareaccess.com', audience: 'training-test' }, resolver, clock) });
    return async (path: string, method = 'GET', payload?: unknown, user = owner, expectedRevision?: number, operationId = op()) => {
      const jwt = await new SignJWT({ email: `${user}@example.invalid` }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(user).setIssuer(issuer).setAudience('training-test').setIssuedAt(Math.floor(clock().getTime() / 1000)).setExpirationTime(Math.floor(clock().getTime() / 1000) + 60).sign(pair.privateKey);
      return app.request(`/api/v1${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwt, 'Idempotency-Key': operationId, ...(expectedRevision ? { 'If-Match': `"${expectedRevision}"` } : {}) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }, { DB: db, APP_ORIGIN: origin, RESTORE_EPOCH: 'fa682cd1-1d70-4f27-87f0-4b143f53b624' });
    };
  }
  it('exposes the real create/edit/finish/undo path and a bounded version-bound tree', async () => {
    const setup = await makeSetup(), request = await client(), input = sessionInput(), exerciseId = op();
    expect((await request('/training/sessions', 'POST', input)).status).toBe(201);
    expect((await request(`/training/sessions/${input.id}/exercises`, 'POST', { id: exerciseId, setupId: setup.setupId, ordinal: 1 }, owner, 1)).status).toBe(201);
    const set = group(exerciseId), added = await request(`/training/sessions/${input.id}/sets`, 'POST', set, owner, 2);
    expect(added.status).toBe(201); expect(added.headers.get('Cache-Control')).toBe('no-store');
    const page = await (await request(`/training/sessions/${input.id}?limit=1`)).json(); expect(page.data.items).toHaveLength(1); expect(page.data.nextCursor).not.toBeNull();
    const next = await (await request(`/training/sessions/${input.id}?limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`)).json(); expect(next.data.items).toHaveLength(1); expect(next.data.items[0].id).not.toBe(page.data.items[0].id);
    const changed = await request(`/training/sessions/${input.id}/sets/${set.id}`, 'PATCH', { expectedRevision: 1, reps: 5 }, owner, 3); expect(changed.status).toBe(200);
    expect((await request(`/training/sessions/${input.id}?limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`)).status).toBe(400);
    const changedBody = await changed.json(); expect((await request(`/operations/${changedBody.data.operationId}/undo`, 'POST', {})).status).toBe(200);
    expect((await sets.read(db, owner, set.id)).reps).toBe(8);
    expect((await request(`/training/sessions/${input.id}/finish`, 'POST', {}, owner, 5)).status).toBe(200);
    const history = await (await request(`/training/history?setupId=${setup.setupId}`)).json(); expect(history.data.items).toHaveLength(1);
  });
  it('rejects missing root versions, invented fields and cross-owner paths with no writes', async () => {
    const t = await training(), request = await client(), input = group(t.exercise);
    expect((await request(`/training/sessions/${t.id}/sets`, 'POST', input)).status).toBe(400);
    expect((await request(`/training/sessions/${t.id}/sets`, 'POST', { ...input, ownerId: owner }, owner, 2)).status).toBe(400);
    expect((await request(`/training/sessions/${t.id}`, 'GET', undefined, other)).status).toBe(404);
    expect((await request(`/training/sessions/${t.id}/sets`, 'POST', input, other, 2)).status).toBe(404);
    expect((await request('/catalog/exercises?limit=101')).status).toBe(400);
    expect((await request(`/training/history?setupId=${t.setupId}`, 'GET', undefined, other)).status).toBe(404);
    expect((await request('/days/2026-09-16', 'PATCH', { id: op(), entryTimezone: 'America/Chicago', trainingClaim: 'rest_confirmed' })).status).toBe(200);
    expect((await readSessionTree(db, owner, t.id)).sets).toHaveLength(0);
  });
});
