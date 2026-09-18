import { dailySetRequestSchema } from '../domain/daily-records.ts';
import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { localDateAt, validateActualDate } from '../domain/primitives.ts';
import { normalizeMass } from '../domain/numbers.ts';
import { sessionExerciseInputSchema, sessionExercisePatchSchema, sessionInputSchema, sessionPatchSchema, trainingSetInputSchema, trainingSetPatchSchema, workoutSetSchema } from '../domain/training.ts';
import type { SessionExercise, WorkoutSession, WorkoutSet } from '../domain/training.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { displaySnapshot } from './exercises.ts';
import { expectRevision, mergePlans, newMetadata, reviseRecord } from './record-store.ts';
import { plans, schedules, sessionExercises, sessions, sets, setups } from './training-store.ts';
import { pageAfter, pageResult } from './pagination.ts';

const editable = new Set(['in_progress', 'paused', 'completed', 'recorded']);
function validActualDate(localDate: string, occurredAt: string | null, context: CommandContext, entryTimezone: string) {
  try {
    validateActualDate({ localDate, occurredAt }, context.auth.timezone, new Date(context.now));
    if (occurredAt && localDateAt(new Date(occurredAt), entryTimezone) !== localDate) throw new Error();
  } catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'actualDate' }); }
}
export function versionGuard(table: 'exercise_setups' | 'plan_versions' | 'scheduled_sessions' | 'workout_sessions', owner: string, record: { id: string; revision: number }): Guard {
  return { predicate: `EXISTS(SELECT 1 FROM ${table} WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`, values: [owner, record.id, record.revision], error: new DomainError('REVISION_CONFLICT', 409) };
}
function runningGuard(owner: string, id: string): Guard {
  return { predicate: "NOT EXISTS(SELECT 1 FROM workout_sessions WHERE owner_id=? AND status='in_progress' AND deleted_at IS NULL AND id<>?)", values: [owner, id], error: new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'sessionInProgress' }) };
}
async function root(context: CommandContext, id: string, revision: number, requireEditable = true, allowLegacyDraft = false) {
  const value = await sessions.read(context.db, context.auth.id, id); expectRevision(value, revision);
  if (requireEditable && !editable.has(value.status) && !(allowLegacyDraft && value.status === 'draft')) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'sessionNotEditable' });
  return value;
}
async function child(context: CommandContext, session: WorkoutSession, id: string) {
  const value = await sessionExercises.read(context.db, context.auth.id, id);
  if (value.sessionId !== session.id) throw new DomainError('RECORD_NOT_FOUND', 404);
  return value;
}
async function setCount(db: D1Database, owner: string, sessionId: string, omitExercise?: string, omitSet?: string) {
  return (await db.prepare('SELECT COUNT(*) AS n FROM workout_sets s JOIN session_exercises e ON e.owner_id=s.owner_id AND e.id=s.session_exercise_id WHERE e.owner_id=? AND e.session_id=? AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND (? IS NULL OR e.id<>?) AND (? IS NULL OR s.id<>?)').bind(owner, sessionId, omitExercise ?? null, omitExercise ?? null, omitSet ?? null, omitSet ?? null).first<number>('n'))!;
}
async function noRest(context: CommandContext, localDate: string) {
  const rest = await context.db.prepare("SELECT id FROM day_claims WHERE owner_id=? AND local_date=? AND training_claim='rest_confirmed' AND deleted_at IS NULL").bind(context.auth.id, localDate).first();
  if (rest) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'restConfirmed' });
}
function ordinalGuard(table: 'session_exercises' | 'workout_sets', parentColumn: 'session_id' | 'session_exercise_id', owner: string, parent: string, ordinal: number, id: string): Guard {
  return { predicate: `NOT EXISTS(SELECT 1 FROM ${table} WHERE owner_id=? AND ${parentColumn}=? AND ordinal=? AND id<>? AND deleted_at IS NULL)`, values: [owner, parent, ordinal, id], error: new DomainError('REVISION_CONFLICT', 409, { reason: 'ordinalOccupied', ordinal }) };
}
async function newExercise(context: CommandContext, sessionId: string, input: z.infer<typeof sessionExerciseInputSchema>) {
  const setup = await setups.read(context.db, context.auth.id, input.setupId), display = await displaySnapshot(context, setup);
  const record: SessionExercise = { ...newMetadata(context, input.id), sessionId, setupId: setup.id, ordinal: input.ordinal, displaySnapshot: display.snapshot, targetSnapshot: input.target };
  const plan = sessionExercises.plan(context, null, record);
  plan.guards.push(versionGuard('exercise_setups', context.auth.id, setup), display.guard, ordinalGuard('session_exercises', 'session_id', context.auth.id, sessionId, input.ordinal, input.id));
  return plan;
}

export function createSession(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = sessionInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'training.create', payload: input, entryPoint: 'manual', plan: async context => {
    const startedAt = input.timePrecision === 'instant' && input.status === 'in_progress' ? context.now : null;
    validActualDate(input.localDate, startedAt, context, input.entryTimezone);
    let planVersionId = input.planVersionId, snapshot: WorkoutSession['planSnapshot'] = null, templateId = input.templateId, title = input.title;
    const guards: Guard[] = [], children: Array<z.infer<typeof sessionExerciseInputSchema>> = [];
    if (input.scheduledSessionId) {
      const schedule = await schedules.read(db, auth.id, input.scheduledSessionId); expectRevision(schedule, input.expectedScheduleRevision!);
      if (schedule.status !== 'planned' || schedule.localDate !== input.localDate) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'scheduleUnavailable' });
      if (input.planVersionId && (schedule.planVersionId !== input.planVersionId || schedule.templateId !== input.templateId)) throw new DomainError('INVALID_INPUT', 400, { reason: 'scheduleSourceMismatch' });
      planVersionId = schedule.planVersionId; templateId = schedule.templateId; snapshot = schedule.overrideSnapshot;
      guards.push(versionGuard('scheduled_sessions', auth.id, schedule), { predicate: "NOT EXISTS(SELECT 1 FROM workout_sessions WHERE owner_id=? AND scheduled_session_id=? AND deleted_at IS NULL AND status<>'cancelled')", values: [auth.id, schedule.id], error: new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'scheduleAlreadyStarted' }) });
    }
    if (planVersionId) {
      const plan = await plans.read(db, auth.id, planVersionId);
      if (input.expectedPlanRevision !== undefined) expectRevision(plan, input.expectedPlanRevision);
      // The scheduled override freezes an explicitly arranged template. Direct selection uses the named immutable version.
      snapshot ??= plan.snapshot;
      const template = snapshot.templates.find(value => value.templateId === templateId);
      if (!template) throw new DomainError('INVALID_INPUT', 400, { reason: 'templateMissing' });
      title ??= template.title;
      for (const item of template.exercises) children.push({ id: crypto.randomUUID(), setupId: item.setupId, ordinal: item.ordinal, target: { schemaVersion: 1, plannedSets: item.plannedSets, repMin: item.repMin, repMax: item.repMax, targetRpe: item.targetRpe, note: item.note } });
      guards.push(versionGuard('plan_versions', auth.id, plan));
    }
    if (input.copySessionId) {
      const source = await sessions.read(db, auth.id, input.copySessionId); expectRevision(source, input.expectedCopyRevision!);
      if (!editable.has(source.status)) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'copySourceUnavailable' });
      const previous = await sessionExercises.list(db, auth.id, 'session_id=?', [source.id], 'ordinal,id');
      for (const item of previous) children.push({ id: crypto.randomUUID(), setupId: item.setupId, ordinal: item.ordinal, target: item.targetSnapshot });
      title ??= source.title; snapshot = source.planSnapshot; planVersionId = source.planVersionId;
      guards.push(versionGuard('workout_sessions', auth.id, source));
    }
    if (children.length > 100) throw new DomainError('INVALID_INPUT', 400, { reason: 'tooManyExercises' });
    const record: WorkoutSession = { ...newMetadata(context, input.id), localDate: input.localDate, entryTimezone: input.entryTimezone, startedAt, endedAt: null, timePrecision: input.timePrecision, status: input.status, planVersionId, scheduledSessionId: input.scheduledSessionId, planSnapshot: snapshot, title, note: null, recovery: null, sourceRef: input.copySessionId, sourceKind: input.copySessionId ? 'copied' : 'manual' };
    const plan = mergePlans([sessions.plan(context, null, record), ...await Promise.all(children.map(item => newExercise(context, input.id, item)))], { sessionId: input.id });
    plan.guards.push(...guards);
    if (record.status === 'in_progress') plan.guards.push(runningGuard(auth.id, input.id));
    return plan;
  } }, clock);
}
export function patchSession(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, clock?: () => Date) {
  const input = sessionPatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'training.patch', payload: { id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await root(context, id, revision, false);
    if (before.status === 'cancelled') throw new DomainError('DAY_STATE_CONFLICT', 409);
    const after = reviseRecord(before, context, input); validActualDate(after.localDate, after.startedAt, context, after.entryTimezone);
    if (after.localDate !== before.localDate && await setCount(db, auth.id, id)) await noRest(context, after.localDate);
    return sessions.plan(context, before, after);
  } }, clock);
}
export function addExercise(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, clock?: () => Date) {
  const input = sessionExerciseInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'training.exercise.create', payload: { sessionId: id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await root(context, id, revision, false);
    if (before.status === 'cancelled') throw new DomainError('DAY_STATE_CONFLICT', 409);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM session_exercises WHERE owner_id=? AND session_id=? AND deleted_at IS NULL').bind(auth.id, id).first<number>('n');
    if (count! >= 100) throw new DomainError('INVALID_INPUT', 400, { reason: 'tooManyExercises' });
    return mergePlans([sessions.plan(context, before, reviseRecord(before, context, {})), await newExercise(context, id, input)], { sessionId: id, exerciseId: input.id });
  } }, clock);
}
export function editExercise(db: D1Database, auth: AuthContext, operationId: string, sessionId: string, revision: number, id: string, payload: unknown, deleting = false, clock?: () => Date, dailyDate?: string) {
  const input: z.infer<typeof sessionExercisePatchSchema> = deleting ? z.strictObject({ expectedRevision: z.number().int().positive() }).parse(payload) : sessionExercisePatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: deleting ? 'training.exercise.delete' : 'training.exercise.patch', payload: { sessionId, id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const session = await root(context, sessionId, revision, false), before = await child(context, session, id); expectRevision(before, input.expectedRevision);
    if (session.status === 'cancelled') throw new DomainError('DAY_STATE_CONFLICT', 409);
    if (dailyDate && session.localDate !== dailyDate) throw new DomainError('RECORD_NOT_FOUND', 404);
    if (!dailyDate && deleting && session.status === 'completed' && !(await setCount(db, auth.id, sessionId, id))) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'deleteCompletedSessionInstead' });
    const after = reviseRecord(before, context, deleting ? { deletedAt: context.now } : { ordinal: input.ordinal ?? before.ordinal, targetSnapshot: input.target === undefined ? before.targetSnapshot : input.target });
    const plan = mergePlans([sessions.plan(context, session, reviseRecord(session, context, {})), sessionExercises.plan(context, before, after)], { sessionId, exerciseId: id });
    if (!deleting) plan.guards.push(ordinalGuard('session_exercises', 'session_id', auth.id, sessionId, after.ordinal, id));
    return plan;
  } }, clock);
}
function loadFields(load: z.infer<typeof trainingSetInputSchema>['load'], semantics: WorkoutSet['loadSemantics']) {
  if ((load === null ? 'bodyweight_only' : load.semantics) !== semantics) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'loadSemantics' });
  if (load === null) return { loadDecimal: null, unit: null, kgMicros: null, loadSemantics: semantics };
  try { return { loadDecimal: load.value, unit: load.unit, kgMicros: normalizeMass(load.value, load.unit).kgMicros, loadSemantics: semantics }; }
  catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'loadRange' }); }
}
function completedTime(value: string | null | undefined, session: WorkoutSession, context: CommandContext) {
  const time = value === undefined ? session.timePrecision === 'date' ? null : context.now : value;
  if (session.timePrecision === 'date' && time !== null) throw new DomainError('INVALID_INPUT', 400, { reason: 'dateOnlyTimestamp' });
  validActualDate(session.localDate, time, context, session.entryTimezone); return time;
}
export function addSet(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, clock?: () => Date) {
  const input = trainingSetInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'training.set.create', payload: { sessionId: id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const session = await root(context, id, revision), exercise = await child(context, session, input.sessionExerciseId);
    await noRest(context, session.localDate);
    const record = workoutSetSchema.parse({ ...newMetadata(context, input.id), sessionExerciseId: exercise.id, ordinal: input.ordinal, reps: input.reps, ...loadFields(input.load, exercise.displaySnapshot.loadSemantics), setType: input.setType, rpeHalfUnits: input.rpe === null ? null : input.rpe * 2, completedAt: completedTime(input.completedAt, session, context), note: input.note, sourceRowId: null });
    const plan = mergePlans([sessions.plan(context, session, reviseRecord(session, context, {})), sets.plan(context, null, record)], { sessionId: id, setId: input.id });
    plan.guards.push(ordinalGuard('workout_sets', 'session_exercise_id', auth.id, exercise.id, input.ordinal, input.id));
    return plan;
  } }, clock);
}
export function editSet(db: D1Database, auth: AuthContext, operationId: string, sessionId: string, revision: number, id: string, payload: unknown, deleting = false, clock?: () => Date, dailyDate?: string) {
  const input: z.infer<typeof trainingSetPatchSchema> = deleting ? z.strictObject({ expectedRevision: z.number().int().positive() }).parse(payload) : trainingSetPatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: deleting ? 'training.set.delete' : 'training.set.patch', payload: { sessionId, id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const session = await root(context, sessionId, revision, true, !!dailyDate), before = await sets.read(db, auth.id, id); expectRevision(before, input.expectedRevision);
    if (dailyDate && session.localDate !== dailyDate) throw new DomainError('RECORD_NOT_FOUND', 404);
    const exercise = await child(context, session, before.sessionExerciseId);
    if (!dailyDate && deleting && session.status === 'completed' && !(await setCount(db, auth.id, sessionId, undefined, id))) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'deleteCompletedSessionInstead' });
    const patch = input;
    const after = reviseRecord(before, context, deleting ? { deletedAt: context.now } : {
      ordinal: patch.ordinal ?? before.ordinal, reps: patch.reps ?? before.reps, ...(patch.load === undefined ? {} : loadFields(patch.load, exercise.displaySnapshot.loadSemantics)), setType: patch.setType ?? before.setType,
      rpeHalfUnits: patch.rpe === undefined ? before.rpeHalfUnits : patch.rpe === null ? null : patch.rpe * 2,
      completedAt: patch.completedAt === undefined ? before.completedAt : completedTime(patch.completedAt, session, context), note: patch.note === undefined ? before.note : patch.note,
    });
    const plan = mergePlans([sessions.plan(context, session, reviseRecord(session, context, {})), sets.plan(context, before, after)], { sessionId, setId: id });
    if (!deleting) plan.guards.push(ordinalGuard('workout_sets', 'session_exercise_id', auth.id, exercise.id, after.ordinal, id));
    return plan;
  } }, clock);
}
export function transitionSession(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, action: 'pause' | 'resume' | 'finish' | 'cancel' | 'delete', clock?: () => Date) {
  return executeCommand(db, auth, { operationId, kind: `training.${action}`, payload: { id }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await root(context, id, revision, false), actualSets = await setCount(db, auth.id, id);
    const allowed = action === 'delete' || (action === 'pause' && before.status === 'in_progress') || (action === 'resume' && ['draft', 'paused'].includes(before.status)) || (action === 'finish' && ['in_progress', 'paused'].includes(before.status)) || (action === 'cancel' && ['draft', 'in_progress', 'paused'].includes(before.status));
    if (!allowed) throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'sessionTransition' });
    if (action === 'finish' && !actualSets) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'noActualSets' });
    if (action === 'cancel' && actualSets) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'keepOrDeleteActualTraining', actualSets });
    const status = action === 'delete' ? 'deleted' : action === 'pause' ? 'paused' : action === 'resume' ? 'in_progress' : action === 'finish' ? 'completed' : 'cancelled';
    const startedAt = action === 'resume' && before.startedAt === null && before.timePrecision === 'instant' ? context.now : before.startedAt;
    validActualDate(before.localDate, startedAt, context, before.entryTimezone);
    const endedAt = ['finish', 'cancel'].includes(action) && before.timePrecision === 'instant' ? context.now : before.endedAt;
    const after = reviseRecord(before, context, { status, startedAt, endedAt, deletedAt: action === 'delete' ? context.now : null });
    const plan = sessions.plan(context, before, after);
    plan.result = { sessionId: id, status, actualSets };
    if (action === 'resume') plan.guards.push(runningGuard(auth.id, id));
    return plan;
  } }, clock);
}

export async function readSessionTree(db: D1Database, owner: string, id: string) {
  const session = await sessions.read(db, owner, id);
  const exercises = await sessionExercises.list(db, owner, 'session_id=?', [id], 'ordinal,id');
  const actualSets = await sets.list(db, owner, 'session_exercise_id IN (SELECT id FROM session_exercises WHERE owner_id=? AND session_id=? AND deleted_at IS NULL)', [owner, id], 'ordinal,id');
  return { session, exercises, sets: actualSets };
}
export async function trainingHistory(db: D1Database, owner: string, setupId: string, from: string, to: string, limit = 5, cursor?: string) {
  const setup = await setups.read(db, owner, setupId);
  const binding = { setupId, from, to }, after = pageAfter(owner, 'training-history', binding, cursor);
  const previous = after ? await sessions.read(db, owner, after, true) : null;
  const roots = await db.prepare("SELECT DISTINCT w.id,w.local_date FROM workout_sessions w JOIN session_exercises e ON e.owner_id=w.owner_id AND e.session_id=w.id JOIN workout_sets s ON s.owner_id=e.owner_id AND s.session_exercise_id=e.id WHERE w.owner_id=? AND e.setup_id=? AND w.local_date BETWEEN ? AND ? AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND w.status IN ('draft','in_progress','paused','completed','recorded') AND (? IS NULL OR w.local_date<? OR (w.local_date=? AND w.id<?)) ORDER BY w.local_date DESC,w.id DESC LIMIT ?").bind(owner, setupId, from, to, after, previous?.localDate ?? null, previous?.localDate ?? null, after, limit + 1).all<{ id: string; local_date: string }>();
  const reason = setup.loadSemantics === 'unspecified' ? 'loadSemanticsUnspecified' : setup.equipmentInstance === null && setup.loadSemantics !== 'bodyweight_only' ? 'equipmentUnspecified' : null;
  const items = await Promise.all(roots.results.map(async row => {
    const tree = await readSessionTree(db, owner, row.id), exercises = tree.exercises.filter(item => item.setupId === setupId), ids = new Set(exercises.map(item => item.id));
    return { id: row.id, session: tree.session, exercises, sets: tree.sets.filter(item => ids.has(item.sessionExerciseId)) };
  }));
  return { ...pageResult(items, limit, owner, 'training-history', binding), comparable: reason === null, comparisonUnavailableReason: reason };
}

/** First fact, frozen exercise and day container share one ledger transaction. */
export function addDailySet(db: D1Database, auth: AuthContext, operationId: string, date: string, payload: unknown, clock?: () => Date) {
  const input = dailySetRequestSchema.parse(payload);
  if (date !== input.localDate) throw new DomainError('INVALID_INPUT', 400);
  return executeCommand(db, auth, { operationId, kind: 'training.day.set.create', payload: input, expectedRevision: input.expectedSessionRevision ?? undefined, entryPoint: 'manual', plan: async context => {
    validActualDate(date, null, context, input.entryTimezone); await noRest(context, date);
    const session: WorkoutSession = input.createSession
      ? { ...newMetadata(context, input.sessionId), localDate: date, entryTimezone: input.entryTimezone, timePrecision: 'date', status: 'recorded', startedAt: null, endedAt: null, planVersionId: null, scheduledSessionId: null, planSnapshot: null, title: null, note: null, recovery: null, sourceRef: null, sourceKind: 'manual' }
      : await root(context, input.sessionId, input.expectedSessionRevision!, true, true);
    if (session.localDate !== date) throw new DomainError('RECORD_NOT_FOUND', 404);
    const parentPlan = sessions.plan(context, input.createSession ? null : session, input.createSession ? session : reviseRecord(session, context, {}));
    parentPlan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM day_claims WHERE owner_id=? AND local_date=? AND training_claim='rest_confirmed' AND deleted_at IS NULL)", values: [auth.id, date], error: new DomainError('DAY_STATE_CONFLICT', 409) });
    if (input.createSession) parentPlan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM workout_sessions WHERE owner_id=? AND local_date=? AND status='recorded' AND deleted_at IS NULL)", values: [auth.id, date], error: new DomainError('REVISION_CONFLICT', 409, { reason: 'dayAlreadyExists' }) });
    const existing = await sessionExercises.list(db, auth.id, 'id=?', [input.exercise.id]);
    const exercisePlan = existing.length ? null : await newExercise(context, session.id, input.exercise);
    const exercise = existing[0] ?? exercisePlan!.entities[0].after as SessionExercise;
    if (exercise.sessionId !== session.id || exercise.setupId !== input.exercise.setupId) throw new DomainError('RECORD_NOT_FOUND', 404);
    const record = workoutSetSchema.parse({ ...newMetadata(context, input.id), sessionExerciseId: exercise.id, ordinal: input.ordinal, reps: input.reps, ...loadFields(input.load, exercise.displaySnapshot.loadSemantics), setType: input.setType, rpeHalfUnits: input.rpe === null ? null : input.rpe * 2, completedAt: null, note: input.note, sourceRowId: null });
    const plan = mergePlans([parentPlan, ...(exercisePlan ? [exercisePlan] : []), sets.plan(context, null, record)], { sessionId: session.id, setId: input.id });
    plan.guards.push(ordinalGuard('workout_sets', 'session_exercise_id', auth.id, exercise.id, input.ordinal, input.id));
    return plan;
  } }, clock);
}
export async function readTrainingDay(db: D1Database, owner: string, date: string) {
  const roots = await sessions.list(db, owner, "local_date=? AND status NOT IN ('cancelled','deleted')", [date], 'created_at,id');
  const trees = await Promise.all(roots.map(root => readSessionTree(db, owner, root.id)));
  return { localDate: date, sessions: roots, exercises: trees.flatMap(tree => tree.exercises), sets: trees.flatMap(tree => tree.sets) };
}
