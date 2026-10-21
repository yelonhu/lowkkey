import type { D1Database } from '@cloudflare/workers-types';
import { importJWK, SignJWT, type JWK } from 'jose';
import { PushSubscriptionInput, type PushStatus } from '@lowkkey/protocol';
import { StoreError } from './account.ts';

/**
 * 信到了。The AI writes a letter or a medal lands, and the pod, even closed, says so once.
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291/8188),
 * all on WebCrypto so it runs inside the worker. Quiet by rule: one notice per ten minutes,
 * three per week, and only for a letter or a medal.
 */
export type PushEnv = { VAPID_PRIVATE_JWK?: string; PRIVACY_CONTACT_EMAIL?: string; APP_ORIGIN?: string };
export type Notice = { kind: 'letter' | 'medal'; title: string; body: string; url: string };
export const WEEKLY_LIMIT = 3,
  QUIET_MINUTES = 10;

const encoder = new TextEncoder();
export const b64u = {
  encode: (bytes: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
  decode: (text: string) =>
    Uint8Array.from(
      atob(
        text
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(Math.ceil(text.length / 4) * 4, '='),
      ),
      c => c.charCodeAt(0),
    ),
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** The server's VAPID key pair lives in one secret: a P-256 private JWK. The public key is derived. */
export function vapidKeys(env: PushEnv): { jwk: JWK; publicKey: string } | null {
  if (!env.VAPID_PRIVATE_JWK) return null;
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK) as JWK;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !jwk.d) return null;
    return { jwk, publicKey: b64u.encode(concat(new Uint8Array([4]), b64u.decode(jwk.x), b64u.decode(jwk.y))) };
  } catch {
    return null;
  }
}
/** `vapid t=<jwt>, k=<public key>` for one push service origin; the token lasts twelve hours. */
export async function vapidAuthorization(env: PushEnv, audience: string, now = new Date()) {
  const keys = vapidKeys(env);
  if (!keys) throw new StoreError('push_not_configured', 503);
  const key = await importJWK(keys.jwk, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(audience)
    .setSubject('mailto:' + (env.PRIVACY_CONTACT_EMAIL ?? 'hello@lowkkey.app'))
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + 12 * 3600)
    .sign(key);
  return `vapid t=${token}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
      key,
      bytes * 8,
    ),
  );
}
/** RFC 8291 message encryption: an ephemeral ECDH key, HKDF to a content key and nonce, one AES-128-GCM record. */
export async function encrypt(p256dh: string, auth: string, plaintext: string, recordSize = 4096) {
  const uaPublic = b64u.decode(p256dh),
    authSecret = b64u.decode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16)
    throw new StoreError('invalid_subscription', 400);
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const record = concat(encoder.encode(plaintext), new Uint8Array([2]));
  if (record.length > recordSize - 16) throw new StoreError('payload_too_large', 413);
  const aes = await crypto.subtle.importKey('raw', contentKey as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, record as BufferSource),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

type Subscription = { endpoint: string; p256dh: string; auth: string };
export async function status(db: D1Database, env: PushEnv, owner: string): Promise<PushStatus> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner_id=?')
    .bind(owner)
    .first<{ n: number }>();
  return { key: vapidKeys(env)?.publicKey ?? null, subscriptions: Number(row?.n ?? 0) };
}
export async function subscribe(db: D1Database, env: PushEnv, owner: string, value: unknown, now = new Date()) {
  if (!vapidKeys(env)) throw new StoreError('push_not_configured', 503);
  const input = PushSubscriptionInput.parse(value);
  await db
    .prepare(
      'INSERT INTO push_subscriptions(owner_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth',
    )
    .bind(owner, input.endpoint, input.keys.p256dh, input.keys.auth, now.toISOString())
    .run();
  return status(db, env, owner);
}
export async function unsubscribe(db: D1Database, env: PushEnv, owner: string, value: unknown) {
  const { endpoint } = PushSubscriptionInput.pick({ endpoint: true }).parse(value);
  await db.prepare('DELETE FROM push_subscriptions WHERE owner_id=? AND endpoint=?').bind(owner, endpoint).run();
  return status(db, env, owner);
}

/**
 * Deliver one notice to every device of the owner, inside the quiet rule. Dead subscriptions
 * (404, 410) are forgotten. Returns what happened so callers and tests can see it; never throws
 * for a push service's failure, because the fact behind the notice is already saved.
 */
export async function notify(
  db: D1Database,
  env: PushEnv,
  owner: string,
  notice: Notice,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<{ sent: number; skipped: 'unconfigured' | 'nobody' | 'quiet' | 'weekly' | null }> {
  if (!vapidKeys(env)) return { sent: 0, skipped: 'unconfigured' };
  const subscriptions = (
    await db
      .prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE owner_id=?')
      .bind(owner)
      .all<Subscription>()
  ).results;
  if (!subscriptions.length) return { sent: 0, skipped: 'nobody' };
  const week = new Date(now.getTime() - 7 * 86400000).toISOString(),
    quiet = new Date(now.getTime() - QUIET_MINUTES * 60000).toISOString();
  const recent = await db
    .prepare('SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM push_sends WHERE owner_id=? AND sent_at>?')
    .bind(owner, week)
    .first<{ n: number; last: string | null }>();
  if (recent?.last && recent.last > quiet) return { sent: 0, skipped: 'quiet' };
  if (Number(recent?.n ?? 0) >= WEEKLY_LIMIT) return { sent: 0, skipped: 'weekly' };
  const payload = JSON.stringify(notice);
  let sent = 0;
  const dead: string[] = [];
  for (const subscription of subscriptions) {
    try {
      const body = await encrypt(subscription.p256dh, subscription.auth, payload);
      const response = await fetcher(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuthorization(env, new URL(subscription.endpoint).origin, now),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(7 * 86400),
          Urgency: 'normal',
          Topic: notice.kind,
        },
        body: body as BodyInit,
      });
      if (response.status === 404 || response.status === 410) dead.push(subscription.endpoint);
      else if (response.ok) sent++;
    } catch {
      /* A push service that is down is not this request's problem. */
    }
  }
  const statements = dead.map(endpoint =>
    db.prepare('DELETE FROM push_subscriptions WHERE owner_id=? AND endpoint=?').bind(owner, endpoint),
  );
  if (sent)
    statements.push(
      db
        .prepare('INSERT INTO push_sends(owner_id,sent_at,kind) VALUES (?,?,?)')
        .bind(owner, now.toISOString(), notice.kind),
      db.prepare('DELETE FROM push_sends WHERE owner_id=? AND sent_at<=?').bind(owner, week),
    );
  if (statements.length) await db.batch(statements);
  return { sent, skipped: null };
}
