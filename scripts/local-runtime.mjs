import { Miniflare } from 'miniflare';
export function localRuntime(directory = '.data/v02') {
  return new Miniflare({
    modules: true, script: 'export default {fetch(){return new Response("probe")}}',
    compatibilityDate: '2026-07-30', cf: false, host: '127.0.0.1',
    d1Databases: { DB: '11111111-1111-4111-8111-111111111111' },
    d1Persist: `${directory}/v3/d1`,
    outboundService: () => { throw new Error('External network disabled'); },
  });
}
