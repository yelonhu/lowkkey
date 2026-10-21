import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, readdir, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { importJWK, jwtVerify, type JWK } from 'jose';
import { accountFor } from '../src/server/account.ts';
import * as push from '../src/server/push.ts';
const directory = '.data/push-test/' + crypto.randomUUID();
let mf: Miniflare, db: D1Database, owner: string;
let env: push.PushEnv, vapidPublic: JWK;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
/** A browser's side of the subscription: an ECDH key pair and a 16-byte auth secret. */
async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: push.b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey)),
    auth: push.b64u.encode(auth),
    /** RFC 8291 from the receiving side, to prove the server's bytes are what a browser expects. */
    async decrypt(body: Uint8Array) {
      const salt = body.slice(0, 16),
        rs = new DataView(body.buffer, body.byteOffset).getUint32(16),
        idlen = body[20],
        asPublic = body.slice(21, 21 + idlen),
        ciphertext = body.slice(21 + idlen);
      expect(rs).toBe(4096);
      expect(idlen).toBe(65);
      const uaPublic = push.b64u.decode(this.p256dh);
      const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256),
      );
      const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) =>
        new Uint8Array(
          await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: s as BufferSource, info: info as BufferSource },
            await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']),
            bytes * 8,
          ),
        );
      const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
      const key = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
      const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
      const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext));
      expect(record.at(-1)).toBe(2);
      return decoder.decode(record.slice(0, -1));
    },
  };
}
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-30',
    cf: false,
    host: '127.0.0.1',
    d1Databases: { DB: 'push' },
    d1Persist: directory,
    outboundService: () => {
      throw new Error('No outbound');
    },
  });
  db = (await mf.getD1Database('DB')) as D1Database;
  for (const name of (await readdir('db/showroom-migrations')).filter(n => n.endsWith('.sql')).sort())
    await db.batch(
      (await readFile('db/showroom-migrations/' + name, 'utf8'))
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => db.prepare(s)),
    );
  owner = await accountFor(db, { issuer: 'push', subject: 'one', email: 'push@example.com' });
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  vapidPublic = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  env = {
    VAPID_PRIVATE_JWK: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }),
    PRIVACY_CONTACT_EMAIL: 'keeper@example.com',
  };
});
afterAll(async () => {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
});
describe('信到了: web push', () => {
  it('derives the public key from the private JWK and signs VAPID tokens a push service can verify', async () => {
    const keys = push.vapidKeys(env)!;
    expect(push.b64u.decode(keys.publicKey)).toHaveLength(65);
    expect(push.vapidKeys({})).toBeNull();
    expect(push.vapidKeys({ VAPID_PRIVATE_JWK: '{"kty":"EC"}' })).toBeNull();
    const header = await push.vapidAuthorization(env, 'https://web.push.apple.com', new Date('2026-10-21T10:00:00Z'));
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(keys.publicKey);
    const { payload } = await jwtVerify(token, await importJWK(vapidPublic, 'ES256'), {
      audience: 'https://web.push.apple.com',
      currentDate: new Date('2026-10-21T10:00:00Z'),
    });
    expect(payload.sub).toBe('mailto:keeper@example.com');
    expect(payload.exp! - payload.iat!).toBe(12 * 3600);
  });
  it('encrypts a payload exactly as a browser decrypts it', async () => {
    const phone = await device();
    const body = await push.encrypt(phone.p256dh, phone.auth, '{"title":"信到了"}');
    expect(await phone.decrypt(body)).toBe('{"title":"信到了"}');
    // Every message takes a fresh ephemeral key and salt.
    const again = await push.encrypt(phone.p256dh, phone.auth, '{"title":"信到了"}');
    expect(Buffer.from(again).equals(Buffer.from(body))).toBe(false);
    await expect(push.encrypt('AAAA', phone.auth, 'x')).rejects.toThrow('invalid_subscription');
    await expect(push.encrypt(phone.p256dh, phone.auth, 'x'.repeat(4100))).rejects.toThrow('payload_too_large');
  });
  it('keeps subscriptions per device, delivers inside the quiet rule, and forgets dead endpoints', async () => {
    const phone = await device(),
      laptop = await device();
    expect(await push.status(db, {}, owner)).toEqual({ key: null, subscriptions: 0 });
    await expect(push.subscribe(db, {}, owner, { endpoint: 'https://p.test/1', keys: phone })).rejects.toThrow(
      'push_not_configured',
    );
    const subscription = (keys: { p256dh: string; auth: string }, endpoint: string) => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    expect(
      (await push.subscribe(db, env, owner, subscription(phone, 'https://push.example/phone'))).subscriptions,
    ).toBe(1);
    expect(
      (await push.subscribe(db, env, owner, subscription(laptop, 'https://push.example/laptop'))).subscriptions,
    ).toBe(2);
    expect(
      (await push.subscribe(db, env, owner, subscription(phone, 'https://push.example/phone'))).subscriptions,
    ).toBe(2);
    await expect(push.subscribe(db, env, owner, { endpoint: 'nope', keys: phone })).rejects.toThrow();
    const notice: push.Notice = { kind: 'letter', title: '信到了', body: '稳稳地向前', url: '/#recap?week=2026-10-19' };
    const requests: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
    let laptopStatus = 201;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: init!.headers as Record<string, string>,
        body: new Uint8Array(init!.body as ArrayBuffer),
      });
      return new Response(null, { status: String(url).endsWith('/laptop') ? laptopStatus : 201 });
    }) as typeof fetch;
    const at = (minutes: number) => new Date(Date.parse('2026-10-21T10:00:00Z') + minutes * 60000);
    expect(await push.notify(db, {}, owner, notice, fetcher, at(0))).toEqual({ sent: 0, skipped: 'unconfigured' });
    expect(await push.notify(db, env, owner, notice, fetcher, at(0))).toEqual({ sent: 2, skipped: null });
    expect(requests.map(r => r.url).sort()).toEqual(['https://push.example/laptop', 'https://push.example/phone']);
    const toPhone = requests.find(r => r.url.endsWith('/phone'))!;
    expect(toPhone.headers['Content-Encoding']).toBe('aes128gcm');
    expect(toPhone.headers.TTL).toBe(String(7 * 86400));
    expect(toPhone.headers.Topic).toBe('letter');
    expect(toPhone.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.parse(await phone.decrypt(toPhone.body))).toEqual(notice);
    // Ten quiet minutes after a notice, then up to three a week.
    expect(await push.notify(db, env, owner, notice, fetcher, at(5))).toEqual({ sent: 0, skipped: 'quiet' });
    laptopStatus = 410;
    expect(await push.notify(db, env, owner, { ...notice, kind: 'medal' }, fetcher, at(11))).toEqual({
      sent: 1,
      skipped: null,
    });
    expect((await push.status(db, env, owner)).subscriptions).toBe(1);
    expect(await push.notify(db, env, owner, notice, fetcher, at(30))).toEqual({ sent: 1, skipped: null });
    expect(await push.notify(db, env, owner, notice, fetcher, at(60))).toEqual({ sent: 0, skipped: 'weekly' });
    expect(await push.notify(db, env, owner, notice, fetcher, at(8 * 24 * 60))).toEqual({ sent: 1, skipped: null });
    expect((await push.unsubscribe(db, env, owner, { endpoint: 'https://push.example/phone' })).subscriptions).toBe(0);
    expect(await push.notify(db, env, owner, notice, fetcher, at(9 * 24 * 60))).toEqual({ sent: 0, skipped: 'nobody' });
  });
});
