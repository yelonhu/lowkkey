import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { subjectKey } from './auth.ts';
import type { VerifiedIdentity } from './auth.ts';
import { readOperation, requestHash } from './commands.ts';
import type { CommandReceipt } from './commands.ts';
import { DomainError } from './errors.ts';
import { scaledSchema, utcSchema, uuidSchema } from '../domain/primitives.ts';

const sessionSchema = z.strictObject({ hash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: utcSchema });
const logoutInputSchema = z.strictObject({ localDataDisposition: z.enum(['synced', 'exported', 'discarded']) });
export async function checkSession(db: D1Database, identity: VerifiedIdentity, now: Date) {
  if (!identity.session) return;
  const session = sessionSchema.parse(identity.session);
  if (session.expiresAt <= now.toISOString() || await db.prepare('SELECT 1 AS revoked FROM revoked_sessions WHERE token_hash=?').bind(session.hash).first('revoked')) throw new DomainError('AUTH_REQUIRED', 401);
}
export async function logoutSession(db: D1Database, identity: VerifiedIdentity, operationId: string, payload: unknown, clock = () => new Date(), expectedOwner?: string): Promise<CommandReceipt> {
  uuidSchema.parse(operationId);
  const input = logoutInputSchema.parse(payload);
  if (!identity.session) throw new DomainError('TEMPORARY_FAILURE', 503);
  const session = sessionSchema.parse(identity.session);
  const hash = await requestHash({ kind: 'session.logout', payload: input, sessionHash: session.hash });
  // Logout must also work for a suspended member. It changes authentication
  // metadata only, and never advances the health stream or modifies a record.
  for (let attempt = 0; attempt < 4; attempt++) {
    const member = await db.prepare('SELECT id,data_revision,verified_subject FROM users WHERE email_normalized=? AND (verified_subject=? OR verified_subject IS NULL)').bind(identity.email, subjectKey(identity)).first<{ id: string; data_revision: number; verified_subject: string | null }>();
    if (!member || (expectedOwner !== undefined && expectedOwner !== member.id)) throw new DomainError('AUTH_REQUIRED', 401);
    const replay = await readOperation(db, member.id, operationId, hash);
    if (replay) return replay;
    const now = clock().toISOString();
    const receipt: CommandReceipt = { operationId, dataRevision: scaledSchema.parse(member.data_revision), recordRefs: [], committedAt: now, undoAvailable: false, result: { logoutUrl: '/cdn-cgi/access/logout' } };
    try {
      await db.batch([
        db.prepare('INSERT INTO mutation_guards(owner_id,operation_id,condition_ok) VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=? AND verified_subject IS ? AND email_normalized=? AND data_revision=?) THEN 1 ELSE 0 END)').bind(member.id, operationId, member.id, member.verified_subject, identity.email, member.data_revision),
        db.prepare('INSERT INTO revoked_sessions(token_hash,owner_id,expires_at,revoked_at) VALUES (?,?,?,?) ON CONFLICT(token_hash) DO NOTHING').bind(session.hash, member.id, session.expiresAt, now),
        db.prepare("INSERT INTO command_operations(owner_id,operation_id,request_hash,kind,actor_kind,actor_id,entry_point,authorization_json,target_refs_json,response_json,status,created_at,undo_until) VALUES (?,?,?,'session.logout','user',?,'session.logout',?,'[]',?,'committed',?,NULL)").bind(member.id, operationId, hash, member.id, JSON.stringify(input), JSON.stringify(receipt), now),
        db.prepare('DELETE FROM mutation_guards WHERE owner_id=? AND operation_id=?').bind(member.id, operationId),
      ]);
      return receipt;
    } catch (error) {
      const committed = await readOperation(db, member.id, operationId, hash);
      if (committed) return committed;
      const current = await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(member.id).first<number>('data_revision');
      if (current !== null && current !== member.data_revision) continue;
      throw error;
    }
  }
  throw new DomainError('TEMPORARY_FAILURE', 503);
}
