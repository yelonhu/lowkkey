import type { D1Database } from '@cloudflare/workers-types';
import { DomainError } from './errors.ts';

export async function readConsistent<T>(db: D1Database, ownerId: string, read: (dataRevision: number) => Promise<T>): Promise<{ data: T; dataRevision: number }> {
  const member = () => db.prepare('SELECT status,data_revision,membership_revision FROM users WHERE id=?').bind(ownerId).first<{ status: string; data_revision: number; membership_revision: number }>();
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await member();
    if (!before || before.status !== 'active') throw new DomainError('MEMBER_SUSPENDED', 403);
    const data = await read(before.data_revision);
    const after = await member();
    if (!after || after.status !== 'active') throw new DomainError('MEMBER_SUSPENDED', 403);
    if (before.data_revision === after.data_revision && before.membership_revision === after.membership_revision) return { data, dataRevision: after.data_revision };
  }
  throw new DomainError('TEMPORARY_FAILURE', 503);
}
