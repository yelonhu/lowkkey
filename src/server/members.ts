import { eq } from 'drizzle-orm';
import { users, userProfiles } from '../../db/schema.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { memberSchema } from './auth.ts';
import type { MemberLookup } from './auth.ts';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
export function memberLookup(db: DrizzleD1Database, clock = () => new Date()): MemberLookup {
  return async verifiedSubject => {
    const row = await db.select({ id: users.id, verifiedSubject: users.verifiedSubject, emailNormalized: users.emailNormalized, role: users.role, status: users.status, locale: users.locale, timezone: users.timezone, pendingTimezone: userProfiles.pendingTimezone, timezoneEffectiveDate: userProfiles.timezoneEffectiveDate }).from(users).leftJoin(userProfiles, eq(users.id, userProfiles.ownerId)).where(eq(users.verifiedSubject, verifiedSubject)).get();
    if (!row) return null;
    const { pendingTimezone, timezoneEffectiveDate, ...member } = row;
    return memberSchema.parse({ ...member, timezone: effectiveTimezone(member.timezone, pendingTimezone, timezoneEffectiveDate, clock()) });
  };
}
