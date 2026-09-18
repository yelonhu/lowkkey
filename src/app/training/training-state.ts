import type { z } from 'zod';
import type { EntityRef } from '../../domain/artifacts.ts';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import { visibleLedgerEntities } from '../../domain/local-ledger.ts';
import { observed } from '../../domain/manual-commands.ts';
import type { ManualMutation, QueuedCommand } from '../../domain/manual-commands.ts';
import { versionBindingSchema } from '../../domain/manual-commands.ts';
import { normalizeMass } from '../../domain/numbers.ts';
import type { ExerciseDefinition, ExerciseSetup, SessionExercise, WorkoutSession, WorkoutSet } from '../../domain/training.ts';

export type Binding = z.infer<typeof versionBindingSchema>;
export type TrainingProjection = {
  sessions: WorkoutSession[]; exercises: SessionExercise[]; sets: WorkoutSet[];
  setups: ExerciseSetup[]; definitions: ExerciseDefinition[];
  pending: Map<string, QueuedCommand>; labels: Map<string, Record<string, string>>;
};
export const trainingKinds = new Set(['day-exercise.delete', 'day-set.create', 'day-set.update', 'day-set.delete', 'exercise.create', 'setup.create', 'setup.update', 'session.create', 'session.update', 'session.transition', 'session-exercise.create', 'session-exercise.update', 'session-exercise.delete', 'set.create', 'set.update', 'set.delete']);
export function sessionIdFor(mutation: ManualMutation): string | null {
  if (mutation.kind === 'session.create') return mutation.input.id;
  if ('session' in mutation) return mutation.session.id;
  if ('target' in mutation && mutation.target.type === 'workout_session') return mutation.target.id;
  return null;
}
export function effects(mutation: ManualMutation): Array<Pick<EntityRef, 'id' | 'type'>> {
  const result: Array<Pick<EntityRef, 'id' | 'type'>> = [];
  if ('session' in mutation) result.push({ type: 'workout_session', id: mutation.session.id });
  if ('target' in mutation) result.push({ type: mutation.target.type, id: mutation.target.id });
  if (mutation.kind === 'day-set.create') result.push({ type: 'session_exercise', id: mutation.input.exercise.id });
  const createTypes = { 'meal.create': 'meal', 'meal-draft.create': 'import_draft', 'day-claim.create': 'day_claim', 'day-set.create': 'workout_set', 'day-weight.create': 'weight_entry', 'weight.create': 'weight_entry', 'session.create': 'workout_session', 'session-exercise.create': 'session_exercise', 'set.create': 'workout_set', 'setup.create': 'exercise_setup', 'exercise.create': 'exercise_definition' } as const;
  if (mutation.kind in createTypes && 'input' in mutation && 'id' in mutation.input)
    result.push({ type: createTypes[mutation.kind as keyof typeof createTypes], id: mutation.input.id });
  return result;
}
export function orderedCommands(commands: QueuedCommand[]): QueuedCommand[] {
  const byId = new Map(commands.map(command => [command.operationId, command])), visited = new Set<string>(), result: QueuedCommand[] = [];
  const visit = (command: QueuedCommand) => {
    if (visited.has(command.operationId)) return;
    visited.add(command.operationId);
    for (const id of command.dependencies) { const dependency = byId.get(id); if (dependency) visit(dependency); }
    result.push(command);
  };
  for (const command of commands) visit(command);
  return result;
}
/** A local successor must bind to a receipt, never guess the next revision. */
export function versionFor(ref: EntityRef, commands: QueuedCommand[]): Binding {
  const previous = orderedCommands(commands).findLast(command => {
    if (!effects(command.mutation).some(effect => effect.type === ref.type && effect.id === ref.id)) return false;
    if (['queued', 'sending', 'uncertain', 'conflict', 'needs_review', 'rejected'].includes(command.state)) return true;
    return command.state === 'committed' && command.receipt?.recordRefs.some(effect => effect.type === ref.type && effect.id === ref.id && effect.revision > ref.revision);
  });
  return previous ? { type: ref.type, id: ref.id, source: { kind: 'receipt', operationId: previous.operationId } } : observed(ref);
}
export function observedDraftRefs(fields: Record<string, string>): EntityRef[] {
  return ['rootBinding', 'targetBinding'].flatMap(key => {
    try {
      const binding = versionBindingSchema.parse(JSON.parse(fields[key] || 'null'));
      return binding.source.kind === 'observed' ? [{ type: binding.type, id: binding.id, revision: binding.source.revision }] : [];
    } catch { return []; }
  });
}
export function nextOrdinal(records: Array<{ ordinal: number }>) { return Math.max(0, ...records.map(record => record.ordinal)) + 1; }

/** Pending intent is a display layer only. It is never persisted as a ledger fact. */
export function trainingProjection(ledger: LocalLedger, commands: QueuedCommand[]): TrainingProjection {
  const entities = visibleLedgerEntities(ledger);
  const sessions = new Map(entities.flatMap(item => item.kind === 'workout_session' ? [[item.value.id, { ...item.value }] as const] : []));
  const exercises = new Map(entities.flatMap(item => item.kind === 'session_exercise' ? [[item.value.id, { ...item.value }] as const] : []));
  const sets = new Map(entities.flatMap(item => item.kind === 'workout_set' ? [[item.value.id, { ...item.value }] as const] : []));
  const setups = new Map(entities.flatMap(item => item.kind === 'exercise_setup' ? [[item.value.id, { ...item.value }] as const] : []));
  const definitions = new Map<string, ExerciseDefinition>(entities.flatMap(item => item.kind === 'exercise_definition' ? [[item.value.id, item.value] as const] : []));
  const labels = new Map<string, Record<string, string>>();
  for (const item of ledger.items.values()) if (item.kind === 'catalog_exercise') {
    definitions.set(item.value.definition.id, item.value.definition);
    labels.set(item.value.definition.id, Object.fromEntries(item.value.labels.map(label => [label.locale, label.displayName])));
  }
  const pending = new Map<string, QueuedCommand>();
  for (const command of orderedCommands(commands)) {
    if (!trainingKinds.has(command.mutation.kind) || !(['queued', 'sending', 'uncertain'].includes(command.state) || (command.state === 'committed' && command.receipt?.dataRevision != null && command.receipt.dataRevision > ledger.dataRevision))) continue;
    const mutation = command.mutation;
    for (const effect of effects(mutation)) pending.set(effect.id, command);
    const metadata = { id: command.clientEntityId, ownerId: ledger.ownerId, revision: 1, createdAt: command.createdAt, updatedAt: command.createdAt, deletedAt: null, operationId: command.operationId, createdOperationId: command.operationId };
    switch (mutation.kind) {
      case 'exercise.create': definitions.set(mutation.input.id, { ...metadata, ...mutation.input, scope: 'personal', catalogVersion: 'personal-v1', familyId: mutation.input.id, parentExerciseId: mutation.input.parentExerciseId, personalName: mutation.input.name, personalLocale: mutation.input.locale, status: 'active', movementPattern: mutation.input.movementPattern ?? 'unspecified', catalogReview: null }); break;
      case 'setup.create': setups.set(mutation.input.id, { ...metadata, ...mutation.input }); break;
      case 'setup.update': { const before = setups.get(mutation.target.id); if (before) setups.set(before.id, { ...before, ...mutation.input }); break; }
      case 'session.create': sessions.set(mutation.input.id, { ...metadata, ...mutation.input, startedAt: mutation.input.timePrecision === 'instant' ? command.createdAt : null, endedAt: null, planVersionId: null, scheduledSessionId: null, planSnapshot: null, title: mutation.input.title, note: null, recovery: null, sourceRef: null, sourceKind: 'manual' }); break;
      case 'session.update': { const before = sessions.get(mutation.target.id); if (before) sessions.set(before.id, { ...before, ...mutation.input }); break; }
      case 'session.transition': {
        const before = sessions.get(mutation.target.id);
        if (before) {
          const status = ({ pause: 'paused', resume: 'in_progress', finish: 'completed', cancel: 'cancelled', delete: 'deleted' } as const)[mutation.action];
          sessions.set(before.id, { ...before, status, endedAt: ['finish', 'cancel'].includes(mutation.action) && before.timePrecision === 'instant' ? command.createdAt : before.endedAt, deletedAt: mutation.action === 'delete' ? command.createdAt : null });
        }
        break;
      }
      case 'session-exercise.create': {
        const setup = setups.get(mutation.input.setupId), exercise = setup && definitions.get(setup.exerciseId);
        if (setup && exercise) exercises.set(mutation.input.id, { ...metadata, sessionId: mutation.session.id, setupId: setup.id, ordinal: mutation.input.ordinal, targetSnapshot: mutation.input.target, displaySnapshot: { schemaVersion: 1, exerciseId: exercise.id, catalogVersion: exercise.catalogVersion, name: exercise.personalName ?? labels.get(exercise.id)?.en ?? '', locale: exercise.personalLocale ?? 'en', equipmentType: exercise.equipmentType, equipmentInstance: setup.equipmentInstance, variant: exercise.variant, muscles: exercise.muscles, movementPattern: exercise.movementPattern, loadSemantics: setup.loadSemantics, includesBar: setup.includesBar, barWeightDecimal: setup.barWeightDecimal, barUnit: setup.barUnit, defaultsOrigin: setup.defaultsOrigin ?? null } });
        break;
      }
      case 'session-exercise.update': { const before = exercises.get(mutation.target.id); if (before) exercises.set(before.id, { ...before, ordinal: mutation.input.ordinal ?? before.ordinal, targetSnapshot: mutation.input.target === undefined ? before.targetSnapshot : mutation.input.target }); break; }
      case 'day-exercise.delete':
      case 'session-exercise.delete': exercises.delete(mutation.target.id); break;
      case 'day-set.create':
      case 'set.create': {
        if (mutation.kind === 'day-set.create') {
        const input = mutation.input;
        if (input.createSession) sessions.set(mutation.session.id, dailySession(ledger.ownerId, input.localDate, input.entryTimezone, mutation.session.id, command.createdAt, command.operationId));
        if (!exercises.has(input.exercise.id)) {
          const setup = setups.get(input.exercise.setupId), definition = setup && definitions.get(setup.exerciseId);
          if (setup && definition) exercises.set(input.exercise.id, localExercise(sessions.get(mutation.session.id)!, setup, definition, labels, input.exercise.id, input.exercise.ordinal));
        }
        }
        const input = mutation.input, load = input.load;
        sets.set(input.id, { ...metadata, sessionExerciseId: input.sessionExerciseId, ordinal: input.ordinal, reps: input.reps, loadDecimal: load?.value ?? null, unit: load?.unit ?? null, kgMicros: load ? normalizeMass(load.value, load.unit).kgMicros : null, loadSemantics: load?.semantics ?? 'bodyweight_only', setType: input.setType, rpeHalfUnits: input.rpe === null ? null : input.rpe * 2, completedAt: input.completedAt !== undefined ? input.completedAt : sessions.get(mutation.session.id)?.timePrecision === 'date' ? null : command.createdAt, note: input.note, sourceRowId: null });
        break;
      }
      case 'day-set.update':
      case 'set.update': {
        const before = sets.get(mutation.target.id);
        if (before) {
          const { load, rpe, ...rest } = mutation.input;
          sets.set(before.id, { ...before, ...rest, ...(rpe !== undefined ? { rpeHalfUnits: rpe === null ? null : rpe * 2 } : {}), ...(load !== undefined ? { loadDecimal: load?.value ?? null, unit: load?.unit ?? null, kgMicros: load ? normalizeMass(load.value, load.unit).kgMicros : null, loadSemantics: load?.semantics ?? 'bodyweight_only' } : {}) });
        }
        break;
      }
      case 'day-set.delete':
      case 'set.delete': sets.delete(mutation.target.id); break;
    }
  }
  const visibleSessions = new Set([...sessions.values()].filter(row => !row.deletedAt).map(row => row.id));
  const visibleExercises = new Set([...exercises.values()].filter(row => visibleSessions.has(row.sessionId)).map(row => row.id));
  return { sessions: [...sessions.values()], exercises: [...exercises.values()].filter(row => visibleSessions.has(row.sessionId)).sort((a,b) => a.ordinal - b.ordinal), sets: [...sets.values()].filter(row => visibleExercises.has(row.sessionExerciseId)).sort((a,b) => a.ordinal - b.ordinal), setups: [...setups.values()], definitions: [...definitions.values()], pending, labels };
}
export function latestHistory(ledger: LocalLedger, sessionId: string, setupId: string, cutoff?: Pick<WorkoutSession, 'localDate' | 'createdAt'>) {
  const entities = visibleLedgerEntities(ledger);
  const sessions = entities.flatMap(item => item.kind === 'workout_session' && item.value.id !== sessionId && (!cutoff || item.value.localDate < cutoff.localDate || (item.value.localDate === cutoff.localDate && item.value.createdAt < cutoff.createdAt)) && ['draft', 'in_progress', 'paused', 'completed', 'recorded'].includes(item.value.status) ? [item.value] : []).sort((a,b) => b.localDate.localeCompare(a.localDate) || b.createdAt.localeCompare(a.createdAt));
  for (const session of sessions) {
    const ids = new Set(entities.flatMap(item => item.kind === 'session_exercise' && item.value.sessionId === session.id && item.value.setupId === setupId ? [item.value.id] : []));
    const sets = entities.flatMap(item => item.kind === 'workout_set' && ids.has(item.value.sessionExerciseId) ? [item.value] : []).sort((a,b) => a.ordinal - b.ordinal);
    if (sets.length) return { session, sets };
  }
  return null;
}

export function dailySession(ownerId: string, localDate: string, entryTimezone: string, id: string, now = new Date().toISOString(), operationId = id): WorkoutSession {
  return { id, ownerId, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, operationId, createdOperationId: operationId, localDate, entryTimezone, status: 'recorded', timePrecision: 'date', startedAt: null, endedAt: null, planVersionId: null, scheduledSessionId: null, planSnapshot: null, title: null, note: null, recovery: null, sourceKind: 'manual', sourceRef: null };
}
export function localExercise(session: WorkoutSession, setup: ExerciseSetup, exercise: ExerciseDefinition, labels: Map<string, Record<string, string>>, id: string, ordinal: number): SessionExercise {
  return { id, ownerId: session.ownerId, revision: 1, createdAt: session.createdAt, updatedAt: session.createdAt, deletedAt: null, operationId: id, createdOperationId: id, sessionId: session.id, setupId: setup.id, ordinal, targetSnapshot: null,
    displaySnapshot: { schemaVersion: 1, exerciseId: exercise.id, catalogVersion: exercise.catalogVersion, name: exercise.personalName ?? labels.get(exercise.id)?.en ?? '', locale: exercise.personalLocale ?? 'en', equipmentType: exercise.equipmentType, equipmentInstance: setup.equipmentInstance, variant: exercise.variant, muscles: exercise.muscles, movementPattern: exercise.movementPattern, loadSemantics: setup.loadSemantics, includesBar: setup.includesBar, barWeightDecimal: setup.barWeightDecimal, barUnit: setup.barUnit, defaultsOrigin: setup.defaultsOrigin ?? null } };
}
