import { describe, expect, it, vi } from 'vitest';
import { detectLocale, formatDate, formatNumber } from '../src/i18n/locale.ts';
import { makeI18n } from '../src/i18n/index.ts';
import { resources } from '../src/i18n/resources.ts';
import { checkLocales } from '../scripts/locale-check.mjs';

describe('three language foundation', () => {
  it.each([
    [['zh-Hans-TW'], 'zh-Hans'], [['zh-Hant-CN'], 'zh-Hant'], [['fr', 'zh-HK'], 'zh-Hant'], [['zh-SG'], 'zh-Hans'],
    [['en-GB', 'zh-TW'], 'en'], [['fr'], 'en'], [['zh'], 'zh-Hans'], [['invalid_tag', 'zh-MO'], 'zh-Hant'],
  ] as const)('matches %j to %s', (languages, expected) => expect(detectLocale(languages)).toBe(expected));
  it('gives saved preferences priority', () => expect(detectLocale(['en-US'], 'zh-Hant')).toBe('zh-Hant'));
  it('checks complete keys and interpolation parameters', () => {
    expect(() => checkLocales(resources)).not.toThrow();
    const broken = structuredClone(resources); Reflect.deleteProperty(broken['zh-Hans'].common, 'title');
    expect(() => checkLocales(broken)).toThrow('LOCALE_KEYS');
    const badParameter = structuredClone(resources); badParameter['zh-Hant'].common.formatted = '{{wrong}}';
    expect(() => checkLocales(badParameter)).toThrow('LOCALE_PARAMS');
  });
  it('falls back to readable English without showing technical keys', () => {
    const i18n = makeI18n('zh-Hans');
    i18n.removeResourceBundle('zh-Hans', 'common');
    expect(i18n.t('title')).toBe(resources.en.common.title);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(i18n.t('missing.key')).toBe('Unavailable'); expect(log).toHaveBeenCalledWith('I18N_MISSING_KEY', 'common', 'missing.key'); log.mockRestore();
  });
  it('keeps formatting independent from units and the caller timezone', () => {
    for (const locale of ['zh-Hans', 'zh-Hant', 'en'] as const) { expect(formatNumber(34.3, locale)).toBe('34.3'); expect(formatDate(new Date('2026-09-16T02:00:00Z'), locale, 'America/Chicago')).toContain('15'); }
  });
});
