import { addDays, localDateAt, localDateSchema, timezoneSchema } from './primitives.ts';

export function effectiveTimezone(base: string, pending: string | null, effectiveDate: string | null, now: Date) {
  return pending && effectiveDate && localDateAt(now, base) >= effectiveDate ? pending : base;
}
export function localNoon(date: string, timezone: string): Date {
  localDateSchema.parse(date); timezoneSchema.parse(timezone);
  const wanted = Date.parse(`${date}T12:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = wanted;
  for (let tries = 0; tries < 4; tries++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (key: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === key)!.value;
    const seen = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.000Z`);
    if (seen === wanted) return new Date(instant);
    instant += wanted - seen;
  }
  throw new Error('LOCAL_DATE_UNAVAILABLE');
}
export function nextNoon(now: Date, timezone: string) {
  let date = localDateAt(now, timezone);
  for (let day = 0; day < 4; day++, date = addDays(date, 1)) {
    try { const noon = localNoon(date, timezone); if (noon > now) return noon.toISOString(); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'LOCAL_DATE_UNAVAILABLE') throw error; }
  }
  throw new Error('NO_VALID_DIGEST_DATE');
}

// Find the calendar transition in the old timezone. This also handles a zone
// skipping midnight or an entire calendar date; no fixed UTC offset is assumed.
export function dateBoundary(date: string, timezone: string): Date {
  localDateSchema.parse(date); timezoneSchema.parse(timezone);
  const center = Date.parse(`${date}T00:00:00.000Z`);
  let low = center - 2 * 86400000, high = center + 2 * 86400000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDateAt(new Date(mid), timezone) >= date) high = mid; else low = mid;
  }
  return new Date(high);
}
export function nextProfileNoon(now: Date, base: string, pending: string | null, effectiveDate: string | null) {
  if (!pending || !effectiveDate) return nextNoon(now, base);
  const boundary = dateBoundary(effectiveDate, base);
  if (now >= boundary) return nextNoon(now, pending);
  const candidate = nextNoon(now, base);
  return new Date(candidate) < boundary ? candidate : nextNoon(new Date(boundary.getTime() - 1), pending);
}
