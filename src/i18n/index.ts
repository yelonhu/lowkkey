import { createInstance } from 'i18next';
import { resources, namespaces } from './resources.ts';
import type { Locale } from '../domain/primitives.ts';
export function makeI18n(locale: Locale) {
  const instance = createInstance();
  void instance.init({
    resources: structuredClone(resources), lng: locale, fallbackLng: 'en', supportedLngs: ['zh-Hans', 'zh-Hant', 'en'],
    ns: [...namespaces], defaultNS: 'common', initAsync: false, interpolation: { escapeValue: false },
    saveMissing: true, missingKeyHandler: (_languages, namespace, key) => console.warn('I18N_MISSING_KEY', namespace, key),
    parseMissingKeyHandler: () => resources.en.errors.unavailable,
  });
  return instance;
}
