-- Expand into versioned facts. Legacy reads remain possible during the release;
-- stop legacy writes before copying so the two representations cannot diverge.
CREATE TRIGGER v5_lock_sessions_insert BEFORE INSERT ON training_sessions BEGIN SELECT RAISE(ABORT,'v5_migration_retry'); END;
--> statement-breakpoint
CREATE TRIGGER v5_lock_sessions_update BEFORE UPDATE ON training_sessions BEGIN SELECT RAISE(ABORT,'v5_migration_retry'); END;
--> statement-breakpoint
CREATE TRIGGER v5_lock_weights_insert BEFORE INSERT ON weights BEGIN SELECT RAISE(ABORT,'v5_migration_retry'); END;
--> statement-breakpoint
CREATE TRIGGER v5_lock_weights_update BEFORE UPDATE ON weights BEGIN SELECT RAISE(ABORT,'v5_migration_retry'); END;
--> statement-breakpoint
CREATE TRIGGER v5_lock_plans_insert BEFORE INSERT ON plans BEGIN SELECT RAISE(ABORT,'v5_migration_retry'); END;
--> statement-breakpoint
CREATE TRIGGER v5_lock_plans_update BEFORE UPDATE ON plans BEGIN SELECT RAISE(ABORT,'v5_migration_retry'); END;
--> statement-breakpoint
CREATE TABLE showroom_sessions(owner_id TEXT NOT NULL REFERENCES users(id),date TEXT NOT NULL,title TEXT NOT NULL,note TEXT,sets_json TEXT NOT NULL CHECK(json_valid(sets_json)),updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,date));
--> statement-breakpoint
INSERT INTO showroom_sessions SELECT owner_id,date,'训练',NULL,COALESCE((SELECT json_group_array(json_object('ex',json_extract(value,'$.exerciseId'),'load',json_extract(value,'$.load'),'unit',json_extract(value,'$.unit'),'kind',json_extract(value,'$.loadKind'),'reps',json_extract(value,'$.reps'),'rir',json_extract(value,'$.rir'),'role',COALESCE(json_extract(value,'$.setRole'),'work'))) FROM json_each(training_sessions.sets_json)),'[]'),updated_at FROM training_sessions;
--> statement-breakpoint
CREATE TABLE showroom_weights(owner_id TEXT NOT NULL REFERENCES users(id),date TEXT NOT NULL,lb REAL NOT NULL CHECK(lb>0),updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,date));
--> statement-breakpoint
INSERT INTO showroom_weights SELECT * FROM weights;
--> statement-breakpoint
CREATE TABLE showroom_plans(owner_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),coach TEXT,items_json TEXT NOT NULL CHECK(json_valid(items_json)),updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,title),UNIQUE(owner_id,weekday));
--> statement-breakpoint
INSERT INTO showroom_plans SELECT owner_id,CASE day WHEN '肩（周五）' THEN '肩' WHEN '腿（周日）' THEN '腿' WHEN '背（周二）' THEN '背' WHEN '胸（周三）' THEN '胸' ELSE day END,CASE day WHEN '背' THEN 2 WHEN '胸' THEN 3 WHEN '肩' THEN 5 WHEN '腿' THEN 0 WHEN '肩（周五）' THEN 5 WHEN '腿（周日）' THEN 0 WHEN '背（周二）' THEN 2 WHEN '胸（周三）' THEN 3 ELSE -1 END,coach,COALESCE((SELECT json_group_array(json_object('ex',json_extract(value,'$.exerciseId'),'load',json_extract(value,'$.load'),'unit',json_extract(value,'$.unit'),'loadKind',json_extract(value,'$.loadKind'),'sets',json_extract(value,'$.sets'),'min',json_extract(value,'$.repMin'),'max',json_extract(value,'$.repMax'),'note',COALESCE(json_extract(value,'$.note'),''))) FROM json_each(plans.items_json)),'[]'),updated_at FROM plans WHERE json_array_length(items_json)>0;
--> statement-breakpoint
CREATE TABLE profiles(owner_id TEXT PRIMARY KEY REFERENCES users(id),body_notes TEXT,gain_target_json TEXT CHECK(gain_target_json IS NULL OR json_valid(gain_target_json)));
--> statement-breakpoint
INSERT INTO profiles SELECT u.id,(SELECT body FROM plans WHERE owner_id=u.id AND body_revision IS NOT NULL ORDER BY body_revision DESC LIMIT 1),(SELECT CASE WHEN gain_target_json IS NULL THEN NULL ELSE json_object('start',json_extract(gain_target_json,'$.start_date'),'startLb',json_extract(gain_target_json,'$.start_lb'),'min',json_extract(gain_target_json,'$.weekly_lb_min'),'max',json_extract(gain_target_json,'$.weekly_lb_max')) END FROM plans WHERE owner_id=u.id AND gain_target_revision IS NOT NULL ORDER BY gain_target_revision DESC LIMIT 1) FROM users u;
--> statement-breakpoint
CREATE TABLE preferences(owner_id TEXT PRIMARY KEY REFERENCES users(id),theme TEXT NOT NULL CHECK(theme IN ('ink','gold','pearl')),manual_week TEXT);
--> statement-breakpoint
CREATE TABLE curations(owner_id TEXT NOT NULL REFERENCES users(id),week TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),PRIMARY KEY(owner_id,week));
--> statement-breakpoint
CREATE TABLE curation_versions(owner_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,week TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),created_at TEXT NOT NULL,PRIMARY KEY(owner_id,revision));
--> statement-breakpoint
CREATE TABLE annotations(owner_id TEXT NOT NULL REFERENCES users(id),date TEXT NOT NULL,text TEXT NOT NULL,PRIMARY KEY(owner_id,date));
--> statement-breakpoint
CREATE TABLE plan_history(owner_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,effective_date TEXT NOT NULL,plans_json TEXT NOT NULL CHECK(json_valid(plans_json)),PRIMARY KEY(owner_id,revision));
--> statement-breakpoint
CREATE TABLE mutation_guard(owner_id TEXT PRIMARY KEY REFERENCES users(id),ok INTEGER NOT NULL CHECK(ok=1));
