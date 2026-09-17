import { z } from 'zod';
import { decimalSchema, entityMetadataSchema, loadSemanticsSchema, localDateSchema, revisionSchema, rpeSchema, timezoneSchema, unitSchema, utcSchema, uuidSchema, validateOccurrence } from './primitives.ts';
import { normalizeMass } from './numbers.ts';
import { dateRangeSchema } from './artifacts.ts';

const weightFields = {
  id: uuidSchema, localDate: localDateSchema, entryTimezone: timezoneSchema, occurredAt: utcSchema.nullable(),
  timePrecision: z.enum(['instant', 'date']), value: decimalSchema, unit: unitSchema,
  condition: z.enum(['fasted', 'other', 'unspecified']),
};
export const weightInputSchema = z.strictObject(weightFields).superRefine(validateOccurrence).superRefine((value, ctx) => {
  try { normalizeMass(value.value, value.unit, 1, 500); } catch { ctx.addIssue({ code: 'custom', path: ['value'], message: 'Weight out of range' }); }
});
export const weightEntitySchema = z.strictObject({ ...weightFields, ...entityMetadataSchema.shape, kgMicros: z.number().int().min(1_000_000).max(500_000_000), isPrimary: z.boolean() });
export const setInputSchema = z.strictObject({
  id: uuidSchema, sessionExerciseId: uuidSchema,
  load: z.strictObject({ value: decimalSchema, unit: unitSchema, semantics: loadSemanticsSchema.exclude(['bodyweight_only']) }).nullable(),
  reps: z.number().int().min(1).max(200), setType: z.enum(['warmup', 'work', 'backoff', 'drop', 'unknown']),
  rpe: rpeSchema.nullable(), ordinal: z.number().int().positive(), note: z.string().max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.load) try { normalizeMass(value.load.value, value.load.unit); } catch { ctx.addIssue({ code: 'custom', path: ['load'], message: 'Load out of range' }); }
});
export const profilePatchSchema = z.strictObject({ displayName: z.string().refine(value => [...value].length >= 1 && [...value].length <= 40).optional(), constraintsText: z.string().max(2000).nullable().optional() });
export const errorCodes = ['INVITATION_EXPIRED', 'MEMBER_LIMIT_REACHED', 'LAST_ADMIN_REQUIRED', 'INVALID_INPUT', 'INVALID_UNIT', 'INVALID_LOCALE', 'AUTH_REQUIRED', 'MEMBER_SUSPENDED', 'ADMIN_REQUIRED', 'RECORD_NOT_FOUND', 'REVISION_CONFLICT', 'DUPLICATE_CANDIDATE', 'DAY_STATE_CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 'DRAFT_EXPIRED', 'PROPOSAL_EXPIRED', 'SYNC_CURSOR_EXPIRED', 'NEEDS_CONFIRMATION', 'INSUFFICIENT_DATA', 'CONTEXT_STALE', 'RATE_LIMITED', 'AI_BUDGET_EXHAUSTED', 'MODEL_UNAVAILABLE', 'LEDGER_UNAVAILABLE', 'TEMPORARY_FAILURE'] as const;
export type ErrorCode = typeof errorCodes[number];
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(errorCodes), messageKey: z.string(), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(), fieldErrors: z.record(z.string(), z.array(z.string())).optional(), retryable: z.boolean() }),
  meta: z.strictObject({ requestId: z.string() }),
});
export const responseMetaSchema = z.strictObject({ requestId: z.string(), operationId: uuidSchema.optional(), revision: revisionSchema.optional(), serverTime: utcSchema, dataRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), restoreEpoch: uuidSchema, query: z.strictObject({ localDate: localDateSchema, sessionId: uuidSchema.nullable(), ranges: z.strictObject({ SessionArtifact: dateRangeSchema.optional(), WeightArtifact: dateRangeSchema.optional(), DietArtifact: dateRangeSchema.optional() }).refine(value => Object.keys(value).length > 0) }).optional() });
export const successEnvelope = <T extends z.ZodType>(data: T) => z.strictObject({ data, meta: responseMetaSchema });
export const listData = <T extends z.ZodType>(item: T) => z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
export const paginationSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().max(2048).optional() });
export function parseWriteHeaders(headers: Headers, editing: boolean) {
  const operationId = uuidSchema.parse(headers.get('Idempotency-Key'));
  if (!editing) return { operationId };
  const match = /^"([1-9]\d*)"$/.exec(headers.get('If-Match') ?? '');
  if (!match) throw new Error('INVALID_INPUT');
  return { operationId, expectedRevision: revisionSchema.parse(Number(match[1])) };
}
