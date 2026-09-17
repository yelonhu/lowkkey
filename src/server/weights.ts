import type { D1Database } from '@cloudflare/workers-types';
import type { z } from 'zod';
import { weightInputSchema } from '../domain/contracts.ts';
import { createWeightSchema, patchWeightSchema, storedWeightSchema, validateWeightDate } from '../domain/weight.ts';
import type { Weight } from '../domain/weight.ts';
import { normalizeMass } from '../domain/numbers.ts';
import { localDateSchema, revisionSchema, uuidSchema } from '../domain/primitives.ts';
import { pageAfter, pageResult } from './pagination.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan, EntityChange, Guard, SqlValue } from './commands.ts';
import { DomainError } from './errors.ts';

const columns = {
  id: 'id', ownerId: 'owner_id', revision: 'revision', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at',
  localDate: 'local_date', entryTimezone: 'entry_timezone', occurredAt: 'occurred_at', timePrecision: 'time_precision', value: 'value_decimal', unit: 'unit', kgMicros: 'kg_micros',
  condition: 'condition', isPrimary: 'is_primary', sourceKind: 'source_kind', sourceRef: 'source_ref', operationId: 'operation_id', createdOperationId: 'created_operation_id',
} as const;
export const weightSelect = `SELECT ${Object.entries(columns).map(([key, column]) => `${column} AS ${key}`).join(',')} FROM weight_entries`;
const select = weightSelect;
export function decodeWeight(row: Record<string, unknown>): Weight { return storedWeightSchema.parse({ ...row, isPrimary: row.isPrimary === 1 }); }
const decode = decodeWeight;
export async function readWeight(db: D1Database, ownerId: string, id: string, includeDeleted = false) {
  const row = await db.prepare(`${select} WHERE owner_id=? AND id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).bind(ownerId, id).first<Record<string, unknown>>();
  if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
  return decode(row);
}
export async function listWeights(db: D1Database, ownerId: string, from: string, to: string): Promise<Weight[]> {
  const rows = await db.prepare(`${select} WHERE owner_id=? AND local_date>=? AND local_date<=? AND deleted_at IS NULL ORDER BY local_date,COALESCE(occurred_at,created_at),created_at,id`).bind(ownerId, from, to).all<Record<string, unknown>>();
  return rows.results.map(decode);
}
export async function latestPrimaryWeight(db: D1Database, owner: string, date: string) {
  localDateSchema.parse(date);
  const row = await db.prepare(`${select} WHERE owner_id=? AND local_date<=? AND is_primary=1 AND deleted_at IS NULL ORDER BY local_date DESC,id LIMIT 1`).bind(owner, date).first<Record<string, unknown>>();
  return row ? decode(row) : null;
}
export async function weightPage(db: D1Database, owner: string, from: string, to: string, query: { limit: number; cursor?: string }) {
  const binding = { from, to }, after = pageAfter(owner, 'weight_entry', binding, query.cursor);
  const rows = await db.prepare(`${select} WHERE owner_id=? AND local_date BETWEEN ? AND ? AND deleted_at IS NULL AND (? IS NULL OR id>?) ORDER BY id LIMIT ?`).bind(owner, from, to, after, after, query.limit + 1).all<Record<string, unknown>>();
  return pageResult(rows.results.map(decode), query.limit, owner, 'weight_entry', binding);
}
function versionGuard(before: Weight): Guard {
  return { predicate: 'EXISTS(SELECT 1 FROM weight_entries WHERE owner_id=? AND id=? AND revision=?)', values: [before.ownerId, before.id, before.revision], error: new DomainError('REVISION_CONFLICT', 409) };
}
function fieldChanges(before: Weight | null, after: Weight): EntityChange['changes'] {
  const fields = ['localDate', 'occurredAt', 'timePrecision', 'value', 'unit', 'kgMicros', 'condition', 'isPrimary', 'deletedAt'] as const;
  return fields.filter(key => (before?.[key] ?? null) !== after[key]).map(key => ({ field: columns[key], before: before?.[key] ?? null, after: after[key] }));
}
function weightPlan(context: CommandContext, pairs: Array<{ before: Weight | null; after: Weight }>, result: CommandPlan['result'], guards: Guard[] = []): CommandPlan {
  const { db, auth } = context;
  const keys = Object.keys(columns) as Array<keyof Weight>;
  const values = (weight: Weight): SqlValue[] => keys.map(key => typeof weight[key] === 'boolean' ? Number(weight[key]) : weight[key] as SqlValue);
  for (const pair of pairs) storedWeightSchema.parse(pair.after);
  return {
    guards: [...guards, ...pairs.map(pair => pair.before ? versionGuard(pair.before) : { predicate: 'NOT EXISTS(SELECT 1 FROM weight_entries WHERE id=?)', values: [pair.after.id], error: new DomainError('DUPLICATE_CANDIDATE', 409) })],
    // Release affected primary slots only inside the transaction before assigning
    // final values. Readers never observe an intermediate day without a primary.
    statements: [db.prepare(`UPDATE weight_entries SET is_primary=0 WHERE owner_id=? AND id IN (${pairs.map(() => '?').join(',')})`).bind(auth.id, ...pairs.map(pair => pair.after.id)),
      ...pairs.map(pair => pair.before
        ? db.prepare(`UPDATE weight_entries SET ${keys.map(key => `${columns[key]}=?`).join(',')} WHERE owner_id=? AND id=?`).bind(...values(pair.after), auth.id, pair.after.id)
        : db.prepare(`INSERT INTO weight_entries(${keys.map(key => columns[key]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...values(pair.after)))],
    entities: pairs.map(pair => ({ type: 'weight_entry', ...pair, action: pair.before === null ? 'created' : pair.after.deletedAt !== null ? 'deleted' : pair.before.deletedAt !== null ? 'restored' : 'updated', changes: fieldChanges(pair.before, pair.after) })),
    result, undoable: true,
  };
}
function revise(weight: Weight, context: CommandContext, change: Partial<Weight>): Weight {
  return { ...weight, ...change, revision: weight.revision + 1, updatedAt: context.now, operationId: context.operationId };
}
type Confirmation = Pick<z.infer<typeof createWeightSchema>, 'primaryChoice' | 'expectedPrimary' | 'confirmedOutlier' | 'outlierReference'>;
async function checkOutlier(context: CommandContext, next: Weight, confirmation: Confirmation) {
  const previous = await context.db.prepare(`${select} WHERE owner_id=? AND local_date<=? AND id<>? AND is_primary=1 AND deleted_at IS NULL ORDER BY local_date DESC,COALESCE(occurred_at,created_at) DESC,id LIMIT 1`).bind(context.auth.id, next.localDate, next.id).first<Record<string, unknown>>();
  if (!previous) return;
  const reference = decode(previous);
  if (Math.abs(next.kgMicros - reference.kgMicros) * 100 <= reference.kgMicros * 5) return;
  if (!confirmation.confirmedOutlier || confirmation.outlierReference?.id !== reference.id || confirmation.outlierReference.revision !== reference.revision) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'weightOutlier', referenceId: reference.id, referenceRevision: reference.revision });
}
function inputFields(value: Record<string, unknown>) { return Object.fromEntries(Object.keys(weightInputSchema.shape).map(key => [key, value[key]])); }
async function writeWeight(context: CommandContext, next: Weight, before: Weight | null, confirmation: Confirmation): Promise<CommandPlan> {
  try { validateWeightDate(weightInputSchema.parse(inputFields(next)), context.auth.timezone, new Date(context.now)); }
  catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'actualDate' }); }
  if (!before || before.value !== next.value || before.unit !== next.unit || before.localDate !== next.localDate) await checkOutlier(context, next, confirmation);
  const sameDay = await listWeights(context.db, context.auth.id, next.localDate, next.localDate);
  const primary = sameDay.find(entry => entry.isPrimary && entry.id !== next.id);
  const pairs: Array<{ before: Weight | null; after: Weight }> = [];
  if (primary && (!before || before.localDate !== next.localDate || confirmation.primaryChoice === 'replace')) {
    if (!confirmation.primaryChoice) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'sameDayPrimary', primaryId: primary.id, primaryRevision: primary.revision });
    if (confirmation.primaryChoice === 'replace') {
      if (confirmation.expectedPrimary?.id !== primary.id || confirmation.expectedPrimary.revision !== primary.revision) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'primaryChanged' });
      pairs.push({ before: primary, after: revise(primary, context, { isPrimary: false }) }); next.isPrimary = true;
    } else next.isPrimary = false;
  } else if (!primary) next.isPrimary = true;
  if (before?.isPrimary && before.localDate !== next.localDate) {
    const replacement = (await listWeights(context.db, context.auth.id, before.localDate, before.localDate)).find(entry => entry.id !== before.id);
    if (replacement) pairs.push({ before: replacement, after: revise(replacement, context, { isPrimary: true }) });
  }
  pairs.push({ before, after: next });
  return weightPlan(context, pairs, { id: next.id, primaryEntryId: next.isPrimary ? next.id : primary?.id ?? null, replacementPrimaryId: pairs.find(pair => pair.after.localDate === before?.localDate && pair.after.id !== next.id && pair.after.isPrimary)?.after.id ?? null });
}

export async function createWeight(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = createWeightSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'weight.create', payload: input, entryPoint: 'weights.create', plan: async context => {
    const facts = weightInputSchema.parse(inputFields(input));
    const next: Weight = { ...facts, kgMicros: normalizeMass(facts.value, facts.unit, 1, 500).kgMicros, ownerId: auth.id, revision: 1, createdAt: context.now, updatedAt: context.now, deletedAt: null, isPrimary: false, sourceKind: 'manual', sourceRef: null, operationId, createdOperationId: operationId };
    return writeWeight(context, next, null, input);
  } }, clock);
}
export async function patchWeight(db: D1Database, auth: AuthContext, operationId: string, id: string, expectedRevision: number, payload: unknown, clock?: () => Date) {
  uuidSchema.parse(id); revisionSchema.parse(expectedRevision);
  const input = patchWeightSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'weight.update', payload: { id, ...input }, expectedRevision, entryPoint: 'weights.update', plan: async context => {
    const before = await readWeight(db, auth.id, id);
    if (before.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 409, { currentRevision: before.revision });
    const facts = weightInputSchema.parse(inputFields({ ...before, ...input }));
    return writeWeight(context, revise(before, context, { ...facts, kgMicros: normalizeMass(facts.value, facts.unit, 1, 500).kgMicros }), before, input);
  } }, clock);
}
export async function deleteWeight(db: D1Database, auth: AuthContext, operationId: string, id: string, expectedRevision: number, clock?: () => Date) {
  uuidSchema.parse(id); revisionSchema.parse(expectedRevision);
  return executeCommand(db, auth, { operationId, kind: 'weight.delete', payload: { id }, expectedRevision, entryPoint: 'weights.delete', plan: async context => {
    const before = await readWeight(db, auth.id, id);
    if (before.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 409, { currentRevision: before.revision });
    const pairs = [{ before, after: revise(before, context, { deletedAt: context.now, isPrimary: false }) }];
    const replacement = before.isPrimary ? (await listWeights(db, auth.id, before.localDate, before.localDate)).find(entry => entry.id !== id) : undefined;
    if (replacement) pairs.push({ before: replacement, after: revise(replacement, context, { isPrimary: true }) });
    return weightPlan(context, pairs, { id, replacementPrimaryId: replacement?.id ?? null });
  } }, clock);
}

export async function undoWeight(db: D1Database, auth: AuthContext, operationId: string, originalId: string, clock?: () => Date) {
  uuidSchema.parse(originalId);
  return executeCommand(db, auth, { operationId, kind: 'weight.undo', payload: { originalId }, entryPoint: 'operations.undo', plan: async context => {
    const operation = await db.prepare('SELECT kind,undo_until,undone_by FROM command_operations WHERE owner_id=? AND operation_id=?').bind(auth.id, originalId).first<{ kind: string; undo_until: string | null; undone_by: string | null }>();
    if (!operation || !operation.kind.startsWith('weight.')) throw new DomainError('RECORD_NOT_FOUND', 404);
    if (!operation.undo_until || operation.undo_until < context.now || operation.undone_by) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'undoUnavailable' });
    const revisions = (await db.prepare('SELECT target_id,before_snapshot,after_revision FROM operation_revisions WHERE owner_id=? AND operation_id=? AND target_type=\'weight_entry\'').bind(auth.id, originalId).all<{ target_id: string; before_snapshot: string | null; after_revision: number }>()).results;
    const pairs: Array<{ before: Weight; after: Weight }> = [];
    for (const saved of revisions) {
      const current = await readWeight(db, auth.id, saved.target_id, true);
      if (current.revision !== saved.after_revision) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'laterEdit' });
      const prior = saved.before_snapshot ? storedWeightSchema.parse(JSON.parse(saved.before_snapshot)) : null;
      pairs.push({ before: current, after: revise(current, context, prior ?? { deletedAt: context.now, isPrimary: false }) });
    }
    // A later independent extra entry may now need to become primary.
    for (const date of new Set(pairs.flatMap(pair => [pair.before.localDate, pair.after.localDate]))) {
      const saved = await listWeights(db, auth.id, date, date);
      const final = [...saved.filter(entry => !pairs.some(pair => pair.after.id === entry.id)), ...pairs.map(pair => pair.after).filter(entry => entry.localDate === date && !entry.deletedAt)];
      if (final.filter(entry => entry.isPrimary).length > 1) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'primaryChanged' });
      if (final.length && !final.some(entry => entry.isPrimary)) {
        final.sort((a, b) => (a.occurredAt ?? a.createdAt).localeCompare(b.occurredAt ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        const replacement = final[0], existing = pairs.find(pair => pair.after.id === replacement.id);
        if (existing) existing.after.isPrimary = true;
        else pairs.push({ before: replacement, after: revise(replacement, context, { isPrimary: true }) });
      }
    }
    const plan = weightPlan(context, pairs, { originalId }, [{ predicate: 'EXISTS(SELECT 1 FROM command_operations WHERE owner_id=? AND operation_id=? AND undone_by IS NULL AND undo_until>=?)', values: [auth.id, originalId, context.now], error: new DomainError('REVISION_CONFLICT', 409) }]);
    return { ...plan, undoable: false, undoOf: originalId };
  } }, clock);
}
