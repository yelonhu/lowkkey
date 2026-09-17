-- Preserve whether setup metadata came from catalog defaults or explicit edits.
ALTER TABLE exercise_setups ADD COLUMN defaults_origin_json TEXT CHECK (defaults_origin_json IS NULL OR json_valid(defaults_origin_json));
