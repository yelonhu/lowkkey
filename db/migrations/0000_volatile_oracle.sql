CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email_normalized` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`accepted_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_status" CHECK("invitations"."status" IN ('invited','accepted','expired','revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_pending_email` ON `invitations` (`email_normalized`) WHERE "invitations"."status" = 'invited';--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`display_name` text NOT NULL,
	`body_weight_unit` text DEFAULT 'kg' NOT NULL,
	`default_load_unit` text DEFAULT 'kg' NOT NULL,
	`training_experience` text DEFAULT 'unknown' NOT NULL,
	`height_cm` integer,
	`constraints_text` text,
	`digest_enabled` integer DEFAULT true NOT NULL,
	`next_digest_at` text NOT NULL,
	`pending_timezone` text,
	`timezone_effective_date` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "profiles_revision" CHECK("user_profiles"."revision" >= 1 AND "user_profiles"."revision" <= 9007199254740991),
	CONSTRAINT "profiles_units" CHECK("user_profiles"."body_weight_unit" IN ('kg','lb') AND "user_profiles"."default_load_unit" IN ('kg','lb')),
	CONSTRAINT "profiles_experience" CHECK("user_profiles"."training_experience" IN ('beginner','intermediate','experienced','unknown')),
	CONSTRAINT "profiles_display_name" CHECK(length("user_profiles"."display_name") BETWEEN 1 AND 40),
	CONSTRAINT "profiles_height" CHECK("user_profiles"."height_cm" IS NULL OR "user_profiles"."height_cm" BETWEEN 50 AND 250),
	CONSTRAINT "profiles_constraints" CHECK("user_profiles"."constraints_text" IS NULL OR length("user_profiles"."constraints_text") <= 2000),
	CONSTRAINT "profiles_digest" CHECK("user_profiles"."digest_enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_owner_unique` ON `user_profiles` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_owner_id_unique` ON `user_profiles` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`verified_subject` text,
	`email_normalized` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`locale` text NOT NULL,
	`timezone` text NOT NULL,
	`data_revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`suspended_at` text,
	CONSTRAINT "users_role" CHECK("users"."role" IN ('member','admin')),
	CONSTRAINT "users_status" CHECK("users"."status" IN ('invited','active','suspended','deletion_pending','deleted')),
	CONSTRAINT "users_locale" CHECK("users"."locale" IN ('zh-Hans','zh-Hant','en')),
	CONSTRAINT "users_revision" CHECK("users"."data_revision" >= 0 AND "users"."data_revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_subject_unique` ON `users` (`verified_subject`);