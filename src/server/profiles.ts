import type { D1Database } from '@cloudflare/workers-types';
import { profileInputSchema, profileSnapshotSchema } from '../domain/profile.ts';
import type { ProfileSnapshot } from '../domain/profile.ts';
import { addDays, localDateAt, revisionSchema } from '../domain/primitives.ts';
import { effectiveTimezone, nextProfileNoon } from '../domain/time.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan } from './commands.ts';
import { DomainError } from './errors.ts';

const columns = {
  id: 'id', ownerId: 'owner_id', revision: 'revision', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at',
  displayName: 'display_name', bodyWeightUnit: 'body_weight_unit', defaultLoadUnit: 'default_load_unit', trainingExperience: 'training_experience', heightCm: 'height_cm', constraintsText: 'constraints_text',
  digestEnabled: 'digest_enabled', autoMemoryEnabled: 'auto_memory_enabled', nextDigestAt: 'next_digest_at', pendingTimezone: 'pending_timezone', timezoneEffectiveDate: 'timezone_effective_date',
} as const;
export const profileSelect = `SELECT ${Object.entries(columns).map(([key, column]) => `p.${column} AS ${key}`).join(',')},u.locale,u.timezone FROM user_profiles p JOIN users u ON u.id=p.owner_id`;
export function decodeProfile(row: Record<string, unknown>) { return profileSnapshotSchema.parse({ ...row, digestEnabled: row.digestEnabled === 1, autoMemoryEnabled: row.autoMemoryEnabled === 1 }); }
export async function readProfile(db: D1Database, ownerId: string): Promise<ProfileSnapshot> {
  const row = await db.prepare(`${profileSelect} WHERE p.owner_id=? AND p.deleted_at IS NULL`).bind(ownerId).first<Record<string, unknown>>();
  if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
  return decodeProfile(row);
}
export function profilePlan(context: CommandContext, before: ProfileSnapshot | null, after: ProfileSnapshot): CommandPlan {
  profileSnapshotSchema.parse(after);
  const keys = Object.keys(columns) as Array<keyof typeof columns>;
  const values = keys.map(key => typeof after[key] === 'boolean' ? Number(after[key]) : after[key]);
  const fields = { ...columns, locale: 'locale', timezone: 'timezone' };
  const changedKeys = (Object.keys(fields) as Array<keyof typeof fields>).filter(key => !['id', 'ownerId', 'revision', 'createdAt', 'updatedAt', 'nextDigestAt'].includes(key));
  return {
    guards: [before
      ? { predicate: 'EXISTS(SELECT 1 FROM user_profiles WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)', values: [after.ownerId, after.id, before.revision], error: new DomainError('REVISION_CONFLICT', 409) }
      : { predicate: 'NOT EXISTS(SELECT 1 FROM user_profiles WHERE owner_id=? OR id=?)', values: [after.ownerId, after.id], error: new DomainError('REVISION_CONFLICT', 409) }],
    statements: [before
      ? context.db.prepare(`UPDATE user_profiles SET ${keys.map(key => `${columns[key]}=?`).join(',')} WHERE owner_id=? AND id=?`).bind(...values, after.ownerId, after.id)
      : context.db.prepare(`INSERT INTO user_profiles(${keys.map(key => columns[key]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...values),
      context.db.prepare('UPDATE users SET locale=?,timezone=? WHERE id=?').bind(after.locale, after.timezone, after.ownerId)],
    entities: [{ type: 'user_profile', before, after, action: before ? 'updated' : 'created', changes: changedKeys.filter(key => (before?.[key] ?? null) !== after[key]).map(key => ({ field: fields[key], before: before?.[key] ?? null, after: after[key] })) }],
    result: { profile: after }, undoable: false,
  };
}
export async function patchProfile(db: D1Database, auth: AuthContext, operationId: string, expectedRevision: number, payload: unknown, clock?: () => Date) {
  revisionSchema.parse(expectedRevision);
  const input = profileInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'profile.update', payload: input, expectedRevision, entryPoint: 'me.update', plan: async context => {
    const before = await readProfile(db, auth.id);
    if (before.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 409, { currentRevision: before.revision });
    const now = new Date(context.now);
    const base = effectiveTimezone(before.timezone, before.pendingTimezone, before.timezoneEffectiveDate, now);
    const { timezone: requestedTimezone, ...patch } = input;
    const due = before.pendingTimezone !== null && base === before.pendingTimezone;
    const after: ProfileSnapshot = { ...before, ...patch, revision: before.revision + 1, updatedAt: context.now, timezone: base,
      pendingTimezone: due ? null : before.pendingTimezone, timezoneEffectiveDate: due ? null : before.timezoneEffectiveDate };
    if (requestedTimezone !== undefined) {
      after.pendingTimezone = requestedTimezone === base ? null : requestedTimezone;
      after.timezoneEffectiveDate = after.pendingTimezone ? addDays(localDateAt(now, base), 1) : null;
    }
    if (due || requestedTimezone !== undefined || input.digestEnabled !== undefined) after.nextDigestAt = nextProfileNoon(now, after.timezone, after.pendingTimezone, after.timezoneEffectiveDate);
    return profilePlan(context, before, after);
  } }, clock);
}
