import type { D1Database } from '@cloudflare/workers-types';
import type { z } from 'zod';
import type { EntityRef } from '../domain/artifacts.ts';
import { eventFields } from '../domain/events.ts';
import type { CommandContext, CommandPlan, EntityChange, Snapshot, SqlValue } from './commands.ts';
import { DomainError } from './errors.ts';

export type OwnedRecord = Snapshot & { id: string; ownerId: string; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; operationId: string; createdOperationId: string };
type Columns<T> = { [K in keyof T]: string };
export class RecordStore<T extends OwnedRecord> {
  readonly select: string;
  readonly keys: Array<keyof T>;
  constructor(readonly table: string, readonly type: EntityRef['type'], readonly schema: z.ZodType<T>, readonly columns: Columns<T>, readonly jsonKeys: readonly (keyof T)[] = [], readonly booleanKeys: readonly (keyof T)[] = [], readonly complexEvents: Partial<Record<keyof T, string>> = {}) {
    this.keys = Object.keys(columns) as Array<keyof T>;
    this.select = `SELECT ${this.keys.map(key => `${columns[key]} AS ${String(key)}`).join(',')} FROM ${table}`;
  }
  decode(row: Record<string, unknown>): T {
    const value = { ...row };
    for (const key of this.jsonKeys) if (value[String(key)] !== null) value[String(key)] = JSON.parse(String(value[String(key)]));
    for (const key of this.booleanKeys) if (value[String(key)] !== null) value[String(key)] = value[String(key)] === 1;
    return this.schema.parse(value);
  }
  async read(db: D1Database, ownerId: string, id: string, includeDeleted = false): Promise<T> {
    const row = await db.prepare(`${this.select} WHERE owner_id=? AND id=?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).bind(ownerId, id).first<Record<string, unknown>>();
    if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
    return this.decode(row);
  }
  async list(db: D1Database, ownerId: string, predicate = '1', values: SqlValue[] = [], order = 'created_at,id'): Promise<T[]> {
    const rows = await db.prepare(`${this.select} WHERE owner_id=? AND deleted_at IS NULL AND (${predicate}) ORDER BY ${order}`).bind(ownerId, ...values).all<Record<string, unknown>>();
    return rows.results.map(row => this.decode(row));
  }
  plan(context: CommandContext, before: T | null, after: T): CommandPlan {
    this.schema.parse(after);
    if (after.ownerId !== context.auth.id) throw new Error('Invalid command owner');
    const changes: EntityChange['changes'] = [];
    const allowed: readonly string[] = eventFields[this.type];
    for (const key of this.keys) {
      const previous = before?.[key] ?? null, next = after[key];
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      const complex = this.complexEvents[key];
      if (complex) changes.push({ field: complex, before: before?.revision ?? null, after: after.revision });
      else if (allowed.includes(this.columns[key]) && (next === null || typeof next !== 'object') && (previous === null || typeof previous !== 'object')) changes.push({ field: this.columns[key], before: previous, after: next });
    }
    const values = this.keys.map(key => {
      const value = after[key];
      return value === null ? null : this.jsonKeys.includes(key) ? JSON.stringify(value) : typeof value === 'boolean' ? Number(value) : value as SqlValue;
    });
    return {
      guards: [before
        ? { predicate: `EXISTS(SELECT 1 FROM ${this.table} WHERE owner_id=? AND id=? AND revision=?)`, values: [after.ownerId, after.id, before.revision], error: new DomainError('REVISION_CONFLICT', 409) }
        : { predicate: `NOT EXISTS(SELECT 1 FROM ${this.table} WHERE id=?)`, values: [after.id], error: new DomainError('DUPLICATE_CANDIDATE', 409) }],
      statements: [before
        ? context.db.prepare(`UPDATE ${this.table} SET ${this.keys.map(key => `${this.columns[key]}=?`).join(',')} WHERE owner_id=? AND id=?`).bind(...values, after.ownerId, after.id)
        : context.db.prepare(`INSERT INTO ${this.table}(${this.keys.map(key => this.columns[key]).join(',')}) VALUES (${this.keys.map(() => '?').join(',')})`).bind(...values)],
      entities: [{ type: this.type, before, after, action: before === null ? 'created' : after.deletedAt !== null ? 'deleted' : before.deletedAt !== null ? 'restored' : 'updated', changes }], result: { id: after.id }, undoable: true,
    };
  }
}
export const recordColumns = { id: 'id', ownerId: 'owner_id', revision: 'revision', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at', operationId: 'operation_id', createdOperationId: 'created_operation_id' } as const;
export function newMetadata(context: CommandContext, id: string) { return { id, ownerId: context.auth.id, revision: 1, createdAt: context.now, updatedAt: context.now, deletedAt: null, operationId: context.operationId, createdOperationId: context.operationId }; }
export function reviseRecord<T extends OwnedRecord>(before: T, context: CommandContext, changes: Partial<T>): T { return { ...before, ...changes, revision: before.revision + 1, updatedAt: context.now, operationId: context.operationId }; }
export function mergePlans(plans: CommandPlan[], result: Snapshot, undoable = true): CommandPlan { return { guards: plans.flatMap(plan => plan.guards), statements: plans.flatMap(plan => plan.statements), entities: plans.flatMap(plan => plan.entities), result, undoable }; }
export function expectRevision(record: { revision: number }, revision: number) { if (record.revision !== revision) throw new DomainError('REVISION_CONFLICT', 409, { currentRevision: record.revision }); }
