CREATE TABLE users (
  id TEXT PRIMARY KEY,
  subject_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  data_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('weight','set','revert')),
  local_date TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  raw_text TEXT,
  source_actor TEXT NOT NULL CHECK(source_actor IN ('user','claude','gpt','rule','other_model')),
  source_channel TEXT NOT NULL CHECK(source_channel IN ('text','photo','voice','mcp','ui')),
  parser TEXT NOT NULL CHECK(parser IN ('rule','model','none')),
  capture_id TEXT,
  reverts_id TEXT REFERENCES entries(id),
  created_at TEXT NOT NULL,
  CHECK((kind='revert') = (reverts_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX entries_owner_date ON entries(owner_id,local_date,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX entries_one_revert ON entries(owner_id,reverts_id) WHERE reverts_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ENTRY'); END;
--> statement-breakpoint
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ENTRY'); END;
--> statement-breakpoint
CREATE TABLE capture_batches (
  owner_id TEXT NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,id)
);
--> statement-breakpoint
CREATE TABLE held_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  capture_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK(gate IN ('G1','G2','G3','G4')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  question_json TEXT NOT NULL CHECK(json_valid(question_json)),
  status TEXT NOT NULL CHECK(status IN ('open','resolved','skipped')),
  answer TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
--> statement-breakpoint
CREATE INDEX held_owner_status ON held_items(owner_id,status,created_at);
--> statement-breakpoint
CREATE TABLE mutation_guards (
  owner_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  condition_ok INTEGER NOT NULL CHECK(condition_ok=1),
  PRIMARY KEY(owner_id,operation_id)
);
