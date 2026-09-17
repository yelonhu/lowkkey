import { dayClaimSchema, exerciseAliasSchema, exerciseSetupSchema, personalExerciseSchema, planVersionSchema, scheduledSessionSchema, sessionExerciseSchema, workoutSessionSchema, workoutSetSchema } from '../domain/training.ts';
import type { DayClaim, ExerciseAlias, ExerciseSetup, PersonalExercise, PlanVersion, ScheduledSession, SessionExercise, WorkoutSession, WorkoutSet } from '../domain/training.ts';
import { RecordStore, recordColumns } from './record-store.ts';

export const personalExercises = new RecordStore<PersonalExercise>('exercise_definitions', 'exercise_definition', personalExerciseSchema, {
  ...recordColumns, scope: 'scope', catalogVersion: 'catalog_version', familyId: 'family_id', parentExerciseId: 'parent_exercise_id', equipmentType: 'equipment_type', variant: 'variant_json', muscles: 'muscle_groups_json', status: 'status', personalName: 'personal_name', personalLocale: 'personal_locale',
}, ['variant', 'muscles']);
export const setups = new RecordStore<ExerciseSetup>('exercise_setups', 'exercise_setup', exerciseSetupSchema, {
  ...recordColumns, exerciseId: 'exercise_id', equipmentInstance: 'equipment_instance', loadSemantics: 'load_semantics', loadUnit: 'load_unit', includesBar: 'includes_bar', barWeightDecimal: 'bar_weight_decimal', barUnit: 'bar_unit', incrementDecimal: 'increment_decimal', incrementUnit: 'increment_unit', availableLoads: 'available_loads_json',
}, ['availableLoads'], ['includesBar'], { availableLoads: 'available_loads_revision' });
export const exerciseAliases = new RecordStore<ExerciseAlias>('exercise_aliases', 'exercise_alias', exerciseAliasSchema, {
  ...recordColumns, aliasOriginal: 'alias_original', aliasNormalized: 'alias_normalized', localeHint: 'locale_hint', exerciseId: 'exercise_id', context: 'context_json', confirmedAt: 'confirmed_at',
}, ['context']);
export const plans = new RecordStore<PlanVersion>('plan_versions', 'plan_version', planVersionSchema, {
  ...recordColumns, title: 'title', effectiveLocalDate: 'effective_local_date', status: 'status', snapshot: 'snapshot_json', supersedesId: 'supersedes_id',
}, ['snapshot'], [], { snapshot: 'snapshot_revision' });
export const schedules = new RecordStore<ScheduledSession>('scheduled_sessions', 'scheduled_session', scheduledSessionSchema, {
  ...recordColumns, localDate: 'local_date', entryTimezone: 'entry_timezone', planVersionId: 'plan_version_id', templateId: 'template_id', plannedStartLocal: 'planned_start_local', status: 'status', movedFromId: 'moved_from_id', overrideMode: 'override_mode', overrideSnapshot: 'override_snapshot_json',
}, ['overrideSnapshot']);
export const sessions = new RecordStore<WorkoutSession>('workout_sessions', 'workout_session', workoutSessionSchema, {
  ...recordColumns, localDate: 'local_date', entryTimezone: 'entry_timezone', startedAt: 'started_at', endedAt: 'ended_at', timePrecision: 'time_precision', status: 'status', planVersionId: 'plan_version_id', scheduledSessionId: 'scheduled_session_id', planSnapshot: 'plan_snapshot_json', title: 'title', note: 'note', recovery: 'recovery_json', sourceRef: 'source_ref', sourceKind: 'source_kind',
}, ['planSnapshot', 'recovery'], [], { recovery: 'recovery_revision' });
export const sessionExercises = new RecordStore<SessionExercise>('session_exercises', 'session_exercise', sessionExerciseSchema, {
  ...recordColumns, sessionId: 'session_id', setupId: 'setup_id', ordinal: 'ordinal', displaySnapshot: 'display_snapshot_json', targetSnapshot: 'target_snapshot_json',
}, ['displaySnapshot', 'targetSnapshot'], [], { targetSnapshot: 'target_revision' });
export const sets = new RecordStore<WorkoutSet>('workout_sets', 'workout_set', workoutSetSchema, {
  ...recordColumns, sessionExerciseId: 'session_exercise_id', ordinal: 'ordinal', reps: 'reps', loadDecimal: 'load_decimal', unit: 'unit', kgMicros: 'kg_micros', loadSemantics: 'load_semantics', setType: 'set_type', rpeHalfUnits: 'rpe_half_units', completedAt: 'completed_at', note: 'note', sourceRowId: 'source_row_id',
});
export const claims = new RecordStore<DayClaim>('day_claims', 'day_claim', dayClaimSchema, {
  ...recordColumns, localDate: 'local_date', entryTimezone: 'entry_timezone', trainingClaim: 'training_claim', nutritionCompleteness: 'nutrition_completeness', nutritionReviewedAt: 'nutrition_reviewed_at', reviewInvalidatedReason: 'review_invalidated_reason', explicitZeroIntake: 'explicit_zero_intake',
}, [], ['explicitZeroIntake']);
