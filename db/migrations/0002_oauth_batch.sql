ALTER TABLE v1_submissions ADD COLUMN base_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE v1_clients ADD COLUMN oauth_client_id TEXT;
--> statement-breakpoint
CREATE INDEX v1_clients_oauth ON v1_clients(owner_id,oauth_client_id,status);
