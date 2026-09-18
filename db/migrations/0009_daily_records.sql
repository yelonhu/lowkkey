PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `__new_workout_sessions` (
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
	CONSTRAINT "session_revision" CHECK("__new_workout_sessions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "session_status" CHECK("__new_workout_sessions"."status" IN ('draft','in_progress','paused','completed','recorded','cancelled','deleted')),
	CONSTRAINT "session_tombstone" CHECK(("__new_workout_sessions"."status"='deleted') = ("__new_workout_sessions"."deleted_at" IS NOT NULL)),
	CONSTRAINT "session_precision" CHECK(("__new_workout_sessions"."time_precision"='date' AND "__new_workout_sessions"."started_at" IS NULL AND "__new_workout_sessions"."ended_at" IS NULL) OR "__new_workout_sessions"."time_precision"='instant'),
	CONSTRAINT "session_time_order" CHECK("__new_workout_sessions"."started_at" IS NULL OR "__new_workout_sessions"."ended_at" IS NULL OR "__new_workout_sessions"."started_at"<="__new_workout_sessions"."ended_at"),
	CONSTRAINT "session_json" CHECK(("__new_workout_sessions"."plan_snapshot_json" IS NULL OR json_valid("__new_workout_sessions"."plan_snapshot_json")) AND ("__new_workout_sessions"."recovery_json" IS NULL OR json_valid("__new_workout_sessions"."recovery_json")))
);
--> statement-breakpoint
INSERT INTO __new_workout_sessions SELECT * FROM workout_sessions;
--> statement-breakpoint
DROP TABLE workout_sessions;
--> statement-breakpoint
ALTER TABLE __new_workout_sessions RENAME TO workout_sessions;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_owner_id` ON `workout_sessions` (`owner_id`,`id`);
--> statement-breakpoint
CREATE INDEX `sessions_owner_date` ON `workout_sessions` (`owner_id`,`local_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_session_in_progress` ON `workout_sessions` (`owner_id`) WHERE "workout_sessions"."status"='in_progress' AND "workout_sessions"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `one_actual_per_schedule` ON `workout_sessions` (`owner_id`,`scheduled_session_id`) WHERE "workout_sessions"."deleted_at" IS NULL AND "workout_sessions"."status"<>'cancelled';
--> statement-breakpoint
CREATE UNIQUE INDEX one_recorded_day ON workout_sessions(owner_id,local_date) WHERE status='recorded' AND deleted_at IS NULL;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
