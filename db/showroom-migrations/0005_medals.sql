CREATE TABLE medals (
  owner_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  date TEXT,
  name TEXT NOT NULL,
  motif TEXT NOT NULL,
  unit TEXT,
  occasion TEXT,
  story_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, key)
);
