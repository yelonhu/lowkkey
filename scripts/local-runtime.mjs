import { Miniflare } from 'miniflare';
export function localRuntime(persist = false, directory = '.data/dev') {
  return new Miniflare({
    modules: true, script: 'export default {fetch(){return new Response("local storage probe")}}', compatibilityDate: '2026-07-30',
    cf: false, host: '127.0.0.1', d1Databases: { DB: '00000000-0000-0000-0000-000000000000' }, r2Buckets: ['MEDIA', 'BACKUPS'],
    d1Persist: persist ? `${directory}/v3/d1` : false, r2Persist: persist ? `${directory}/v3/r2` : false,
    outboundService: () => { throw new Error('External network disabled'); },
  });
}
