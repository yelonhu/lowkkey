CREATE TABLE users (id TEXT PRIMARY KEY, subject_key TEXT NOT NULL UNIQUE, email TEXT NOT NULL, data_revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE training_sessions (owner_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, raw_text TEXT NOT NULL, sets_json TEXT NOT NULL CHECK(json_valid(sets_json)), updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,date));
--> statement-breakpoint
CREATE TABLE weights (owner_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, lb REAL NOT NULL CHECK(lb>0), updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,date));
--> statement-breakpoint
CREATE TABLE plans (owner_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, items_json TEXT NOT NULL CHECK(json_valid(items_json)), coach TEXT, body TEXT, gain_target_json TEXT CHECK(gain_target_json IS NULL OR json_valid(gain_target_json)), body_revision INTEGER, gain_target_revision INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,day));
--> statement-breakpoint
CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), oauth_client_id TEXT NOT NULL, name TEXT NOT NULL, scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)), status TEXT NOT NULL CHECK(status IN ('active','revoked')), grant_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
--> statement-breakpoint
CREATE INDEX oauth_clients_owner ON oauth_clients(owner_id,status);
--> statement-breakpoint
create table "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
--> statement-breakpoint
create table "auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);
--> statement-breakpoint
create table "auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
--> statement-breakpoint
create table "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
--> statement-breakpoint
create table "auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
--> statement-breakpoint
create index "auth_session_userId_idx" on "auth_session" ("userId");
--> statement-breakpoint
create index "auth_account_userId_idx" on "auth_account" ("userId");
--> statement-breakpoint
create index "auth_verification_identifier_idx" on "auth_verification" ("identifier");
--> statement-breakpoint
CREATE TABLE auth_invites(email TEXT PRIMARY KEY, created_at TEXT NOT NULL, revoked_at TEXT);
--> statement-breakpoint
CREATE TABLE auth_owners(user_id TEXT PRIMARY KEY REFERENCES auth_user(id),owner_id TEXT NOT NULL UNIQUE REFERENCES users(id));
