-- The original entries table remains untouched for lossless compatibility.
-- New writes use this append-only ledger and read models merge both histories.
CREATE TABLE v1_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  local_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  entry_json TEXT NOT NULL CHECK(json_valid(entry_json)),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX v1_entries_owner_date ON v1_entries(owner_id,local_date,created_at);
--> statement-breakpoint
CREATE TRIGGER v1_entries_no_update BEFORE UPDATE ON v1_entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ENTRY'); END;
--> statement-breakpoint
CREATE TRIGGER v1_entries_no_delete BEFORE DELETE ON v1_entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ENTRY'); END;
--> statement-breakpoint
CREATE TABLE v1_state (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE v1_submissions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  drafts_json TEXT NOT NULL CHECK(json_valid(drafts_json)),
  captured_at TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','skipped')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
--> statement-breakpoint
CREATE INDEX v1_submissions_owner_status ON v1_submissions(owner_id,status,created_at);
--> statement-breakpoint
CREATE TABLE v1_operations (
  owner_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,client_id,operation,idempotency_key)
);
--> statement-breakpoint
CREATE TABLE v1_clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  token_hash TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
--> statement-breakpoint
CREATE INDEX v1_clients_owner ON v1_clients(owner_id,status);
--> statement-breakpoint
CREATE TABLE v1_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL REFERENCES users(id),
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX v1_events_owner_id ON v1_events(owner_id,id);
