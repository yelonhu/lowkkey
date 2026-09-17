CREATE TABLE `day_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`local_date` text NOT NULL,
	`entry_timezone` text NOT NULL,
	`training_claim` text NOT NULL,
	`nutrition_completeness` text NOT NULL,
	`nutrition_reviewed_at` text,
	`review_invalidated_reason` text,
	`explicit_zero_intake` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "claim_revision" CHECK("day_claims"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "training_claim" CHECK("day_claims"."training_claim" IN ('unspecified','rest_confirmed')),
	CONSTRAINT "nutrition_claim" CHECK("day_claims"."nutrition_completeness" IN ('unreviewed','partial','complete') AND "day_claims"."explicit_zero_intake" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_owner_id` ON `day_claims` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `claims_owner_date` ON `day_claims` (`owner_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `exercise_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`alias_original` text NOT NULL,
	`alias_normalized` text NOT NULL,
	`locale_hint` text,
	`exercise_id` text NOT NULL,
	`context_json` text,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "alias_revision" CHECK("exercise_aliases"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "alias_json" CHECK("exercise_aliases"."context_json" IS NULL OR json_valid("exercise_aliases"."context_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_alias_owner_id` ON `exercise_aliases` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `exercise_alias_lookup` ON `exercise_aliases` (`owner_id`,`alias_normalized`);--> statement-breakpoint
CREATE TABLE `exercise_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`scope` text NOT NULL,
	`catalog_version` text NOT NULL,
	`family_id` text NOT NULL,
	`parent_exercise_id` text,
	`equipment_type` text NOT NULL,
	`variant_json` text NOT NULL,
	`muscle_groups_json` text NOT NULL,
	`status` text NOT NULL,
	`personal_name` text,
	`personal_locale` text,
	`operation_id` text,
	`created_operation_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_exercise_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercise_ownership" CHECK(("exercise_definitions"."scope"='system' AND "exercise_definitions"."owner_id" IS NULL AND "exercise_definitions"."personal_name" IS NULL AND "exercise_definitions"."personal_locale" IS NULL) OR ("exercise_definitions"."scope"='personal' AND "exercise_definitions"."owner_id" IS NOT NULL AND "exercise_definitions"."personal_name" IS NOT NULL AND "exercise_definitions"."personal_locale" IN ('zh-Hans','zh-Hant','en') AND "exercise_definitions"."operation_id" IS NOT NULL AND "exercise_definitions"."created_operation_id" IS NOT NULL)),
	CONSTRAINT "exercise_status" CHECK("exercise_definitions"."status" IN ('active','archived')),
	CONSTRAINT "exercise_revision" CHECK("exercise_definitions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "exercise_json" CHECK(json_valid("exercise_definitions"."variant_json") AND json_valid("exercise_definitions"."muscle_groups_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_owner_id` ON `exercise_definitions` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `exercises_scope_owner` ON `exercise_definitions` (`scope`,`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `exercise_labels` (
	`exercise_id` text NOT NULL,
	`locale` text NOT NULL,
	`display_name` text NOT NULL,
	`search_terms` text NOT NULL,
	PRIMARY KEY(`exercise_id`, `locale`),
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercise_label_locale" CHECK("exercise_labels"."locale" IN ('zh-Hans','zh-Hant','en'))
);
--> statement-breakpoint
CREATE TABLE `exercise_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`equipment_instance` text,
	`load_semantics` text NOT NULL,
	`load_unit` text NOT NULL,
	`includes_bar` integer,
	`bar_weight_decimal` text,
	`bar_unit` text,
	`increment_decimal` text,
	`increment_unit` text,
	`available_loads_json` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "setup_revision" CHECK("exercise_setups"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "setup_unit" CHECK("exercise_setups"."load_unit" IN ('kg','lb')),
	CONSTRAINT "setup_semantics" CHECK("exercise_setups"."load_semantics" IN ('external_total','per_side','added_weight','assistance','bodyweight_only','unspecified')),
	CONSTRAINT "setup_bar" CHECK(("exercise_setups"."bar_weight_decimal" IS NULL AND "exercise_setups"."bar_unit" IS NULL) OR ("exercise_setups"."bar_weight_decimal" IS NOT NULL AND "exercise_setups"."bar_unit" IN ('kg','lb'))),
	CONSTRAINT "setup_increment" CHECK(("exercise_setups"."increment_decimal" IS NULL AND "exercise_setups"."increment_unit" IS NULL) OR ("exercise_setups"."increment_decimal" IS NOT NULL AND "exercise_setups"."increment_unit" IN ('kg','lb'))),
	CONSTRAINT "setup_bool" CHECK("exercise_setups"."includes_bar" IS NULL OR "exercise_setups"."includes_bar" IN (0,1)),
	CONSTRAINT "setup_json" CHECK("exercise_setups"."available_loads_json" IS NULL OR json_valid("exercise_setups"."available_loads_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setups_owner_id` ON `exercise_setups` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `setups_owner_exercise` ON `exercise_setups` (`owner_id`,`exercise_id`);--> statement-breakpoint
CREATE TABLE `plan_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`plan_version_id` text,
	`effective_local_date` text NOT NULL,
	`data_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`plan_version_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_selection_revision" CHECK("plan_selections"."data_revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `plan_selection_effective` ON `plan_selections` (`owner_id`,`effective_local_date`,`data_revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_selection_operation` ON `plan_selections` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`title` text NOT NULL,
	`effective_local_date` text NOT NULL,
	`status` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`supersedes_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`supersedes_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_revision" CHECK("plan_versions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "plan_status" CHECK("plan_versions"."status" IN ('draft','published','archived')),
	CONSTRAINT "plan_json" CHECK(json_valid("plan_versions"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_owner_id` ON `plan_versions` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `plans_owner_date` ON `plan_versions` (`owner_id`,`effective_local_date`);--> statement-breakpoint
CREATE TABLE `scheduled_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`local_date` text NOT NULL,
	`entry_timezone` text NOT NULL,
	`plan_version_id` text,
	`template_id` text,
	`planned_start_local` text,
	`status` text NOT NULL,
	`moved_from_id` text,
	`override_snapshot_json` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`plan_version_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`moved_from_id`) REFERENCES `scheduled_sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_revision" CHECK("scheduled_sessions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "schedule_status" CHECK("scheduled_sessions"."status" IN ('planned','skipped','moved','cancelled')),
	CONSTRAINT "schedule_source" CHECK(("scheduled_sessions"."plan_version_id" IS NULL) = ("scheduled_sessions"."template_id" IS NULL)),
	CONSTRAINT "schedule_json" CHECK("scheduled_sessions"."override_snapshot_json" IS NULL OR json_valid("scheduled_sessions"."override_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_owner_id` ON `scheduled_sessions` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `schedules_owner_date` ON `scheduled_sessions` (`owner_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `session_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`setup_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`display_snapshot_json` text NOT NULL,
	`target_snapshot_json` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `workout_sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`setup_id`) REFERENCES `exercise_setups`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_exercise_revision" CHECK("session_exercises"."revision" BETWEEN 1 AND 9007199254740991 AND "session_exercises"."ordinal" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "session_exercise_json" CHECK(json_valid("session_exercises"."display_snapshot_json") AND ("session_exercises"."target_snapshot_json" IS NULL OR json_valid("session_exercises"."target_snapshot_json")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_exercises_owner_id` ON `session_exercises` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_ordinal` ON `session_exercises` (`owner_id`,`session_id`,`ordinal`) WHERE "session_exercises"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `exercise_history_lookup` ON `session_exercises` (`owner_id`,`setup_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`local_date` text NOT NULL,
	`entry_timezone` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`time_precision` text NOT NULL,
	`status` text NOT NULL,
	`plan_version_id` text,
	`scheduled_session_id` text,
	`plan_snapshot_json` text,
	`title` text,
	`note` text,
	`recovery_json` text,
	`source_ref` text,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`plan_version_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`scheduled_session_id`) REFERENCES `scheduled_sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_revision" CHECK("workout_sessions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "session_status" CHECK("workout_sessions"."status" IN ('draft','in_progress','paused','completed','cancelled','deleted')),
	CONSTRAINT "session_tombstone" CHECK(("workout_sessions"."status"='deleted') = ("workout_sessions"."deleted_at" IS NOT NULL)),
	CONSTRAINT "session_precision" CHECK(("workout_sessions"."time_precision"='date' AND "workout_sessions"."started_at" IS NULL AND "workout_sessions"."ended_at" IS NULL) OR "workout_sessions"."time_precision"='instant'),
	CONSTRAINT "session_time_order" CHECK("workout_sessions"."started_at" IS NULL OR "workout_sessions"."ended_at" IS NULL OR "workout_sessions"."started_at"<="workout_sessions"."ended_at"),
	CONSTRAINT "session_json" CHECK(("workout_sessions"."plan_snapshot_json" IS NULL OR json_valid("workout_sessions"."plan_snapshot_json")) AND ("workout_sessions"."recovery_json" IS NULL OR json_valid("workout_sessions"."recovery_json")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_owner_id` ON `workout_sessions` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `sessions_owner_date` ON `workout_sessions` (`owner_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_session_in_progress` ON `workout_sessions` (`owner_id`) WHERE "workout_sessions"."status"='in_progress' AND "workout_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `one_actual_per_schedule` ON `workout_sessions` (`owner_id`,`scheduled_session_id`) WHERE "workout_sessions"."deleted_at" IS NULL AND "workout_sessions"."status"<>'cancelled';--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`session_exercise_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`reps` integer NOT NULL,
	`load_decimal` text,
	`unit` text,
	`kg_micros` integer,
	`load_semantics` text NOT NULL,
	`set_type` text NOT NULL,
	`rpe_half_units` integer,
	`completed_at` text,
	`note` text,
	`source_row_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`session_exercise_id`) REFERENCES `session_exercises`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "set_revision" CHECK("workout_sets"."revision" BETWEEN 1 AND 9007199254740991 AND "workout_sets"."ordinal" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "set_reps" CHECK("workout_sets"."reps" BETWEEN 1 AND 200),
	CONSTRAINT "set_rpe" CHECK("workout_sets"."rpe_half_units" IS NULL OR "workout_sets"."rpe_half_units" BETWEEN 2 AND 20),
	CONSTRAINT "set_type" CHECK("workout_sets"."set_type" IN ('warmup','work','backoff','drop','unknown')),
	CONSTRAINT "set_load" CHECK(("workout_sets"."load_semantics"='bodyweight_only' AND "workout_sets"."load_decimal" IS NULL AND "workout_sets"."unit" IS NULL AND "workout_sets"."kg_micros" IS NULL) OR ("workout_sets"."load_semantics" IN ('external_total','per_side','added_weight','assistance','unspecified') AND "workout_sets"."load_decimal" IS NOT NULL AND "workout_sets"."unit" IS NOT NULL AND "workout_sets"."kg_micros" IS NOT NULL AND typeof("workout_sets"."kg_micros")='integer' AND "workout_sets"."unit" IN ('kg','lb') AND "workout_sets"."kg_micros" BETWEEN 0 AND 1000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sets_owner_id` ON `workout_sets` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `set_ordinal` ON `workout_sets` (`owner_id`,`session_exercise_id`,`ordinal`) WHERE "workout_sets"."deleted_at" IS NULL;
