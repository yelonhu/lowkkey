import type { D1Database } from '@cloudflare/workers-types';

export const localFixture = { id: '991314e2-5405-4e8a-bde4-9c07319f2c54', email: 'local-member@example.invalid', subject: 'lowkkey-local-fixture', issuer: 'https://local-fixture.invalid' } as const;
export async function seedLocalFixture(db: D1Database, environment: string, clock = () => new Date()) {
  if (!['development', 'test'].includes(environment)) throw new Error('DEVELOPMENT_IDENTITY_FORBIDDEN');
  const now = clock().toISOString();
  const existing = await db.prepare('SELECT id,email_normalized,status,verified_subject FROM users WHERE id=? OR email_normalized=?').bind(localFixture.id, localFixture.email).first<{ id: string; email_normalized: string; status: string; verified_subject: string | null }>();
  if (existing && (existing.id !== localFixture.id || existing.email_normalized !== localFixture.email)) throw new Error('LOCAL_FIXTURE_IDENTITY_COLLISION');
  if (existing && (existing.status !== 'invited' || existing.verified_subject !== null)) return;
  const pending = await db.prepare("SELECT id,expires_at FROM invitations WHERE email_normalized=? AND status='invited'").bind(localFixture.email).first<{ id: string; expires_at: string }>();
  if (existing && pending && pending.expires_at > now) return;
  await db.batch([
    ...(!existing ? [db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'admin','invited','en','UTC',?)").bind(localFixture.id, localFixture.email, now)] : []),
    db.prepare("UPDATE invitations SET status='expired' WHERE email_normalized=? AND status='invited'").bind(localFixture.email),
    db.prepare("INSERT INTO invitations(id,email_normalized,expires_at,status,created_by,created_at) VALUES (?,?,?,'invited',?,?)").bind(crypto.randomUUID(), localFixture.email, new Date(clock().getTime() + 7 * 86400000).toISOString(), localFixture.id, now),
  ]);
}
