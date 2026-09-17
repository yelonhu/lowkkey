import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { entityRefSchema } from '../domain/artifacts.ts';
import { fingerprintSchema, ledgerEntitySchema, ledgerOwner, snapshotPageSchema, syncBatchSchema, syncPageSchema } from '../domain/ledger.ts';
import type { LedgerItem, SyncBatch } from '../domain/ledger.ts';
import { scaledSchema, utcSchema, uuidSchema } from '../domain/primitives.ts';
import { DomainError } from './errors.ts';
import { batchSupplements, catalogRevision, ledgerSources } from './ledger-records.ts';
import { readConsistent } from './read-model.ts';

const retentionMs = 30 * 86400000;
const cursorFields = { version: z.literal(1), ownerId: uuidSchema, restoreEpoch: uuidSchema, catalogRevision: fingerprintSchema, issuedAt: utcSchema };
const deltaCursorSchema = z.strictObject({ ...cursorFields, kind: z.literal('sync'), after: scaledSchema });
const snapshotCursorSchema = z.strictObject({ ...cursorFields, kind: z.literal('snapshot'), dataRevision: scaledSchema, source: z.string().max(80), after: z.string().max(100) });
const cursorSchema = z.discriminatedUnion('kind', [deltaCursorSchema, snapshotCursorSchema]);
type Cursor = z.infer<typeof cursorSchema>;
function encode(cursor: Cursor): string { return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(cursor: string, owner: string, epoch: string, now: Date): Cursor {
  let value: Cursor;
  try {
    if (!/^[A-Za-z0-9_-]{1,4000}$/.test(cursor)) throw new Error();
    value = cursorSchema.parse(JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))));
    if (value.ownerId !== owner) throw new Error();
  } catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'syncCursor' }); }
  if (value.restoreEpoch !== epoch || now.getTime() - new Date(value.issuedAt).getTime() > retentionMs || new Date(value.issuedAt).getTime() > now.getTime() + 300000) throw new DomainError('SYNC_CURSOR_EXPIRED', 410, { reason: 'epochOrAge' });
  return value;
}
function expired(reason: string): never { throw new DomainError('SYNC_CURSOR_EXPIRED', 410, { reason }); }
async function consistentLedger<T>(db: D1Database, owner: string, read: (revision: number, catalog: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const catalog = await catalogRevision(db);
    const result = await readConsistent(db, owner, revision => read(revision, catalog));
    if (catalog === await catalogRevision(db)) return result.data;
  }
  throw new DomainError('TEMPORARY_FAILURE', 503);
}
const legacyChangeSchema = z.strictObject({ entity: entityRefSchema, deleted: z.boolean(), value: z.unknown() });
async function decodeBatch(db: D1Database, owner: string, row: Record<string, unknown>): Promise<SyncBatch> {
  try {
    const entries = z.array(legacyChangeSchema).min(1).max(300).parse(JSON.parse(String(row.changes_json)));
    const changes = entries.map(entry => {
      const value = ledgerEntitySchema.parse({ kind: entry.entity.type, value: entry.value });
      if (value.value.id !== entry.entity.id || value.value.revision !== entry.entity.revision || value.value.ownerId !== owner || entry.deleted !== (value.value.deletedAt !== null)) throw new Error('Mismatched stored change');
      return value;
    });
    const revision = scaledSchema.parse(row.data_revision), operationId = uuidSchema.parse(row.operation_id);
    const supplements = await batchSupplements(db, owner, revision, operationId);
    if (supplements.some(item => ledgerOwner(item) !== owner)) throw new Error('Mismatched supplement owner');
    return syncBatchSchema.parse({ dataRevision: revision, operationId, source: row.source, originThreadId: row.origin_thread_id, createdAt: row.created_at, events: JSON.parse(String(row.events_json)), changes, supplements });
  } catch { throw new DomainError('TEMPORARY_FAILURE', 503, { reason: 'invalidStoredSyncBatch' }); }
}
export async function readSync(db: D1Database, owner: string, epoch: string, query: { cursor: string; limit: number }, clock: () => Date = () => new Date()) {
  uuidSchema.parse(owner); uuidSchema.parse(epoch); z.number().int().min(1).max(100).parse(query.limit);
  const now = clock(), cursor = decode(query.cursor, owner, epoch, now);
  if (cursor.kind !== 'sync') throw new DomainError('INVALID_INPUT', 400, { reason: 'syncCursorKind' });
  return consistentLedger(db, owner, async (revision, catalog) => {
    if (catalog !== cursor.catalogRevision) expired('catalogChanged');
    if (cursor.after > revision) expired('revisionRegressed');
    const rows = (await db.prepare('SELECT data_revision,operation_id,source,origin_thread_id,changes_json,events_json,created_at FROM change_batches WHERE owner_id=? AND data_revision>? AND data_revision<=? AND created_at>=? ORDER BY data_revision LIMIT ?').bind(owner, cursor.after, revision, new Date(now.getTime() - retentionMs).toISOString(), query.limit).all<Record<string, unknown>>()).results;
    if (rows.length !== Math.min(query.limit, revision - cursor.after) || rows.some((row, index) => row.data_revision !== cursor.after + index + 1)) expired('missingBatches');
    const items = await Promise.all(rows.map(row => decodeBatch(db, owner, row))), after = items.at(-1)?.dataRevision ?? cursor.after;
    return syncPageSchema.parse({ schemaVersion: 1, ownerId: owner, restoreEpoch: epoch, dataRevision: revision, catalogRevision: catalog, capturedAt: now.toISOString(), fromRevision: cursor.after, items, hasMore: after < revision,
      nextCursor: encode({ version: 1, kind: 'sync', ownerId: owner, restoreEpoch: epoch, catalogRevision: catalog, issuedAt: now.toISOString(), after }) });
  });
}
export async function readSyncSnapshot(db: D1Database, owner: string, epoch: string, query: { cursor?: string; limit: number }, clock: () => Date = () => new Date()) {
  uuidSchema.parse(owner); uuidSchema.parse(epoch); z.number().int().min(1).max(100).parse(query.limit);
  const now = clock(), cursor = query.cursor ? decode(query.cursor, owner, epoch, now) : null;
  if (cursor && (cursor.kind !== 'snapshot' || !ledgerSources.some(source => source.kind === cursor.source))) throw new DomainError('INVALID_INPUT', 400, { reason: 'snapshotCursorKind' });
  return consistentLedger(db, owner, async (revision, catalog) => {
    if (cursor && (cursor.kind !== 'snapshot' || cursor.dataRevision !== revision || cursor.catalogRevision !== catalog)) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'snapshotChanged' });
    const items: LedgerItem[] = [];
    let position: { source: string; after: string } | null = null, more = false;
    for (const source of ledgerSources) {
      if (cursor && source.kind < cursor.source) continue;
      const rows = await source.read(db, owner, cursor && source.kind === cursor.source ? cursor.after : '', query.limit + 1 - items.length);
      for (const row of rows) {
        if (items.length === query.limit) { more = true; break; }
        items.push(row.item); position = { source: source.kind, after: row.position };
      }
      if (more) break;
    }
    const base = { version: 1 as const, ownerId: owner, restoreEpoch: epoch, catalogRevision: catalog, issuedAt: cursor?.issuedAt ?? now.toISOString() };
    return snapshotPageSchema.parse({ schemaVersion: 1, ownerId: owner, restoreEpoch: epoch, dataRevision: revision, catalogRevision: catalog, capturedAt: base.issuedAt, items,
      nextCursor: more && position ? encode({ ...base, kind: 'snapshot', dataRevision: revision, ...position }) : null,
      syncCursor: more ? null : encode({ ...base, kind: 'sync', after: revision, issuedAt: now.toISOString() }) });
  });
}
