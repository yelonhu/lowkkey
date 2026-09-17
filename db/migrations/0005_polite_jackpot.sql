CREATE TABLE `favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`title` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "favorite_revision" CHECK("favorites"."revision" BETWEEN 1 AND 9007199254740991 AND "favorites"."version" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "favorite_json" CHECK(json_valid("favorites"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_owner_id` ON `favorites` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `food_aliases` (
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
	`food_id` text,
	`favorite_id` text,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_id`) REFERENCES `food_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`favorite_id`) REFERENCES `favorites`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_alias_revision" CHECK("food_aliases"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "food_alias_target" CHECK(("food_aliases"."food_id" IS NULL) <> ("food_aliases"."favorite_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_alias_owner_id` ON `food_aliases` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `food_alias_lookup` ON `food_aliases` (`owner_id`,`alias_normalized`);--> statement-breakpoint
CREATE TABLE `food_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`scope` text NOT NULL,
	`catalog_version` text NOT NULL,
	`kind` text NOT NULL,
	`reference_state` text NOT NULL,
	`preparation` text,
	`cut_or_part` text,
	`brand` text,
	`status` text NOT NULL,
	`personal_name` text,
	`personal_locale` text,
	`operation_id` text,
	`created_operation_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_ownership" CHECK(("food_definitions"."scope"='system' AND "food_definitions"."owner_id" IS NULL AND "food_definitions"."personal_name" IS NULL AND "food_definitions"."personal_locale" IS NULL) OR ("food_definitions"."scope"='personal' AND "food_definitions"."owner_id" IS NOT NULL AND "food_definitions"."personal_name" IS NOT NULL AND "food_definitions"."personal_locale" IN ('zh-Hans','zh-Hant','en') AND "food_definitions"."operation_id" IS NOT NULL AND "food_definitions"."created_operation_id" IS NOT NULL)),
	CONSTRAINT "food_status" CHECK("food_definitions"."status" IN ('active','archived')),
	CONSTRAINT "food_revision" CHECK("food_definitions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "food_state" CHECK("food_definitions"."reference_state" IN ('raw','cooked','as_packaged','unknown')),
	CONSTRAINT "food_kind" CHECK("food_definitions"."kind" IN ('basic_food','personal_recipe','packaged_food','composite_meal','manual_total'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `foods_owner_id` ON `food_definitions` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `foods_scope_owner` ON `food_definitions` (`scope`,`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `food_labels` (
	`food_id` text NOT NULL,
	`locale` text NOT NULL,
	`display_name` text NOT NULL,
	`search_terms` text NOT NULL,
	PRIMARY KEY(`food_id`, `locale`),
	FOREIGN KEY (`food_id`) REFERENCES `food_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_label_locale" CHECK("food_labels"."locale" IN ('zh-Hans','zh-Hant','en'))
);
--> statement-breakpoint
CREATE TABLE `import_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`local_date` text NOT NULL,
	`entry_timezone` text NOT NULL,
	`occurred_at` text,
	`time_precision` text NOT NULL,
	`meal_type` text NOT NULL,
	`title` text,
	`description` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`confirmed_meal_id` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`confirmed_meal_id`) REFERENCES `meals`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "draft_revision" CHECK("import_drafts"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "draft_kind" CHECK("import_drafts"."kind"='meal'),
	CONSTRAINT "draft_status" CHECK(("import_drafts"."status" IN ('needs_input','review_ready') AND "import_drafts"."confirmed_meal_id" IS NULL) OR ("import_drafts"."status"='confirmed' AND "import_drafts"."confirmed_meal_id" IS NOT NULL)),
	CONSTRAINT "draft_precision" CHECK(("import_drafts"."time_precision"='date' AND "import_drafts"."occurred_at" IS NULL) OR ("import_drafts"."time_precision"='instant' AND "import_drafts"."occurred_at" IS NOT NULL)),
	CONSTRAINT "draft_json" CHECK(json_valid("import_drafts"."source_ids_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_owner_id` ON `import_drafts` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `drafts_owner_date` ON `import_drafts` (`owner_id`,`local_date`,`status`);--> statement-breakpoint
CREATE TABLE `meal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`meal_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`meal_id`) REFERENCES `meals`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meal_item_revision" CHECK("meal_items"."revision" BETWEEN 1 AND 9007199254740991 AND "meal_items"."ordinal" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "meal_item_json" CHECK(json_valid("meal_items"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_items_owner_id` ON `meal_items` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `meal_item_ordinal` ON `meal_items` (`owner_id`,`meal_id`,`ordinal`) WHERE "meal_items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `meals` (
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
	`occurred_at` text,
	`time_precision` text NOT NULL,
	`meal_type` text NOT NULL,
	`title` text,
	`source_kind` text NOT NULL,
	`source_ref` text,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meal_revision" CHECK("meals"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "meal_precision" CHECK(("meals"."time_precision"='date' AND "meals"."occurred_at" IS NULL) OR ("meals"."time_precision"='instant' AND "meals"."occurred_at" IS NOT NULL)),
	CONSTRAINT "meal_type" CHECK("meals"."meal_type" IN ('breakfast','lunch','dinner','snack','unspecified')),
	CONSTRAINT "meal_source" CHECK("meals"."source_kind" IN ('manual','assistant_explicit','imported_text','imported_image','photo','copied','system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meals_owner_id` ON `meals` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `meals_owner_date` ON `meals` (`owner_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `nutrition_references` (
	`id` text PRIMARY KEY NOT NULL,
	`food_id` text NOT NULL,
	`basis` text NOT NULL,
	`serving_quantity` text,
	`serving_unit` text,
	`nutrients_json` text NOT NULL,
	`source_name` text NOT NULL,
	`source_entry_id` text,
	`source_url` text,
	`source_version` text NOT NULL,
	`provenance` text NOT NULL,
	`estimated` integer NOT NULL,
	`retrieved_at` text NOT NULL,
	FOREIGN KEY (`food_id`) REFERENCES `food_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reference_basis" CHECK(("nutrition_references"."basis" IN ('per_100g','per_100ml') AND "nutrition_references"."serving_quantity" IS NULL AND "nutrition_references"."serving_unit" IS NULL) OR ("nutrition_references"."basis"='per_serving' AND "nutrition_references"."serving_quantity" IS NOT NULL AND "nutrition_references"."serving_unit" IS NOT NULL AND "nutrition_references"."serving_unit" IN ('g','ml','count','serving'))),
	CONSTRAINT "reference_json" CHECK(json_valid("nutrition_references"."nutrients_json")),
	CONSTRAINT "reference_source" CHECK("nutrition_references"."provenance" IN ('reference','label','user_entered') AND "nutrition_references"."estimated" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `references_food` ON `nutrition_references` (`food_id`);--> statement-breakpoint
CREATE TABLE `personal_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`title` text NOT NULL,
	`version` integer NOT NULL,
	`yield_servings` text,
	`yield_grams_decimal` text,
	`yield_grams_milli` integer,
	`components_json` text NOT NULL,
	`nutrient_snapshot_json` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_revision" CHECK("personal_recipes"."revision" BETWEEN 1 AND 9007199254740991 AND "personal_recipes"."version" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "recipe_yield" CHECK("personal_recipes"."yield_servings" IS NOT NULL OR "personal_recipes"."yield_grams_decimal" IS NOT NULL),
	CONSTRAINT "recipe_grams" CHECK(("personal_recipes"."yield_grams_decimal" IS NULL AND "personal_recipes"."yield_grams_milli" IS NULL) OR ("personal_recipes"."yield_grams_decimal" IS NOT NULL AND "personal_recipes"."yield_grams_milli" IS NOT NULL AND typeof("personal_recipes"."yield_grams_milli")='integer' AND "personal_recipes"."yield_grams_milli" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "recipe_json" CHECK(json_valid("personal_recipes"."components_json") AND json_valid("personal_recipes"."nutrient_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_owner_id` ON `personal_recipes` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `portion_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`operation_id` text NOT NULL,
	`created_operation_id` text NOT NULL,
	`food_id` text,
	`label` text NOT NULL,
	`quantity_decimal` text NOT NULL,
	`unit` text NOT NULL,
	`grams_decimal` text,
	`ml_decimal` text,
	`grams_milli` integer,
	`ml_milli` integer,
	`density_decimal` text,
	`provenance` text NOT NULL,
	`estimated` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_id`) REFERENCES `food_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "portion_revision" CHECK("portion_definitions"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "portion_unit" CHECK("portion_definitions"."unit" IN ('g','ml','count','serving')),
	CONSTRAINT "portion_density" CHECK("portion_definitions"."density_decimal" IS NULL OR "portion_definitions"."food_id" IS NOT NULL),
	CONSTRAINT "portion_grams" CHECK(("portion_definitions"."grams_decimal" IS NULL AND "portion_definitions"."grams_milli" IS NULL) OR ("portion_definitions"."grams_decimal" IS NOT NULL AND "portion_definitions"."grams_milli" IS NOT NULL AND typeof("portion_definitions"."grams_milli")='integer' AND "portion_definitions"."grams_milli" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "portion_ml" CHECK(("portion_definitions"."ml_decimal" IS NULL AND "portion_definitions"."ml_milli" IS NULL) OR ("portion_definitions"."ml_decimal" IS NOT NULL AND "portion_definitions"."ml_milli" IS NOT NULL AND typeof("portion_definitions"."ml_milli")='integer' AND "portion_definitions"."ml_milli" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "portion_source" CHECK("portion_definitions"."provenance"='user_entered' AND "portion_definitions"."estimated" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portions_owner_id` ON `portion_definitions` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `recipe_versions` (
	`owner_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`data_revision` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `recipe_id`, `version`),
	FOREIGN KEY (`owner_id`,`recipe_id`) REFERENCES `personal_recipes`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_version_bounds" CHECK("recipe_versions"."version" BETWEEN 1 AND 9007199254740991 AND "recipe_versions"."data_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "recipe_version_json" CHECK(json_valid("recipe_versions"."snapshot_json"))
);
--> statement-breakpoint
CREATE TABLE `source_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`sha256` text NOT NULL,
	`status` text NOT NULL,
	`last_used_at` text NOT NULL,
	`purge_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_revision" CHECK("source_assets"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "source_size" CHECK(typeof("source_assets"."byte_size")='integer' AND "source_assets"."byte_size" BETWEEN 1 AND 5000000),
	CONSTRAINT "source_media" CHECK(("source_assets"."kind"='image' AND "source_assets"."width" IS NOT NULL AND "source_assets"."height" IS NOT NULL AND "source_assets"."width">0 AND "source_assets"."height">0 AND "source_assets"."duration_ms" IS NULL AND "source_assets"."mime" IN ('image/jpeg','image/png','image/webp')) OR ("source_assets"."kind"='audio' AND "source_assets"."width" IS NULL AND "source_assets"."height" IS NULL AND "source_assets"."duration_ms" IS NOT NULL AND "source_assets"."duration_ms" BETWEEN 1 AND 60000 AND "source_assets"."purge_at" IS NOT NULL)),
	CONSTRAINT "source_status" CHECK("source_assets"."status" IN ('uploading','ready','failed','deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_owner_id` ON `source_assets` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sources_object_key` ON `source_assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `sources_purge` ON `source_assets` (`purge_at`,`status`);--> statement-breakpoint
CREATE INDEX `sources_owner_hash` ON `source_assets` (`owner_id`,`sha256`);