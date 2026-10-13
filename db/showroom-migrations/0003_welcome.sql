ALTER TABLE profiles ADD COLUMN training_context TEXT;
--> statement-breakpoint
CREATE TABLE privacy_consents(owner_id TEXT NOT NULL REFERENCES users(id),version TEXT NOT NULL,accepted_at TEXT NOT NULL,PRIMARY KEY(owner_id,version));
--> statement-breakpoint
CREATE TABLE privacy_intents(token_hash TEXT PRIMARY KEY,version TEXT NOT NULL,expires_at TEXT NOT NULL);
--> statement-breakpoint
ALTER TABLE onboarding ADD COLUMN step TEXT NOT NULL DEFAULT 'choose' CHECK(step IN ('choose','guide','chat'));
--> statement-breakpoint
UPDATE onboarding SET step='guide' WHERE ai IS NOT NULL;
--> statement-breakpoint
ALTER TABLE onboarding ADD COLUMN connection_started_at TEXT;
