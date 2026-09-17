import { namespaces } from '../src/i18n/resources.ts';
export function checkLocales(resources) {
  for (const locale of ['zh-Hans', 'zh-Hant', 'en']) {
    if (JSON.stringify(Object.keys(resources[locale]).sort()) !== JSON.stringify([...namespaces].sort())) throw new Error('LOCALE_NAMESPACES');
    for (const namespace of namespaces) {
      const reference = resources.en[namespace];
      const target = resources[locale][namespace];
      if (JSON.stringify(Object.keys(reference).sort()) !== JSON.stringify(Object.keys(target).sort())) throw new Error(`LOCALE_KEYS ${locale}/${namespace}`);
      for (const key of Object.keys(reference)) {
        const parameters = value => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]).sort();
        if (typeof target[key] !== 'string' || target[key].trim() === '') throw new Error('LOCALE_EMPTY');
        if (JSON.stringify(parameters(reference[key])) !== JSON.stringify(parameters(target[key]))) throw new Error(`LOCALE_PARAMS ${locale}/${namespace}/${key}`);
      }
    }
  }
}
