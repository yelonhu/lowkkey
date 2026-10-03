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
--> statement-breakpoint
ALTER TABLE v1_clients ADD COLUMN grant_id TEXT;
