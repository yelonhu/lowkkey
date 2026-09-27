import type { D1Database } from '@cloudflare/workers-types';
import type { Identity } from './auth.ts';
import { subjectKey } from './auth.ts';

export class StoreError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

export async function accountFor(db: D1Database, identity: Identity): Promise<string> {
  const key = subjectKey(identity);
  await db.prepare('INSERT OR IGNORE INTO users(id,subject_key,email,created_at) VALUES (?,?,?,?)')
    .bind(crypto.randomUUID(), key, identity.email, new Date().toISOString()).run();
  const row = await db.prepare('SELECT id FROM users WHERE subject_key=?').bind(key).first<{ id: string }>();
  if (!row) throw new StoreError('ACCOUNT_UNAVAILABLE', 503);
  return row.id;
}
