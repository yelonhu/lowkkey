CREATE TABLE daily_notes (
  owner_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, date)
);
