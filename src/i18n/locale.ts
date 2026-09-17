import { localeSchema } from '../domain/primitives.ts';
import type { Locale } from '../domain/primitives.ts';
export function detectLocale(preferences: readonly string[], saved?: string | null): Locale {
  const stored = localeSchema.safeParse(saved);
  if (stored.success) return stored.data;
  for (const raw of preferences) {
    let locale: Intl.Locale;
    try { locale = new Intl.Locale(raw); } catch { continue; }
    if (locale.language === 'en') return 'en';
    if (locale.language !== 'zh') continue;
    if (locale.script === 'Hans') return 'zh-Hans';
    if (locale.script === 'Hant') return 'zh-Hant';
    if (['TW', 'HK', 'MO'].includes(locale.region ?? '')) return 'zh-Hant';
    if (!locale.region || ['CN', 'SG'].includes(locale.region)) return 'zh-Hans';
  }
  return 'en';
}
export const formatNumber = (value: number, locale: Locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 6, useGrouping: false }).format(value);
export const formatDate = (date: Date, locale: Locale, timeZone: string) => new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'short', day: 'numeric' }).format(date);
