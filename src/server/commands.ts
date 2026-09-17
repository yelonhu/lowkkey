import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { z } from 'zod';
import type { EntityRef } from '../domain/artifacts.ts';
import { commandReceiptSchema as receiptSchema } from '../domain/command-receipt.ts';
import type { CommandReceipt } from '../domain/command-receipt.ts';
export type { CommandReceipt } from '../domain/command-receipt.ts';
import { changeBatchSchema, domainEventSchema } from '../domain/events.ts';
import type { DomainEvent, EventChange } from '../domain/events.ts';
import { entityMetadataSchema, localeSchema, scaledSchema, timezoneSchema, utcSchema, uuidSchema } from '../domain/primitives.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { subjectKey } from './auth.ts';
import type { AuthContext, VerifiedIdentity } from './auth.ts';
import { DomainError } from './errors.ts';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Snapshot = Record<string, JsonValue>;
export type SqlValue = string | number | null;
export type Guard = { predicate: string; values: SqlValue[]; error: DomainError; retryOnConflict?: boolean };
export type EntityChange = { type: EntityRef['type']; before: Snapshot | null; after: Snapshot; action: DomainEvent['action']; changes: EventChange[] };
export type CommandPlan = { guards: Guard[]; statements: D1PreparedStatement[]; entities: EntityChange[]; result: Snapshot; undoable: boolean; undoOf?: string; auditDetails?: Snapshot };
export type CommandContext = { db: D1Database; auth: AuthContext; now: string; operationId: string; dataRevision: number };
export type Command = {
  operationId: string; kind: string; payload: unknown; expectedRevision?: number; entryPoint: string;
  // Trusted server metadata: never spread a request body into a Command.
  source?: DomainEvent['source']; originThreadId?: string | null;
  scope?: 'health' | 'membership'; activationIdentity?: VerifiedIdentity;
  plan: (context: CommandContext) => Promise<CommandPlan>;
};

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(z.json().parse(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function readOperation(db: D1Database, ownerId: string, operationId: string, hash?: string): Promise<CommandReceipt | null> {
  const row = await db.prepare('SELECT request_hash, response_json FROM command_operations WHERE owner_id=? AND operation_id=?').bind(ownerId, operationId).first<{ request_hash: string; response_json: string }>();
  if (!row) return null;
  if (hash !== undefined && row.request_hash !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 409);
  return receiptSchema.parse(JSON.parse(row.response_json));
}
function metadata(snapshot: Snapshot) {
  z.json().parse(snapshot);
  return entityMetadataSchema.parse(Object.fromEntries(Object.keys(entityMetadataSchema.shape).map(key => [key, snapshot[key]])));
}
async function authorizedMember(db: D1Database, ownerId: string, command: Command) {
  const row = await db.prepare('SELECT u.status,u.role,u.data_revision,u.locale,u.timezone,u.email_normalized,u.verified_subject,p.pending_timezone,p.timezone_effective_date FROM users u LEFT JOIN user_profiles p ON p.owner_id=u.id WHERE u.id=?').bind(ownerId).first<{ status: string; role: 'member' | 'admin'; data_revision: number; locale: string; timezone: string; email_normalized: string; verified_subject: string | null; pending_timezone: string | null; timezone_effective_date: string | null }>();
  const identity = command.activationIdentity;
  if (identity && (command.kind !== 'member.activate' || row?.email_normalized !== identity.email || (row.verified_subject !== null && row.verified_subject !== subjectKey(identity)))) throw new DomainError('AUTH_REQUIRED', 401);
  if (!row || (row.status !== 'active' && !(identity && row.status === 'invited' && row.verified_subject === null))) throw new DomainError('MEMBER_SUSPENDED', 403);
  return row;
}

/** All planner reads are protected by the owner's data revision inside batch().
 * An unrelated concurrent commit may rebuild the plan; original object versions
 * and confirmation inputs never change to force a stale edit through. */
export async function executeCommand(db: D1Database, auth: AuthContext, command: Command, clock: () => Date = () => new Date()): Promise<CommandReceipt> {
  uuidSchema.parse(command.operationId);
  const health = command.scope !== 'membership';
  const hash = await requestHash({ kind: command.kind, payload: command.payload, expectedRevision: command.expectedRevision ?? null, source: command.source ?? 'user', originThreadId: command.originThreadId ?? null, ...(health ? {} : { scope: 'membership' }), ...(command.activationIdentity ? { activationSubject: subjectKey(command.activationIdentity) } : {}) });
  for (let attempt = 0; attempt < 4; attempt++) {
    const member = await authorizedMember(db, auth.id, command);
    const replay = await readOperation(db, auth.id, command.operationId, hash);
    if (replay) return replay;
    const dataRevision = scaledSchema.parse(member.data_revision + (health ? 1 : 0));
    const now = utcSchema.parse(clock().toISOString());
    let plan: CommandPlan;
    try { plan = await command.plan({ db, auth: { ...auth, role: member.role, timezone: effectiveTimezone(timezoneSchema.parse(member.timezone), member.pending_timezone, member.timezone_effective_date, new Date(now)), locale: localeSchema.parse(member.locale) }, now, operationId: command.operationId, dataRevision }); }
    catch (error) {
      await authorizedMember(db, auth.id, command);
      const committed = await readOperation(db, auth.id, command.operationId, hash);
      if (committed) return committed;
      throw error;
    }
    if ((health && !plan.entities.length) || (!health && (plan.entities.length || plan.undoable)) || plan.entities.length > 300) throw new Error('Invalid command change count');
    const seen = new Set<string>();
    const events = plan.entities.map((change, ordinal) => {
      const after = metadata(change.after);
      const before = change.before === null ? null : metadata(change.before);
      const identity = `${change.type}:${after.id}`;
      if (after.ownerId !== auth.id || (before && (before.id !== after.id || before.ownerId !== auth.id)) || seen.has(identity)) throw new Error('Invalid command ownership or duplicate entity');
      if (after.updatedAt !== now || (before && after.createdAt !== before.createdAt)) throw new Error('Invalid entity timestamps');
      seen.add(identity);
      return domainEventSchema.parse({ schemaVersion: 1, eventId: `${command.operationId}:${ordinal}`, operationId: command.operationId, dataRevision,
        source: command.source ?? 'user', originThreadId: command.originThreadId ?? null, occurredAt: now,
        entity: { type: change.type, id: after.id, revision: after.revision }, beforeRevision: before?.revision ?? null, afterRevision: after.revision, action: change.action, changes: change.changes });
    });
    const batch = health ? changeBatchSchema.parse({ dataRevision, operationId: command.operationId, source: command.source ?? 'user', originThreadId: command.originThreadId ?? null, createdAt: now, events }) : null;
    const receipt = receiptSchema.parse({ operationId: command.operationId, dataRevision, recordRefs: events.map(event => event.entity), committedAt: now, undoAvailable: plan.undoable, result: plan.result });
    const predicates = ['EXISTS(SELECT 1 FROM users WHERE id=? AND status=? AND data_revision=? AND email_normalized=? AND verified_subject IS ?)', ...plan.guards.map(guard => `(${guard.predicate})`)];
    const values = [auth.id, member.status, member.data_revision, member.email_normalized, member.verified_subject, ...plan.guards.flatMap(guard => guard.values)];
    const statements = [
      db.prepare(`INSERT INTO mutation_guards(owner_id,operation_id,condition_ok) VALUES (?,?,CASE WHEN ${predicates.join(' AND ')} THEN 1 ELSE 0 END)`).bind(auth.id, command.operationId, ...values),
      ...plan.statements,
      ...(health ? [db.prepare('UPDATE users SET data_revision=data_revision+1 WHERE id=?').bind(auth.id)] : []),
      db.prepare('INSERT INTO command_operations(owner_id,operation_id,request_hash,kind,actor_kind,actor_id,entry_point,authorization_json,target_refs_json,response_json,status,created_at,undo_until) VALUES (?,?,?,?,?,?,?,?,?,?,\'committed\',?,?)').bind(auth.id, command.operationId, hash, command.kind, command.source ?? 'user', auth.id, command.entryPoint, JSON.stringify({ expectedRevision: command.expectedRevision ?? null, requestHash: hash, scope: command.scope ?? 'health', details: plan.auditDetails ?? null }), JSON.stringify(receipt.recordRefs), JSON.stringify(receipt), now, plan.undoable ? new Date(new Date(now).getTime() + 30 * 86400000).toISOString() : null),
      ...plan.entities.map((change, ordinal) => db.prepare('INSERT INTO operation_revisions(id,owner_id,operation_id,target_type,target_id,before_revision,after_revision,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), auth.id, command.operationId, change.type, events[ordinal].entity.id, events[ordinal].beforeRevision, events[ordinal].afterRevision, change.before === null ? null : JSON.stringify(change.before), JSON.stringify(change.after), now)),
      ...(batch ? [db.prepare('INSERT INTO change_batches(owner_id,data_revision,operation_id,source,origin_thread_id,changes_json,events_json,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(auth.id, dataRevision, command.operationId, batch.source, batch.originThreadId, JSON.stringify(plan.entities.map((change, ordinal) => ({ entity: events[ordinal].entity, deleted: change.after.deletedAt !== null, value: change.after }))), JSON.stringify(events), now)] : []),
      ...(plan.undoOf ? [db.prepare('UPDATE command_operations SET undone_by=? WHERE owner_id=? AND operation_id=?').bind(command.operationId, auth.id, plan.undoOf)] : []),
      db.prepare('DELETE FROM mutation_guards WHERE owner_id=? AND operation_id=?').bind(auth.id, command.operationId),
    ];
    try { await db.batch(statements); return receipt; }
    catch (error) {
      const current = await authorizedMember(db, auth.id, command);
      const committed = await readOperation(db, auth.id, command.operationId, hash);
      if (committed) return committed;
      let replan = false;
      for (const guard of plan.guards) {
        const valid = await db.prepare(`SELECT CASE WHEN (${guard.predicate}) THEN 1 ELSE 0 END AS valid`).bind(...guard.values).first<number>('valid');
        if (valid !== 1) { if (guard.retryOnConflict) replan = true; else throw guard.error; }
      }
      if (replan || current.data_revision !== member.data_revision) continue;
      throw error;
    }
  }
  throw new DomainError('TEMPORARY_FAILURE', 503);
}
