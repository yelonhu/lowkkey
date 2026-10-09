-- Only BEFORE deploying the v5 Worker, while all live writes still use v4.
-- Legacy facts remain untouched. Dropping v5 clones is safe only in this phase.
DROP TABLE showroom_sessions;
DROP TABLE showroom_weights;
DROP TABLE showroom_plans;
DROP TABLE profiles;
DROP TABLE preferences;
DROP TABLE curations;
DROP TABLE curation_versions;
DROP TABLE annotations;
DROP TABLE plan_history;
DROP TABLE mutation_guard;
DROP TRIGGER v5_lock_sessions_insert;
DROP TRIGGER v5_lock_sessions_update;
DROP TRIGGER v5_lock_weights_insert;
DROP TRIGGER v5_lock_weights_update;
DROP TRIGGER v5_lock_plans_insert;
DROP TRIGGER v5_lock_plans_update;
DELETE FROM d1_migrations WHERE name='0001_v5.sql';
