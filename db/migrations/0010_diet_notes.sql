-- Manual notes are durable facts; nutrition can remain unknown.
ALTER TABLE meals ADD COLUMN note_json TEXT CONSTRAINT meal_note_json CHECK (note_json IS NULL OR (json_valid(note_json) AND json_extract(note_json, '$.schemaVersion')=1));
--> statement-breakpoint
-- Revision zero denotes the legacy content present at migration time.
ALTER TABLE day_claims ADD COLUMN nutrition_content_revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT claim_content_revision CHECK (typeof(nutrition_content_revision)='integer' AND nutrition_content_revision BETWEEN 0 AND 9007199254740991);
