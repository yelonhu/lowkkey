ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Chicago';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN timezone_initialized INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE users SET timezone_initialized=1;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','deleting'));
--> statement-breakpoint
ALTER TABLE oauth_clients ADD COLUMN first_read_at TEXT;
--> statement-breakpoint
ALTER TABLE oauth_clients ADD COLUMN first_write_at TEXT;
--> statement-breakpoint
CREATE TABLE onboarding(owner_id TEXT PRIMARY KEY REFERENCES users(id),ai TEXT CHECK(ai IN ('claude','chatgpt')),entry TEXT CHECK(entry IN ('start','existing')),skipped_at TEXT,completed_at TEXT,first_view_url TEXT);
--> statement-breakpoint
CREATE TABLE product_events(owner_id TEXT NOT NULL REFERENCES users(id),event TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(owner_id,event,code));
--> statement-breakpoint
CREATE TABLE account_deletions(owner_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,requested_at TEXT NOT NULL);
