import { z } from 'zod';

export const localeSchema = z.enum(['zh-Hans', 'zh-Hant', 'en']);
export type Locale = z.infer<typeof localeSchema>;
export const uuidSchema = z.uuid({ version: 'v4' });
export const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const scaledSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const decimalSchema = z.string().max(40).regex(/^\d+(?:\.\d+)?$/);
export const unitSchema = z.enum(['kg', 'lb']);
export const loadSemanticsSchema = z.enum(['external_total', 'per_side', 'added_weight', 'assistance', 'bodyweight_only', 'unspecified']);
export const sourceKindSchema = z.enum(['manual', 'assistant_explicit', 'imported_text', 'imported_image', 'photo', 'copied', 'system']);
export const utcSchema = z.string().datetime({ offset: false, precision: 3 });
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const timezoneSchema = z.string().refine(value => {
  if (/^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid IANA timezone');
export const rpeSchema = z.number().min(1).max(10).multipleOf(0.5);
export const entityMetadataSchema = z.strictObject({
  id: uuidSchema, ownerId: uuidSchema, revision: revisionSchema,
  createdAt: utcSchema, updatedAt: utcSchema, deletedAt: utcSchema.nullable(),
});

export function localDateAt(now: Date, timezone: string): string {
  timezoneSchema.parse(timezone);
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === kind)?.value;
  return localDateSchema.parse(`${part('year')}-${part('month')}-${part('day')}`);
}

export function addDays(date: string, days: number): string {
  localDateSchema.parse(date);
  if (!Number.isSafeInteger(days)) throw new Error('INVALID_DAY_OFFSET');
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return localDateSchema.parse(instant.toISOString().slice(0, 10));
}

export function validateOccurrence(value: { timePrecision: 'date' | 'instant'; occurredAt: string | null }, ctx: z.RefinementCtx) {
  if ((value.timePrecision === 'date') !== (value.occurredAt === null)) {
    ctx.addIssue({ code: 'custom', path: ['occurredAt'], message: 'Date-only requires null; instant requires a timestamp' });
  }
}

export function validateActualDate(value: { localDate: string; occurredAt: string | null }, timezone: string, now: Date) {
  localDateSchema.parse(value.localDate);
  if (value.localDate > localDateAt(now, timezone)) throw new Error('FUTURE_ACTUAL_DATE');
  if (value.occurredAt !== null && new Date(utcSchema.parse(value.occurredAt)).getTime() > now.getTime() + 300_000) throw new Error('CAPTURE_CLOCK_SKEW');
}
