CREATE TABLE `goal_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`goal_type` text NOT NULL,
	`effective_local_date` text NOT NULL,
	`energy_target_mkcal` integer,
	`protein_target_mg` integer,
	`carbs_target_mg` integer,
	`fat_target_mg` integer,
	`weight_min_kg_micros` integer,
	`weight_max_kg_micros` integer,
	`weekly_change_min_pct` real,
	`weekly_change_max_pct` real,
	`supersedes_id` text,
	`raw_input_json` text NOT NULL,
	`created_data_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`supersedes_id`) REFERENCES `goal_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_immutable_revision" CHECK("goal_versions"."revision"=1),
	CONSTRAINT "goal_type" CHECK("goal_versions"."goal_type" IN ('lean_bulk','fat_loss','maintenance')),
	CONSTRAINT "goal_data_revision" CHECK("goal_versions"."created_data_revision" >= 1 AND "goal_versions"."created_data_revision" <= 9007199254740991),
	CONSTRAINT "goal_energy" CHECK("goal_versions"."energy_target_mkcal" IS NULL OR ("goal_versions"."energy_target_mkcal">0 AND "goal_versions"."energy_target_mkcal"<=9007199254740991)),
	CONSTRAINT "goal_macros" CHECK(("goal_versions"."protein_target_mg" IS NULL OR "goal_versions"."protein_target_mg" BETWEEN 0 AND 9007199254740991) AND ("goal_versions"."carbs_target_mg" IS NULL OR "goal_versions"."carbs_target_mg" BETWEEN 0 AND 9007199254740991) AND ("goal_versions"."fat_target_mg" IS NULL OR "goal_versions"."fat_target_mg" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "goal_weight_band" CHECK(("goal_versions"."weight_min_kg_micros" IS NULL OR "goal_versions"."weight_min_kg_micros" BETWEEN 1000000 AND 500000000) AND ("goal_versions"."weight_max_kg_micros" IS NULL OR "goal_versions"."weight_max_kg_micros" BETWEEN 1000000 AND 500000000) AND ("goal_versions"."weight_min_kg_micros" IS NULL OR "goal_versions"."weight_max_kg_micros" IS NULL OR "goal_versions"."weight_min_kg_micros"<="goal_versions"."weight_max_kg_micros")),
	CONSTRAINT "goal_change_band" CHECK("goal_versions"."weekly_change_min_pct" IS NULL OR "goal_versions"."weekly_change_max_pct" IS NULL OR "goal_versions"."weekly_change_min_pct"<="goal_versions"."weekly_change_max_pct")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goals_owner_id` ON `goal_versions` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `goals_owner_effective` ON `goal_versions` (`owner_id`,`effective_local_date`,`created_data_revision`);--> statement-breakpoint
CREATE TABLE `membership_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "membership_singleton" CHECK("membership_state"."id"=1),
	CONSTRAINT "membership_revision" CHECK("membership_state"."revision" >= 1 AND "membership_state"."revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `revoked_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `revoked_session_expiry` ON `revoked_sessions` (`expires_at`);--> statement-breakpoint
-- Reviewed expansion: preserve existing identity rows and foreign keys.
ALTER TABLE `user_profiles` ADD `auto_memory_enabled` integer NOT NULL DEFAULT 1 CONSTRAINT `profiles_memory` CHECK (`auto_memory_enabled` IN (0,1));
--> statement-breakpoint
ALTER TABLE `users` ADD `membership_revision` integer NOT NULL DEFAULT 1 CONSTRAINT `users_membership_revision` CHECK (`membership_revision` >= 1 AND `membership_revision` <= 9007199254740991);
--> statement-breakpoint
INSERT INTO `membership_state` (`id`,`revision`) VALUES (1,1);
