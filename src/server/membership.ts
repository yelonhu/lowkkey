import type { D1Database } from '@cloudflare/workers-types';
import { activationSchema, goalAmountsSchema, invitationInputSchema, memberChangeSchema } from '../domain/profile.ts';
import { localDateAt, revisionSchema, uuidSchema } from '../domain/primitives.ts';
import { nextNoon } from '../domain/time.ts';
import { normalizeEmail, subjectKey } from './auth.ts';
import type { AuthContext, Member, VerifiedIdentity } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan, Guard, Snapshot } from './commands.ts';
import { DomainError } from './errors.ts';
import { goalPlan, newGoal } from './goals.ts';
import { profilePlan } from './profiles.ts';

type Membership = { id: string; email: string; verifiedSubject: string | null; role: Member['role']; status: Member['status']; membershipRevision: number; locale: Member['locale']; timezone: string };
type Invitation = { id: string; expiresAt: string; status: 'invited' | 'accepted' | 'expired' | 'revoked' };
const memberSelect = 'SELECT id,email_normalized AS email,verified_subject AS verifiedSubject,role,status,membership_revision AS membershipRevision,locale,timezone FROM users';
const lookupEmail = (db: D1Database, email: string) => db.prepare(`${memberSelect} WHERE email_normalized=?`).bind(email).first<Membership>();
const publicMember = (member: Membership) => ({ id: member.id, email: member.email, role: member.role, status: member.status, revision: member.membershipRevision });
async function invitationFor(db: D1Database, email: string) {
  return db.prepare("SELECT id,expires_at AS expiresAt,status FROM invitations WHERE email_normalized=? ORDER BY CASE WHEN status='invited' THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 1").bind(email).first<Invitation>();
}
async function requireAdministrator(db: D1Database, ownerId: string) {
  const role = await db.prepare("SELECT role FROM users WHERE id=? AND status='active'").bind(ownerId).first<string>('role');
  if (role !== 'admin') throw new DomainError('ADMIN_REQUIRED', 403);
}
async function membershipGuard(context: CommandContext): Promise<Guard> {
  const revision = await context.db.prepare('SELECT revision FROM membership_state WHERE id=1').first<number>('revision');
  if (revision === null) throw new Error('Membership migration missing');
  return { predicate: 'EXISTS(SELECT 1 FROM membership_state WHERE id=1 AND revision=?)', values: [revision], error: new DomainError('TEMPORARY_FAILURE', 503), retryOnConflict: true };
}
const advanceMembership = (db: D1Database) => db.prepare('UPDATE membership_state SET revision=revision+1 WHERE id=1');
const administratorGuard = (id: string): Guard => ({ predicate: "EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND role='admin')", values: [id], error: new DomainError('ADMIN_REQUIRED', 403) });
async function requireCapacity(db: D1Database) {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE status IN ('active','invited')").first<number>('n');
  if (count === null || count >= 5) throw new DomainError('MEMBER_LIMIT_REACHED', 409);
}

export async function sessionState(db: D1Database, identity: VerifiedIdentity, now: Date) {
  const member = await lookupEmail(db, normalizeEmail(identity.email));
  if (!member || (member.verifiedSubject !== null && member.verifiedSubject !== subjectKey(identity))) throw new DomainError('AUTH_REQUIRED', 401);
  if (member.status === 'active' && member.verifiedSubject === subjectKey(identity)) return { state: 'active' as const, member };
  if (member.status !== 'invited') throw new DomainError('MEMBER_SUSPENDED', 403);
  const invitation = await invitationFor(db, member.email);
  if (member.verifiedSubject !== null || !invitation || invitation.status !== 'invited' || invitation.expiresAt <= now.toISOString()) throw new DomainError('INVITATION_EXPIRED', 410);
  return { state: 'invited' as const, member, invitation };
}
export async function activateMember(db: D1Database, identity: VerifiedIdentity, operationId: string, payload: unknown, clock = () => new Date()) {
  const input = activationSchema.parse(payload);
  const state = await sessionState(db, identity, clock());
  const auth: AuthContext = { id: state.member.id, role: state.member.role, locale: input.locale, timezone: input.timezone, status: 'active' };
  return executeCommand(db, auth, { operationId, kind: 'member.activate', payload: input, entryPoint: 'session.activate', activationIdentity: identity, plan: async context => {
    const globalGuard = await membershipGuard(context);
    const current = await sessionState(db, identity, new Date(context.now));
    if (current.state !== 'invited') throw new DomainError('REVISION_CONFLICT', 409, { reason: 'alreadyActivated' });
    const profile = profilePlan(context, null, { id: crypto.randomUUID(), ownerId: auth.id, revision: 1, createdAt: context.now, updatedAt: context.now, deletedAt: null,
      displayName: input.displayName, locale: input.locale, timezone: input.timezone, bodyWeightUnit: 'kg', defaultLoadUnit: 'kg', trainingExperience: 'unknown', heightCm: null, constraintsText: null,
      digestEnabled: true, autoMemoryEnabled: true, nextDigestAt: nextNoon(new Date(context.now), input.timezone), pendingTimezone: null, timezoneEffectiveDate: null });
    const goal = goalPlan(context, newGoal(context, crypto.randomUUID(), input.goalType, localDateAt(new Date(context.now), input.timezone), goalAmountsSchema.parse({}), null));
    return {
      guards: [globalGuard, ...profile.guards, ...goal.guards,
        { predicate: "EXISTS(SELECT 1 FROM invitations WHERE id=? AND email_normalized=? AND status='invited' AND expires_at>?)", values: [current.invitation.id, identity.email, context.now], error: new DomainError('INVITATION_EXPIRED', 410) },
        { predicate: "EXISTS(SELECT 1 FROM users WHERE id=? AND status='invited' AND verified_subject IS NULL)", values: [auth.id], error: new DomainError('REVISION_CONFLICT', 409) }],
      statements: [...profile.statements, ...goal.statements,
        db.prepare("UPDATE users SET verified_subject=?,status='active',membership_revision=membership_revision+1 WHERE id=?").bind(subjectKey(identity), auth.id),
        db.prepare("UPDATE invitations SET status='accepted',accepted_user_id=? WHERE id=?").bind(auth.id, current.invitation.id), advanceMembership(db)],
      entities: [...profile.entities, ...goal.entities], result: { ...profile.result, ...goal.result }, undoable: false,
      auditDetails: { invitationId: current.invitation.id, membershipBefore: 'invited', membershipAfter: 'active' },
    };
  } }, clock);
}

export async function listMembers(db: D1Database, auth: AuthContext) {
  await requireAdministrator(db, auth.id);
  const result = await db.prepare(`SELECT id,email_normalized AS email,role,status,membership_revision AS revision,
    (SELECT expires_at FROM invitations i WHERE i.email_normalized=u.email_normalized AND i.status='invited') AS invitationExpiresAt
    FROM users u WHERE status<>'deleted' AND EXISTS(SELECT 1 FROM users a WHERE a.id=? AND a.status='active' AND a.role='admin') ORDER BY created_at,id`).bind(auth.id).all<{ id: string; email: string; role: string; status: string; revision: number; invitationExpiresAt: string | null }>();
  if (!result.results.length) throw new DomainError('ADMIN_REQUIRED', 403);
  return { items: result.results, nextCursor: null };
}

export async function inviteMember(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, origin: string, clock?: () => Date) {
  const input = invitationInputSchema.parse(payload);
  const loginUrl = new URL('/today', origin).href;
  return executeCommand(db, auth, { operationId, kind: 'membership.invite', payload: input, entryPoint: 'admin.invitations', scope: 'membership', plan: async context => {
    await requireAdministrator(db, auth.id);
    const globalGuard = await membershipGuard(context);
    const member = await lookupEmail(db, input.email);
    const invitation = member ? await invitationFor(db, input.email) : null;
    const guards = [globalGuard, administratorGuard(auth.id)];
    const plan = (result: Snapshot, statements: CommandPlan['statements'] = [], details: Snapshot = {}): CommandPlan => ({ guards, statements: [...statements, advanceMembership(db)], entities: [], undoable: false, result, auditDetails: details });
    if (member?.status === 'active') return plan({ member: publicMember(member), invitation: null, loginUrl, reused: true });
    if (member?.status === 'invited' && invitation?.status === 'invited' && invitation.expiresAt > context.now) return plan({ member: publicMember(member), invitation, loginUrl, reused: true });
    if (member && (member.verifiedSubject !== null || !['invited', 'suspended'].includes(member.status))) throw new DomainError('MEMBER_SUSPENDED', 403);
    if (member && !input.renew) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'renewInvitation' });
    if (!member || member.status !== 'invited') await requireCapacity(db);
    const id = member?.id ?? crypto.randomUUID(), invitationId = crypto.randomUUID();
    const expiresAt = new Date(new Date(context.now).getTime() + 7 * 86400000).toISOString();
    const next: Membership = member ? { ...member, status: 'invited', membershipRevision: member.membershipRevision + 1 } : { id, email: input.email, verifiedSubject: null, role: 'member', status: 'invited', membershipRevision: 1, locale: 'en', timezone: 'UTC' };
    return plan({ member: publicMember(next), invitation: { id: invitationId, status: 'invited', expiresAt }, loginUrl, reused: false }, [
      member ? db.prepare("UPDATE users SET status='invited',membership_revision=membership_revision+1,suspended_at=NULL WHERE id=?").bind(id)
        : db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','invited','en','UTC',?)").bind(id, input.email, context.now),
      db.prepare("UPDATE invitations SET status='expired' WHERE email_normalized=? AND status='invited'").bind(input.email),
      db.prepare("INSERT INTO invitations(id,email_normalized,expires_at,status,created_by,created_at) VALUES (?,?,?,'invited',?,?)").bind(invitationId, input.email, expiresAt, auth.id, context.now),
    ], { targetId: id, invitationId, previousStatus: member?.status ?? null, status: 'invited', renewed: member !== null });
  } }, clock);
}

export async function changeMember(db: D1Database, auth: AuthContext, operationId: string, id: string, expectedRevision: number, payload: unknown, clock?: () => Date) {
  uuidSchema.parse(id); revisionSchema.parse(expectedRevision);
  const input = memberChangeSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'membership.update', payload: { id, ...input }, expectedRevision, entryPoint: 'admin.members.update', scope: 'membership', plan: async context => {
    await requireAdministrator(db, auth.id);
    const globalGuard = await membershipGuard(context);
    const before = await db.prepare(`${memberSelect} WHERE id=?`).bind(id).first<Membership>();
    if (!before || ['deleted', 'deletion_pending'].includes(before.status)) throw new DomainError('RECORD_NOT_FOUND', 404);
    if (before.membershipRevision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 409, { currentRevision: before.membershipRevision });
    if (input.role !== undefined && input.role !== before.role && !input.confirmRoleChange) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'roleChange' });
    const after = { ...before, role: input.role ?? before.role, status: input.status ?? before.status, membershipRevision: before.membershipRevision + 1 };
    if (after.status === 'active' && before.verifiedSubject === null) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'memberMustActivate' });
    if (after.status === 'active' && !['active', 'invited'].includes(before.status)) await requireCapacity(db);
    if (before.role === 'admin' && before.status === 'active' && (after.role !== 'admin' || after.status !== 'active')) {
      const others = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active' AND id<>?").bind(id).first<number>('n');
      if (!others) throw new DomainError('LAST_ADMIN_REQUIRED', 409);
    }
    return {
      guards: [globalGuard, administratorGuard(auth.id), { predicate: 'EXISTS(SELECT 1 FROM users WHERE id=? AND membership_revision=?)', values: [id, expectedRevision], error: new DomainError('REVISION_CONFLICT', 409) }],
      statements: [db.prepare('UPDATE users SET role=?,status=?,membership_revision=membership_revision+1,suspended_at=? WHERE id=?').bind(after.role, after.status, after.status === 'suspended' ? context.now : null, id),
        ...(after.status === 'suspended' ? [db.prepare("UPDATE invitations SET status='revoked' WHERE email_normalized=? AND status='invited'").bind(before.email)] : []), advanceMembership(db)],
      entities: [], result: { member: publicMember(after) }, undoable: false, auditDetails: { targetId: id, before: publicMember(before), after: publicMember(after) },
    };
  } }, clock);
}
