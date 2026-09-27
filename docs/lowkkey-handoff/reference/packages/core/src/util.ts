import { LB_PER_KG, type LocalDate, type Unit } from '@lowkkey/protocol';

/* ── 日期（纯字符串运算，避免时区陷阱） ── */

const DAY_MS = 86_400_000;

export function dayIndex(d: LocalDate): number {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, dd) / DAY_MS);
}

export function fromDayIndex(i: number): LocalDate {
  return new Date(i * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromDayIndex(dayIndex(d) + n);
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return dayIndex(a) - dayIndex(b);
}

/** 0 = 周日 … 6 = 周六 */
export function weekday(d: LocalDate): number {
  return (dayIndex(d) + 4) % 7; // 1970-01-01 是周四
}

/** 本周一（周一为一周开始）。 */
export function weekStart(d: LocalDate): LocalDate {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

/** 用户本地「今天」。timeZone 为空时使用运行环境时区。 */
export function localToday(now: Date = new Date(), timeZone?: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/* ── 单位 ── */

export function toKg(v: number, unit: Unit): number {
  return unit === 'kg' ? v : v / LB_PER_KG;
}

export function fromKg(kg: number, unit: Unit): number {
  return unit === 'kg' ? kg : kg * LB_PER_KG;
}

export function convert(v: number, from: Unit, to: Unit): number {
  return from === to ? v : fromKg(toKg(v, from), to);
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/* ── ID（ULID 风格：时间前缀 + 随机） ── */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newId(prefix = '', now = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = new Uint8Array(10);
  globalThis.crypto.getRandomValues(rnd);
  let r = '';
  for (const b of rnd) r += B32[b % 32];
  return prefix + time + r;
}

/* ── 统计 ── */

/** 最小二乘直线拟合：返回斜率与截距（x 为日序号）。点数 < 2 或 x 全相同返回 null。 */
export function ols(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}
