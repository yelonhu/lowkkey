import { normalizeManualDecimal } from '../../domain/numbers.ts';
import { mealNoteInputSchema, rawNutrientKeys } from '../../domain/nutrition.ts';
import type { Meal } from '../../domain/nutrition.ts';

export function noteFields(record?: Meal): Record<string, string> {
  return { description: record?.note?.description ?? '', ...Object.fromEntries(rawNutrientKeys.map(key => [key, record?.note?.nutrients[key] ?? ''])), mealType: record?.mealType ?? 'unspecified',
    time: record?.occurredAt ? new Intl.DateTimeFormat('en-GB', { timeZone: record.entryTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(record.occurredAt)) : '',
    estimated: record?.note?.nutrientSnapshot.estimated ? 'yes' : 'no', dirty: 'no', targetBinding: '' };
}
export function parseNote(fields: Record<string, string>, confirmed = false) {
  return mealNoteInputSchema.parse({ description: fields.description, nutrients: Object.fromEntries(rawNutrientKeys.map(key => [key, fields[key].trim() ? normalizeManualDecimal(fields[key]) : null])), estimated: fields.estimated === 'yes', confirmLargePortion: confirmed });
}
/** Never choose one of two repeated DST wall times, or normalize a missing time. */
export function noteOccurrence(date: string, time: string, timezone: string, previous?: Meal) {
  if (!time) return { occurredAt: null, timePrecision: 'date' as const };
  if (previous?.occurredAt && previous.localDate === date && noteFields(previous).time === time) return { occurredAt: previous.occurredAt, timePrecision: 'instant' as const };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('TIME');
  const wanted = Date.parse(date + 'T' + time + ':00.000Z');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const local = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant)), part = (key: string) => parts.find(value => value.type === key)!.value;
    return Date.parse(part('year') + '-' + part('month') + '-' + part('day') + 'T' + part('hour') + ':' + part('minute') + ':' + part('second') + '.000Z');
  };
  const offsets = new Set([-36, -12, 0, 12, 36].map(hours => { const instant = wanted + hours * 3600000; return local(instant) - instant; }));
  const matches = [...offsets].map(offset => wanted - offset).filter(instant => local(instant) === wanted);
  if (matches.length !== 1 || matches[0] > Date.now() + 300000) throw Error('TIME');
  return { occurredAt: new Date(matches[0]).toISOString(), timePrecision: 'instant' as const };
}
