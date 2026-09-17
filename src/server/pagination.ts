import { z } from 'zod';
import { uuidSchema } from '../domain/primitives.ts';
import { DomainError } from './errors.ts';

export const pageQueryFields = { limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().int().max(100)).default(20), cursor: z.string().max(4000).optional() };
const cursorSchema = z.strictObject({ version: z.literal(1), owner: uuidSchema, scope: z.string(), query: z.string(), after: uuidSchema });
/** A cursor is a position, never an authorization token. Every query still filters owner. */
export function pageAfter(owner: string, scope: string, query: unknown, cursor?: string): string | null {
  if (!cursor) return null;
  try {
    const value = cursorSchema.parse(JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))));
    if (value.owner !== owner || value.scope !== scope || value.query !== JSON.stringify(query)) throw new Error();
    return value.after;
  } catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'cursor' }); }
}
export function pageResult<T extends { id: string }>(items: T[], limit: number, owner: string, scope: string, query: unknown) {
  const more = items.length > limit;
  const page = items.slice(0, limit);
  // JSON's non-ASCII query text must be escaped before base64 encoding.
  const serialized = JSON.stringify({ version: 1, owner, scope, query: JSON.stringify(query), after: page.at(-1)?.id }).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return { items: page, nextCursor: more ? btoa(serialized).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null };
}
