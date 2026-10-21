import type { D1Database } from '@cloudflare/workers-types';
import { PRIVACY_VERSION, ConsentInput } from '@lowkkey/protocol';
import { StoreError } from './account.ts';

const cookieName = 'lowkkey_privacy';
const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export async function consentStatus(db: D1Database, owner: string) {
  const row = await db
    .prepare('SELECT accepted_at FROM privacy_consents WHERE owner_id=? AND version=?')
    .bind(owner, PRIVACY_VERSION)
    .first<{ accepted_at: string }>();
  return { version: PRIVACY_VERSION, acceptedAt: row?.accepted_at ?? null };
}
export async function requireConsent(db: D1Database, owner: string) {
  if (!(await consentStatus(db, owner)).acceptedAt) throw new StoreError('privacy_required', 403);
}
export async function acceptConsent(db: D1Database, owner: string, value: unknown) {
  ConsentInput.parse(value);
  await db
    .prepare("INSERT OR IGNORE INTO privacy_consents SELECT id,?,? FROM users WHERE id=? AND lifecycle='active'")
    .bind(PRIVACY_VERSION, new Date().toISOString(), owner)
    .run();
  return consentStatus(db, owner);
}
export async function createConsentIntent(db: D1Database, value: unknown, secure: boolean) {
  ConsentInput.parse(value);
  const token = crypto.randomUUID() + crypto.randomUUID(),
    now = new Date().toISOString();
  await db.batch([
    db.prepare('DELETE FROM privacy_intents WHERE expires_at<?').bind(now),
    db
      .prepare('INSERT INTO privacy_intents VALUES (?,?,?)')
      .bind(await digest(token), PRIVACY_VERSION, new Date(Date.now() + 15 * 60 * 1000).toISOString()),
  ]);
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure ? '; Secure' : ''}`;
}
// A one-use browser intent crosses the login redirect, then belongs only to its authenticated account.
export async function consumeConsentIntent(db: D1Database, request: Request, owner: string) {
  const token = request.headers
    .get('Cookie')
    ?.split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  if (!token || token.length > 100) return;
  const hash = await digest(token),
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO privacy_consents(owner_id,version,accepted_at) SELECT ?,version,? FROM privacy_intents WHERE token_hash=? AND version=? AND expires_at>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND lifecycle='active')",
      )
      .bind(owner, now, hash, PRIVACY_VERSION, now, owner),
    db.prepare('DELETE FROM privacy_intents WHERE token_hash=?').bind(hash),
  ]);
}
