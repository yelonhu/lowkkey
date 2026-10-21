CREATE TABLE contexts (
  owner_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  until TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, date)
);
