import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), verifiedSubject: text('verified_subject'), emailNormalized: text('email_normalized').notNull(),
  role: text('role', { enum: ['member', 'admin'] }).notNull(), status: text('status', { enum: ['invited', 'active', 'suspended', 'deletion_pending', 'deleted'] }).notNull(),
  locale: text('locale', { enum: ['zh-Hans', 'zh-Hant', 'en'] }).notNull(), timezone: text('timezone').notNull(),
  dataRevision: integer('data_revision').notNull().default(0), membershipRevision: integer('membership_revision').notNull().default(1), createdAt: text('created_at').notNull(), suspendedAt: text('suspended_at'),
}, table => [
  uniqueIndex('users_email_unique').on(table.emailNormalized), uniqueIndex('users_subject_unique').on(table.verifiedSubject),
  check('users_role', sql`${table.role} IN ('member','admin')`), check('users_status', sql`${table.status} IN ('invited','active','suspended','deletion_pending','deleted')`),
  check('users_locale', sql`${table.locale} IN ('zh-Hans','zh-Hant','en')`), check('users_revision', sql`${table.dataRevision} >= 0 AND ${table.dataRevision} <= 9007199254740991`),
  check('users_membership_revision', sql`${table.membershipRevision} >= 1 AND ${table.membershipRevision} <= 9007199254740991`),
]);
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(), emailNormalized: text('email_normalized').notNull(), expiresAt: text('expires_at').notNull(),
  status: text('status', { enum: ['invited', 'accepted', 'expired', 'revoked'] }).notNull(),
  createdBy: text('created_by').notNull().references(() => users.id), acceptedUserId: text('accepted_user_id').references(() => users.id), createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('invitations_pending_email').on(table.emailNormalized).where(sql`${table.status} = 'invited'`), check('invitations_status', sql`${table.status} IN ('invited','accepted','expired','revoked')`)]);
export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  displayName: text('display_name').notNull(), bodyWeightUnit: text('body_weight_unit', { enum: ['kg', 'lb'] }).notNull().default('kg'),
  defaultLoadUnit: text('default_load_unit', { enum: ['kg', 'lb'] }).notNull().default('kg'), trainingExperience: text('training_experience', { enum: ['beginner', 'intermediate', 'experienced', 'unknown'] }).notNull().default('unknown'),
  heightCm: integer('height_cm'), constraintsText: text('constraints_text'), digestEnabled: integer('digest_enabled', { mode: 'boolean' }).notNull().default(true),
  nextDigestAt: text('next_digest_at').notNull(), pendingTimezone: text('pending_timezone'), timezoneEffectiveDate: text('timezone_effective_date'), autoMemoryEnabled: integer('auto_memory_enabled', { mode: 'boolean' }).notNull().default(true),
}, table => [
  uniqueIndex('profiles_owner_unique').on(table.ownerId), uniqueIndex('profiles_owner_id_unique').on(table.ownerId, table.id),
  check('profiles_revision', sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`),
  check('profiles_units', sql`${table.bodyWeightUnit} IN ('kg','lb') AND ${table.defaultLoadUnit} IN ('kg','lb')`),
  check('profiles_experience', sql`${table.trainingExperience} IN ('beginner','intermediate','experienced','unknown')`),
  check('profiles_display_name', sql`length(${table.displayName}) BETWEEN 1 AND 40`), check('profiles_height', sql`${table.heightCm} IS NULL OR ${table.heightCm} BETWEEN 50 AND 250`),
  check('profiles_constraints', sql`${table.constraintsText} IS NULL OR length(${table.constraintsText}) <= 2000`), check('profiles_digest', sql`${table.digestEnabled} IN (0,1)`),
  check('profiles_memory', sql`${table.autoMemoryEnabled} IN (0,1)`),
]);

export const membershipState = sqliteTable('membership_state', { id: integer('id').primaryKey(), revision: integer('revision').notNull().default(1) }, table => [check('membership_singleton', sql`${table.id}=1`), check('membership_revision', sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`)]);
export const revokedSessions = sqliteTable('revoked_sessions', { tokenHash: text('token_hash').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), expiresAt: text('expires_at').notNull(), revokedAt: text('revoked_at').notNull() }, table => [index('revoked_session_expiry').on(table.expiresAt)]);

export const goalVersions = sqliteTable('goal_versions', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), revision: integer('revision').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  goalType: text('goal_type').notNull(), effectiveLocalDate: text('effective_local_date').notNull(),
  energyTargetMkcal: integer('energy_target_mkcal'), proteinTargetMg: integer('protein_target_mg'), carbsTargetMg: integer('carbs_target_mg'), fatTargetMg: integer('fat_target_mg'),
  weightMinKgMicros: integer('weight_min_kg_micros'), weightMaxKgMicros: integer('weight_max_kg_micros'), weeklyChangeMinPct: real('weekly_change_min_pct'), weeklyChangeMaxPct: real('weekly_change_max_pct'),
  supersedesId: text('supersedes_id'), rawInputJson: text('raw_input_json').notNull(), createdDataRevision: integer('created_data_revision').notNull(), operationId: text('operation_id').notNull(),
}, table => [uniqueIndex('goals_owner_id').on(table.ownerId, table.id), index('goals_owner_effective').on(table.ownerId, table.effectiveLocalDate, table.createdDataRevision),
  foreignKey({ columns: [table.ownerId, table.supersedesId], foreignColumns: [table.ownerId, table.id] }),
  check('goal_immutable_revision', sql`${table.revision}=1`), check('goal_type', sql`${table.goalType} IN ('lean_bulk','fat_loss','maintenance')`),
  check('goal_data_revision', sql`${table.createdDataRevision} >= 1 AND ${table.createdDataRevision} <= 9007199254740991`),
  check('goal_energy', sql`${table.energyTargetMkcal} IS NULL OR (${table.energyTargetMkcal}>0 AND ${table.energyTargetMkcal}<=9007199254740991)`),
  check('goal_macros', sql`(${table.proteinTargetMg} IS NULL OR ${table.proteinTargetMg} BETWEEN 0 AND 9007199254740991) AND (${table.carbsTargetMg} IS NULL OR ${table.carbsTargetMg} BETWEEN 0 AND 9007199254740991) AND (${table.fatTargetMg} IS NULL OR ${table.fatTargetMg} BETWEEN 0 AND 9007199254740991)`),
  check('goal_weight_band', sql`(${table.weightMinKgMicros} IS NULL OR ${table.weightMinKgMicros} BETWEEN 1000000 AND 500000000) AND (${table.weightMaxKgMicros} IS NULL OR ${table.weightMaxKgMicros} BETWEEN 1000000 AND 500000000) AND (${table.weightMinKgMicros} IS NULL OR ${table.weightMaxKgMicros} IS NULL OR ${table.weightMinKgMicros}<=${table.weightMaxKgMicros})`),
  check('goal_change_band', sql`${table.weeklyChangeMinPct} IS NULL OR ${table.weeklyChangeMaxPct} IS NULL OR ${table.weeklyChangeMinPct}<=${table.weeklyChangeMaxPct}`),
]);

export const mutationGuards = sqliteTable('mutation_guards', {
  operationId: text('operation_id').notNull(), ownerId: text('owner_id').notNull().references(() => users.id), conditionOk: integer('condition_ok').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.operationId] }), check('mutation_guard_passed', sql`${table.conditionOk} = 1`)]);
export const commandOperations = sqliteTable('command_operations', {
  operationId: text('operation_id').notNull(), ownerId: text('owner_id').notNull().references(() => users.id), requestHash: text('request_hash').notNull(),
  kind: text('kind').notNull(), actorKind: text('actor_kind').notNull(), actorId: text('actor_id').notNull(), entryPoint: text('entry_point').notNull(),
  authorizationJson: text('authorization_json').notNull(), targetRefsJson: text('target_refs_json').notNull(), responseJson: text('response_json').notNull(),
  status: text('status').notNull().default('committed'), createdAt: text('created_at').notNull(), undoUntil: text('undo_until'), undoneBy: text('undone_by'),
}, table => [primaryKey({ columns: [table.ownerId, table.operationId] }), index('operations_owner_created').on(table.ownerId, table.createdAt),
  check('operations_status', sql`${table.status} = 'committed'`), check('operations_actor', sql`${table.actorKind} IN ('user','assistant','system')`)]);
export const operationRevisions = sqliteTable('operation_revisions', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), operationId: text('operation_id').notNull(),
  targetType: text('target_type').notNull(), targetId: text('target_id').notNull(), beforeRevision: integer('before_revision'), afterRevision: integer('after_revision').notNull(),
  beforeSnapshot: text('before_snapshot'), afterSnapshot: text('after_snapshot').notNull(), createdAt: text('created_at').notNull(),
}, table => [foreignKey({ columns: [table.ownerId, table.operationId], foreignColumns: [commandOperations.ownerId, commandOperations.operationId] }),
  uniqueIndex('operation_entity_once').on(table.ownerId, table.operationId, table.targetType, table.targetId),
  check('operation_revision_step', sql`${table.afterRevision} >= 1 AND ${table.afterRevision} <= 9007199254740991 AND ((${table.beforeRevision} IS NULL AND ${table.afterRevision}=1) OR ${table.afterRevision}=${table.beforeRevision}+1)`)]);
export const changeBatches = sqliteTable('change_batches', {
  ownerId: text('owner_id').notNull(), dataRevision: integer('data_revision').notNull(), operationId: text('operation_id').notNull(), source: text('source').notNull(),
  originThreadId: text('origin_thread_id'), changesJson: text('changes_json').notNull(), eventsJson: text('events_json').notNull(), createdAt: text('created_at').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.dataRevision] }), uniqueIndex('one_batch_per_operation').on(table.ownerId, table.operationId),
  foreignKey({ columns: [table.ownerId, table.operationId], foreignColumns: [commandOperations.ownerId, commandOperations.operationId] }),
  check('change_revision', sql`${table.dataRevision} >= 1 AND ${table.dataRevision} <= 9007199254740991`), check('change_source', sql`${table.source} IN ('user','assistant','system')`)]);

export const weightEntries = sqliteTable('weight_entries', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  localDate: text('local_date').notNull(), entryTimezone: text('entry_timezone').notNull(), occurredAt: text('occurred_at'), timePrecision: text('time_precision').notNull(),
  valueDecimal: text('value_decimal').notNull(), unit: text('unit').notNull(), kgMicros: integer('kg_micros').notNull(), condition: text('condition').notNull(), isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
  sourceKind: text('source_kind').notNull(), sourceRef: text('source_ref'), operationId: text('operation_id').notNull(), createdOperationId: text('created_operation_id').notNull(),
}, table => [
  uniqueIndex('weights_owner_id').on(table.ownerId, table.id), index('weights_owner_date').on(table.ownerId, table.localDate),
  uniqueIndex('weights_primary_day').on(table.ownerId, table.localDate).where(sql`${table.isPrimary}=1 AND ${table.deletedAt} IS NULL`),
  check('weight_revision', sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`),
  check('weight_kg', sql`${table.kgMicros} BETWEEN 1000000 AND 500000000`), check('weight_unit', sql`${table.unit} IN ('kg','lb')`),
  check('weight_condition', sql`${table.condition} IN ('fasted','other','unspecified')`), check('weight_primary_bool', sql`${table.isPrimary} IN (0,1)`),
  check('weight_precision', sql`(${table.timePrecision}='date' AND ${table.occurredAt} IS NULL) OR (${table.timePrecision}='instant' AND ${table.occurredAt} IS NOT NULL)`),
  check('weight_source', sql`${table.sourceKind} IN ('manual','assistant_explicit','imported_text','imported_image','photo','copied','system')`),
]);

const ownedColumns = () => ({
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  operationId: text('operation_id').notNull(), createdOperationId: text('created_operation_id').notNull(),
});
export const exerciseDefinitions = sqliteTable('exercise_definitions', {
  id: text('id').primaryKey(), ownerId: text('owner_id').references(() => users.id), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  scope: text('scope').notNull(), catalogVersion: text('catalog_version').notNull(), familyId: text('family_id').notNull(), parentExerciseId: text('parent_exercise_id'),
  movementPattern: text('movement_pattern').notNull().default('unspecified'), catalogReviewJson: text('catalog_review_json'),
  equipmentType: text('equipment_type').notNull(), variantJson: text('variant_json').notNull(), muscleGroupsJson: text('muscle_groups_json').notNull(), status: text('status').notNull(),
  personalName: text('personal_name'), personalLocale: text('personal_locale'), operationId: text('operation_id'), createdOperationId: text('created_operation_id'),
}, table => [uniqueIndex('exercises_owner_id').on(table.ownerId, table.id), index('exercises_scope_owner').on(table.scope, table.ownerId, table.status),
  foreignKey({ columns: [table.parentExerciseId], foreignColumns: [table.id] }),
  check('exercise_ownership', sql`(${table.scope}='system' AND ${table.ownerId} IS NULL AND ${table.personalName} IS NULL AND ${table.personalLocale} IS NULL) OR (${table.scope}='personal' AND ${table.ownerId} IS NOT NULL AND ${table.personalName} IS NOT NULL AND ${table.personalLocale} IN ('zh-Hans','zh-Hant','en') AND ${table.operationId} IS NOT NULL AND ${table.createdOperationId} IS NOT NULL)`),
  check('exercise_status', sql`${table.status} IN ('active','archived')`), check('exercise_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
  check('exercise_json', sql`json_valid(${table.variantJson}) AND json_valid(${table.muscleGroupsJson})`),
]);
export const exerciseLabels = sqliteTable('exercise_labels', {
  exerciseId: text('exercise_id').notNull().references(() => exerciseDefinitions.id), locale: text('locale').notNull(), displayName: text('display_name').notNull(), searchTerms: text('search_terms').notNull(),
}, table => [primaryKey({ columns: [table.exerciseId, table.locale] }), check('exercise_label_locale', sql`${table.locale} IN ('zh-Hans','zh-Hant','en')`)]);
export const exerciseSetups = sqliteTable('exercise_setups', {
  ...ownedColumns(), exerciseId: text('exercise_id').notNull().references(() => exerciseDefinitions.id), equipmentInstance: text('equipment_instance'),
  loadSemantics: text('load_semantics').notNull(), loadUnit: text('load_unit').notNull(), includesBar: integer('includes_bar', { mode: 'boolean' }),
  barWeightDecimal: text('bar_weight_decimal'), barUnit: text('bar_unit'), incrementDecimal: text('increment_decimal'), incrementUnit: text('increment_unit'), availableLoadsJson: text('available_loads_json'), defaultsOriginJson: text('defaults_origin_json'),
}, table => [uniqueIndex('setups_owner_id').on(table.ownerId, table.id), index('setups_owner_exercise').on(table.ownerId, table.exerciseId),
  check('setup_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('setup_unit', sql`${table.loadUnit} IN ('kg','lb')`),
  check('setup_semantics', sql`${table.loadSemantics} IN ('external_total','per_side','added_weight','assistance','bodyweight_only','unspecified')`),
  check('setup_bar', sql`(${table.barWeightDecimal} IS NULL AND ${table.barUnit} IS NULL) OR (${table.barWeightDecimal} IS NOT NULL AND ${table.barUnit} IN ('kg','lb'))`),
  check('setup_increment', sql`(${table.incrementDecimal} IS NULL AND ${table.incrementUnit} IS NULL) OR (${table.incrementDecimal} IS NOT NULL AND ${table.incrementUnit} IN ('kg','lb'))`),
  check('setup_defaults_json', sql`${table.defaultsOriginJson} IS NULL OR json_valid(${table.defaultsOriginJson})`), check('setup_bool', sql`${table.includesBar} IS NULL OR ${table.includesBar} IN (0,1)`), check('setup_json', sql`${table.availableLoadsJson} IS NULL OR json_valid(${table.availableLoadsJson})`),
]);
export const exerciseAliases = sqliteTable('exercise_aliases', {
  ...ownedColumns(), aliasOriginal: text('alias_original').notNull(), aliasNormalized: text('alias_normalized').notNull(), localeHint: text('locale_hint'),
  exerciseId: text('exercise_id').notNull().references(() => exerciseDefinitions.id), contextJson: text('context_json'), confirmedAt: text('confirmed_at').notNull(),
}, table => [uniqueIndex('exercise_alias_owner_id').on(table.ownerId, table.id), index('exercise_alias_lookup').on(table.ownerId, table.aliasNormalized),
  check('alias_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('alias_json', sql`${table.contextJson} IS NULL OR json_valid(${table.contextJson})`),
]);
export const planVersions = sqliteTable('plan_versions', {
  ...ownedColumns(), title: text('title').notNull(), effectiveLocalDate: text('effective_local_date').notNull(), status: text('status').notNull(), snapshotJson: text('snapshot_json').notNull(), supersedesId: text('supersedes_id'),
}, table => [uniqueIndex('plans_owner_id').on(table.ownerId, table.id), index('plans_owner_date').on(table.ownerId, table.effectiveLocalDate),
  foreignKey({ columns: [table.ownerId, table.supersedesId], foreignColumns: [table.ownerId, table.id] }),
  check('plan_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('plan_status', sql`${table.status} IN ('draft','published','archived')`), check('plan_json', sql`json_valid(${table.snapshotJson})`),
]);
export const planSelections = sqliteTable('plan_selections', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), planVersionId: text('plan_version_id'), effectiveLocalDate: text('effective_local_date').notNull(), dataRevision: integer('data_revision').notNull(), operationId: text('operation_id').notNull(),
}, table => [foreignKey({ columns: [table.ownerId, table.planVersionId], foreignColumns: [planVersions.ownerId, planVersions.id] }), index('plan_selection_effective').on(table.ownerId, table.effectiveLocalDate, table.dataRevision), uniqueIndex('plan_selection_operation').on(table.ownerId, table.operationId), check('plan_selection_revision', sql`${table.dataRevision} BETWEEN 1 AND 9007199254740991`)]);
export const scheduledSessions = sqliteTable('scheduled_sessions', {
  overrideMode: text('override_mode', { enum: ['additional', 'template', 'day'] }).notNull().default('additional'),
  ...ownedColumns(), localDate: text('local_date').notNull(), entryTimezone: text('entry_timezone').notNull(), planVersionId: text('plan_version_id'), templateId: text('template_id'), plannedStartLocal: text('planned_start_local'), status: text('status').notNull(), movedFromId: text('moved_from_id'), overrideSnapshotJson: text('override_snapshot_json'),
}, table => [uniqueIndex('schedules_owner_id').on(table.ownerId, table.id), index('schedules_owner_date').on(table.ownerId, table.localDate),
  foreignKey({ columns: [table.ownerId, table.planVersionId], foreignColumns: [planVersions.ownerId, planVersions.id] }), foreignKey({ columns: [table.ownerId, table.movedFromId], foreignColumns: [table.ownerId, table.id] }),
  check('schedule_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('schedule_status', sql`${table.status} IN ('planned','skipped','moved','cancelled')`),
  check('schedule_source', sql`(${table.planVersionId} IS NULL) = (${table.templateId} IS NULL)`), check('schedule_json', sql`${table.overrideSnapshotJson} IS NULL OR json_valid(${table.overrideSnapshotJson})`),
]);
export const workoutSessions = sqliteTable('workout_sessions', {
  ...ownedColumns(), localDate: text('local_date').notNull(), entryTimezone: text('entry_timezone').notNull(), startedAt: text('started_at'), endedAt: text('ended_at'), timePrecision: text('time_precision').notNull(), status: text('status').notNull(), planVersionId: text('plan_version_id'), scheduledSessionId: text('scheduled_session_id'), planSnapshotJson: text('plan_snapshot_json'), title: text('title'), note: text('note'), recoveryJson: text('recovery_json'), sourceRef: text('source_ref'), sourceKind: text('source_kind').notNull(),
}, table => [uniqueIndex('sessions_owner_id').on(table.ownerId, table.id), index('sessions_owner_date').on(table.ownerId, table.localDate),
  foreignKey({ columns: [table.ownerId, table.planVersionId], foreignColumns: [planVersions.ownerId, planVersions.id] }), foreignKey({ columns: [table.ownerId, table.scheduledSessionId], foreignColumns: [scheduledSessions.ownerId, scheduledSessions.id] }),
  uniqueIndex('one_session_in_progress').on(table.ownerId).where(sql`${table.status}='in_progress' AND ${table.deletedAt} IS NULL`),
  uniqueIndex('one_actual_per_schedule').on(table.ownerId, table.scheduledSessionId).where(sql`${table.deletedAt} IS NULL AND ${table.status}<>'cancelled'`),
  check('session_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('session_status', sql`${table.status} IN ('draft','in_progress','paused','completed','cancelled','deleted')`),
  check('session_tombstone', sql`(${table.status}='deleted') = (${table.deletedAt} IS NOT NULL)`), check('session_precision', sql`(${table.timePrecision}='date' AND ${table.startedAt} IS NULL AND ${table.endedAt} IS NULL) OR ${table.timePrecision}='instant'`),
  check('session_time_order', sql`${table.startedAt} IS NULL OR ${table.endedAt} IS NULL OR ${table.startedAt}<=${table.endedAt}`),
  check('session_json', sql`(${table.planSnapshotJson} IS NULL OR json_valid(${table.planSnapshotJson})) AND (${table.recoveryJson} IS NULL OR json_valid(${table.recoveryJson}))`),
]);
export const sessionExercises = sqliteTable('session_exercises', {
  ...ownedColumns(), sessionId: text('session_id').notNull(), setupId: text('setup_id').notNull(), ordinal: integer('ordinal').notNull(), displaySnapshotJson: text('display_snapshot_json').notNull(), targetSnapshotJson: text('target_snapshot_json'),
}, table => [uniqueIndex('session_exercises_owner_id').on(table.ownerId, table.id), uniqueIndex('exercise_ordinal').on(table.ownerId, table.sessionId, table.ordinal).where(sql`${table.deletedAt} IS NULL`), index('exercise_history_lookup').on(table.ownerId, table.setupId, table.sessionId),
  foreignKey({ columns: [table.ownerId, table.sessionId], foreignColumns: [workoutSessions.ownerId, workoutSessions.id] }), foreignKey({ columns: [table.ownerId, table.setupId], foreignColumns: [exerciseSetups.ownerId, exerciseSetups.id] }),
  check('session_exercise_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991 AND ${table.ordinal} BETWEEN 1 AND 9007199254740991`), check('session_exercise_json', sql`json_valid(${table.displaySnapshotJson}) AND (${table.targetSnapshotJson} IS NULL OR json_valid(${table.targetSnapshotJson}))`),
]);
export const workoutSets = sqliteTable('workout_sets', {
  ...ownedColumns(), sessionExerciseId: text('session_exercise_id').notNull(), ordinal: integer('ordinal').notNull(), reps: integer('reps').notNull(), loadDecimal: text('load_decimal'), unit: text('unit'), kgMicros: integer('kg_micros'), loadSemantics: text('load_semantics').notNull(), setType: text('set_type').notNull(), rpeHalfUnits: integer('rpe_half_units'), completedAt: text('completed_at'), note: text('note'), sourceRowId: text('source_row_id'),
}, table => [uniqueIndex('sets_owner_id').on(table.ownerId, table.id), uniqueIndex('set_ordinal').on(table.ownerId, table.sessionExerciseId, table.ordinal).where(sql`${table.deletedAt} IS NULL`),
  foreignKey({ columns: [table.ownerId, table.sessionExerciseId], foreignColumns: [sessionExercises.ownerId, sessionExercises.id] }), check('set_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991 AND ${table.ordinal} BETWEEN 1 AND 9007199254740991`),
  check('set_reps', sql`${table.reps} BETWEEN 1 AND 200`), check('set_rpe', sql`${table.rpeHalfUnits} IS NULL OR ${table.rpeHalfUnits} BETWEEN 2 AND 20`), check('set_type', sql`${table.setType} IN ('warmup','work','backoff','drop','unknown')`),
  check('set_load', sql`(${table.loadSemantics}='bodyweight_only' AND ${table.loadDecimal} IS NULL AND ${table.unit} IS NULL AND ${table.kgMicros} IS NULL) OR (${table.loadSemantics} IN ('external_total','per_side','added_weight','assistance','unspecified') AND ${table.loadDecimal} IS NOT NULL AND ${table.unit} IS NOT NULL AND ${table.kgMicros} IS NOT NULL AND typeof(${table.kgMicros})='integer' AND ${table.unit} IN ('kg','lb') AND ${table.kgMicros} BETWEEN 0 AND 1000000000)`),
]);
export const dayClaims = sqliteTable('day_claims', {
  ...ownedColumns(), localDate: text('local_date').notNull(), entryTimezone: text('entry_timezone').notNull(), trainingClaim: text('training_claim').notNull(), nutritionCompleteness: text('nutrition_completeness').notNull(), nutritionReviewedAt: text('nutrition_reviewed_at'), reviewInvalidatedReason: text('review_invalidated_reason'), explicitZeroIntake: integer('explicit_zero_intake', { mode: 'boolean' }).notNull(),
}, table => [uniqueIndex('claims_owner_id').on(table.ownerId, table.id), uniqueIndex('claims_owner_date').on(table.ownerId, table.localDate), check('claim_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('training_claim', sql`${table.trainingClaim} IN ('unspecified','rest_confirmed')`), check('nutrition_claim', sql`${table.nutritionCompleteness} IN ('unreviewed','partial','complete') AND ${table.explicitZeroIntake} IN (0,1)`)]);

export const foodDefinitions = sqliteTable('food_definitions', {
  id: text('id').primaryKey(), ownerId: text('owner_id').references(() => users.id), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  scope: text('scope').notNull(), catalogVersion: text('catalog_version').notNull(), kind: text('kind').notNull(), referenceState: text('reference_state').notNull(),
  preparation: text('preparation'), cutOrPart: text('cut_or_part'), brand: text('brand'), status: text('status').notNull(),
  personalName: text('personal_name'), personalLocale: text('personal_locale'), operationId: text('operation_id'), createdOperationId: text('created_operation_id'),
}, table => [uniqueIndex('foods_owner_id').on(table.ownerId, table.id), index('foods_scope_owner').on(table.scope, table.ownerId, table.status),
  check('food_ownership', sql`(${table.scope}='system' AND ${table.ownerId} IS NULL AND ${table.personalName} IS NULL AND ${table.personalLocale} IS NULL) OR (${table.scope}='personal' AND ${table.ownerId} IS NOT NULL AND ${table.personalName} IS NOT NULL AND ${table.personalLocale} IN ('zh-Hans','zh-Hant','en') AND ${table.operationId} IS NOT NULL AND ${table.createdOperationId} IS NOT NULL)`),
  check('food_status', sql`${table.status} IN ('active','archived')`), check('food_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
  check('food_state', sql`${table.referenceState} IN ('raw','cooked','as_packaged','unknown')`), check('food_kind', sql`${table.kind} IN ('basic_food','personal_recipe','packaged_food','composite_meal','manual_total')`),
]);
export const foodLabels = sqliteTable('food_labels', {
  foodId: text('food_id').notNull().references(() => foodDefinitions.id), locale: text('locale').notNull(), displayName: text('display_name').notNull(), searchTerms: text('search_terms').notNull(),
}, table => [primaryKey({ columns: [table.foodId, table.locale] }), check('food_label_locale', sql`${table.locale} IN ('zh-Hans','zh-Hant','en')`)]);
export const nutritionReferences = sqliteTable('nutrition_references', {
  id: text('id').primaryKey(), foodId: text('food_id').notNull().references(() => foodDefinitions.id),
  basis: text('basis').notNull(), servingQuantity: text('serving_quantity'), servingUnit: text('serving_unit'), nutrientsJson: text('nutrients_json').notNull(),
  sourceName: text('source_name').notNull(), sourceEntryId: text('source_entry_id'), sourceUrl: text('source_url'), sourceVersion: text('source_version').notNull(),
  provenance: text('provenance').notNull(), estimated: integer('estimated', { mode: 'boolean' }).notNull(), retrievedAt: text('retrieved_at').notNull(),
}, table => [index('references_food').on(table.foodId),
  check('reference_basis', sql`(${table.basis} IN ('per_100g','per_100ml') AND ${table.servingQuantity} IS NULL AND ${table.servingUnit} IS NULL) OR (${table.basis}='per_serving' AND ${table.servingQuantity} IS NOT NULL AND ${table.servingUnit} IS NOT NULL AND ${table.servingUnit} IN ('g','ml','count','serving'))`),
  check('reference_json', sql`json_valid(${table.nutrientsJson})`), check('reference_source', sql`${table.provenance} IN ('reference','label','user_entered') AND ${table.estimated} IN (0,1)`),
]);
export const portionDefinitions = sqliteTable('portion_definitions', {
  ...ownedColumns(), foodId: text('food_id').references(() => foodDefinitions.id), label: text('label').notNull(), quantityDecimal: text('quantity_decimal').notNull(), unit: text('unit').notNull(),
  gramsDecimal: text('grams_decimal'), mlDecimal: text('ml_decimal'), gramsMilli: integer('grams_milli'), mlMilli: integer('ml_milli'), densityDecimal: text('density_decimal'), provenance: text('provenance').notNull(), estimated: integer('estimated', { mode: 'boolean' }).notNull(),
}, table => [uniqueIndex('portions_owner_id').on(table.ownerId, table.id),
  check('portion_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('portion_unit', sql`${table.unit} IN ('g','ml','count','serving')`),
  check('portion_density', sql`${table.densityDecimal} IS NULL OR ${table.foodId} IS NOT NULL`),
  check('portion_grams', sql`(${table.gramsDecimal} IS NULL AND ${table.gramsMilli} IS NULL) OR (${table.gramsDecimal} IS NOT NULL AND ${table.gramsMilli} IS NOT NULL AND typeof(${table.gramsMilli})='integer' AND ${table.gramsMilli} BETWEEN 0 AND 9007199254740991)`),
  check('portion_ml', sql`(${table.mlDecimal} IS NULL AND ${table.mlMilli} IS NULL) OR (${table.mlDecimal} IS NOT NULL AND ${table.mlMilli} IS NOT NULL AND typeof(${table.mlMilli})='integer' AND ${table.mlMilli} BETWEEN 0 AND 9007199254740991)`),
  check('portion_source', sql`${table.provenance}='user_entered' AND ${table.estimated} IN (0,1)`),
]);
export const personalRecipes = sqliteTable('personal_recipes', {
  ...ownedColumns(), title: text('title').notNull(), version: integer('version').notNull(), yieldServings: text('yield_servings'), yieldGramsDecimal: text('yield_grams_decimal'), yieldGramsMilli: integer('yield_grams_milli'), componentsJson: text('components_json').notNull(), nutrientSnapshotJson: text('nutrient_snapshot_json').notNull(),
}, table => [uniqueIndex('recipes_owner_id').on(table.ownerId, table.id),
  check('recipe_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991 AND ${table.version} BETWEEN 1 AND 9007199254740991`), check('recipe_yield', sql`${table.yieldServings} IS NOT NULL OR ${table.yieldGramsDecimal} IS NOT NULL`),
  check('recipe_grams', sql`(${table.yieldGramsDecimal} IS NULL AND ${table.yieldGramsMilli} IS NULL) OR (${table.yieldGramsDecimal} IS NOT NULL AND ${table.yieldGramsMilli} IS NOT NULL AND typeof(${table.yieldGramsMilli})='integer' AND ${table.yieldGramsMilli} BETWEEN 0 AND 9007199254740991)`),
  check('recipe_json', sql`json_valid(${table.componentsJson}) AND json_valid(${table.nutrientSnapshotJson})`),
]);
export const recipeVersions = sqliteTable('recipe_versions', {
  ownerId: text('owner_id').notNull(), recipeId: text('recipe_id').notNull(), version: integer('version').notNull(), snapshotJson: text('snapshot_json').notNull(), dataRevision: integer('data_revision').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.recipeId, table.version] }), foreignKey({ columns: [table.ownerId, table.recipeId], foreignColumns: [personalRecipes.ownerId, personalRecipes.id] }),
  check('recipe_version_bounds', sql`${table.version} BETWEEN 1 AND 9007199254740991 AND ${table.dataRevision} BETWEEN 1 AND 9007199254740991`), check('recipe_version_json', sql`json_valid(${table.snapshotJson})`),
]);
export const favorites = sqliteTable('favorites', {
  ...ownedColumns(), title: text('title').notNull(), version: integer('version').notNull(), snapshotJson: text('snapshot_json').notNull(),
}, table => [uniqueIndex('favorites_owner_id').on(table.ownerId, table.id), check('favorite_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991 AND ${table.version} BETWEEN 1 AND 9007199254740991`), check('favorite_json', sql`json_valid(${table.snapshotJson})`)]);
export const foodAliases = sqliteTable('food_aliases', {
  ...ownedColumns(), aliasOriginal: text('alias_original').notNull(), aliasNormalized: text('alias_normalized').notNull(), localeHint: text('locale_hint'), foodId: text('food_id').references(() => foodDefinitions.id), favoriteId: text('favorite_id'), confirmedAt: text('confirmed_at').notNull(),
}, table => [uniqueIndex('food_alias_owner_id').on(table.ownerId, table.id), index('food_alias_lookup').on(table.ownerId, table.aliasNormalized),
  foreignKey({ columns: [table.ownerId, table.favoriteId], foreignColumns: [favorites.ownerId, favorites.id] }), check('food_alias_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('food_alias_target', sql`(${table.foodId} IS NULL) <> (${table.favoriteId} IS NULL)`),
]);
export const meals = sqliteTable('meals', {
  ...ownedColumns(), localDate: text('local_date').notNull(), entryTimezone: text('entry_timezone').notNull(), occurredAt: text('occurred_at'), timePrecision: text('time_precision').notNull(),
  mealType: text('meal_type').notNull(), title: text('title'), sourceKind: text('source_kind').notNull(), sourceRef: text('source_ref'), confirmedAt: text('confirmed_at').notNull(),
}, table => [uniqueIndex('meals_owner_id').on(table.ownerId, table.id), index('meals_owner_date').on(table.ownerId, table.localDate), check('meal_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
  check('meal_precision', sql`(${table.timePrecision}='date' AND ${table.occurredAt} IS NULL) OR (${table.timePrecision}='instant' AND ${table.occurredAt} IS NOT NULL)`),
  check('meal_type', sql`${table.mealType} IN ('breakfast','lunch','dinner','snack','unspecified')`), check('meal_source', sql`${table.sourceKind} IN ('manual','assistant_explicit','imported_text','imported_image','photo','copied','system')`),
]);
export const mealItems = sqliteTable('meal_items', {
  ...ownedColumns(), mealId: text('meal_id').notNull(), ordinal: integer('ordinal').notNull(), snapshotJson: text('snapshot_json').notNull(),
}, table => [uniqueIndex('meal_items_owner_id').on(table.ownerId, table.id), uniqueIndex('meal_item_ordinal').on(table.ownerId, table.mealId, table.ordinal).where(sql`${table.deletedAt} IS NULL`),
  foreignKey({ columns: [table.ownerId, table.mealId], foreignColumns: [meals.ownerId, meals.id] }), check('meal_item_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991 AND ${table.ordinal} BETWEEN 1 AND 9007199254740991`), check('meal_item_json', sql`json_valid(${table.snapshotJson})`),
]);
export const sourceAssets = sqliteTable('source_assets', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), revision: integer('revision').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
  kind: text('kind').notNull(), objectKey: text('object_key').notNull(), mime: text('mime').notNull(), byteSize: integer('byte_size').notNull(), width: integer('width'), height: integer('height'), durationMs: integer('duration_ms'), sha256: text('sha256').notNull(), status: text('status').notNull(), lastUsedAt: text('last_used_at').notNull(), purgeAt: text('purge_at'),
}, table => [uniqueIndex('sources_owner_id').on(table.ownerId, table.id), uniqueIndex('sources_object_key').on(table.objectKey), index('sources_purge').on(table.purgeAt, table.status), index('sources_owner_hash').on(table.ownerId, table.sha256),
  check('source_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`), check('source_size', sql`typeof(${table.byteSize})='integer' AND ${table.byteSize} BETWEEN 1 AND 5000000`),
  check('source_media', sql`(${table.kind}='image' AND ${table.width} IS NOT NULL AND ${table.height} IS NOT NULL AND ${table.width}>0 AND ${table.height}>0 AND ${table.durationMs} IS NULL AND ${table.mime} IN ('image/jpeg','image/png','image/webp')) OR (${table.kind}='audio' AND ${table.width} IS NULL AND ${table.height} IS NULL AND ${table.durationMs} IS NOT NULL AND ${table.durationMs} BETWEEN 1 AND 60000 AND ${table.purgeAt} IS NOT NULL)`),
  check('source_status', sql`${table.status} IN ('uploading','ready','failed','deleted')`),
]);
export const importDrafts = sqliteTable('import_drafts', {
  ...ownedColumns(), kind: text('kind').notNull(), localDate: text('local_date').notNull(), entryTimezone: text('entry_timezone').notNull(), occurredAt: text('occurred_at'), timePrecision: text('time_precision').notNull(),
  mealType: text('meal_type').notNull(), title: text('title'), description: text('description').notNull(), sourceIdsJson: text('source_ids_json').notNull(), status: text('status').notNull(), confirmedMealId: text('confirmed_meal_id'), expiresAt: text('expires_at').notNull(),
}, table => [uniqueIndex('drafts_owner_id').on(table.ownerId, table.id), index('drafts_owner_date').on(table.ownerId, table.localDate, table.status),
  foreignKey({ columns: [table.ownerId, table.confirmedMealId], foreignColumns: [meals.ownerId, meals.id] }), check('draft_revision', sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
  check('draft_kind', sql`${table.kind}='meal'`), check('draft_status', sql`(${table.status} IN ('needs_input','review_ready') AND ${table.confirmedMealId} IS NULL) OR (${table.status}='confirmed' AND ${table.confirmedMealId} IS NOT NULL)`),
  check('draft_precision', sql`(${table.timePrecision}='date' AND ${table.occurredAt} IS NULL) OR (${table.timePrecision}='instant' AND ${table.occurredAt} IS NOT NULL)`), check('draft_json', sql`json_valid(${table.sourceIdsJson})`),
]);
