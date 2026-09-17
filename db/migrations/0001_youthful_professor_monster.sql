CREATE TABLE `change_batches` (
	`owner_id` text NOT NULL,
	`data_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`source` text NOT NULL,
	`origin_thread_id` text,
	`changes_json` text NOT NULL,
	`events_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `data_revision`),
	FOREIGN KEY (`owner_id`,`operation_id`) REFERENCES `command_operations`(`owner_id`,`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "change_revision" CHECK("change_batches"."data_revision" >= 1 AND "change_batches"."data_revision" <= 9007199254740991),
	CONSTRAINT "change_source" CHECK("change_batches"."source" IN ('user','assistant','system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_batch_per_operation` ON `change_batches` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `command_operations` (
	`operation_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`kind` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`entry_point` text NOT NULL,
	`authorization_json` text NOT NULL,
	`target_refs_json` text NOT NULL,
	`response_json` text NOT NULL,
	`status` text DEFAULT 'committed' NOT NULL,
	`created_at` text NOT NULL,
	`undo_until` text,
	`undone_by` text,
	PRIMARY KEY(`owner_id`, `operation_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "operations_status" CHECK("command_operations"."status" = 'committed'),
	CONSTRAINT "operations_actor" CHECK("command_operations"."actor_kind" IN ('user','assistant','system'))
);
--> statement-breakpoint
CREATE INDEX `operations_owner_created` ON `command_operations` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mutation_guards` (
	`operation_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`condition_ok` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mutation_guard_passed" CHECK("mutation_guards"."condition_ok" = 1)
);
--> statement-breakpoint
CREATE TABLE `operation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`before_revision` integer,
	`after_revision` integer NOT NULL,
	`before_snapshot` text,
	`after_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`,`operation_id`) REFERENCES `command_operations`(`owner_id`,`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "operation_revision_step" CHECK("operation_revisions"."after_revision" >= 1 AND "operation_revisions"."after_revision" <= 9007199254740991 AND (("operation_revisions"."before_revision" IS NULL AND "operation_revisions"."after_revision"=1) OR "operation_revisions"."after_revision"="operation_revisions"."before_revision"+1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_entity_once` ON `operation_revisions` (`owner_id`,`operation_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `weight_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`local_date` text NOT NULL,
	`entry_timezone` text NOT NULL,
	`occurred_at` text,
	`time_precision` text NOT NULL,
	`value_decimal` text NOT NULL,
	`unit` text NOT NULL,
	`kg_micros` integer NOT NULL,
	`condition` text NOT NULL,
	`is_primary` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "weight_revision" CHECK("weight_entries"."revision" >= 1 AND "weight_entries"."revision" <= 9007199254740991),
	CONSTRAINT "weight_kg" CHECK("weight_entries"."kg_micros" BETWEEN 1000000 AND 500000000),
	CONSTRAINT "weight_unit" CHECK("weight_entries"."unit" IN ('kg','lb')),
	CONSTRAINT "weight_condition" CHECK("weight_entries"."condition" IN ('fasted','other','unspecified')),
	CONSTRAINT "weight_primary_bool" CHECK("weight_entries"."is_primary" IN (0,1)),
	CONSTRAINT "weight_precision" CHECK(("weight_entries"."time_precision"='date' AND "weight_entries"."occurred_at" IS NULL) OR ("weight_entries"."time_precision"='instant' AND "weight_entries"."occurred_at" IS NOT NULL)),
	CONSTRAINT "weight_source" CHECK("weight_entries"."source_kind" IN ('manual','assistant_explicit','imported_text','imported_image','photo','copied','system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weights_owner_id` ON `weight_entries` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `weights_owner_date` ON `weight_entries` (`owner_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `weights_primary_day` ON `weight_entries` (`owner_id`,`local_date`) WHERE "weight_entries"."is_primary"=1 AND "weight_entries"."deleted_at" IS NULL;