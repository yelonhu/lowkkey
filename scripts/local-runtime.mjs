import { Miniflare } from 'miniflare';
export function localRuntime(directory = '.data/showroom') {
  return new Miniflare({
    modules: true, script: 'export default {fetch(){return new Response("probe")}}',
    compatibilityDate: '2026-07-30', cf: false, host: '127.0.0.1',
    d1Databases: { DB: '33333333-3333-4333-8333-333333333333' },
    d1Persist: `${directory}/v3/d1`,
    outboundService: () => { throw new Error('External network disabled'); },
  });
}
