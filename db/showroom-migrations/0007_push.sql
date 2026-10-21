CREATE TABLE push_subscriptions (
  owner_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, endpoint)
);
--> statement-breakpoint
CREATE TABLE push_sends (
  owner_id TEXT NOT NULL REFERENCES users(id),
  sent_at TEXT NOT NULL,
  kind TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX push_sends_owner ON push_sends(owner_id, sent_at);
