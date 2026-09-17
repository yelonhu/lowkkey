import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { parseLocalConfig } from '../src/server/config.ts';
import { root } from './environment.mjs';

export function readConfiguration(directory = root, inherited = process.env) {
  for (const name of readdirSync(directory)) {
    if ((name.startsWith('.env.') && name !== '.env.example') || name.startsWith('.dev.vars')) throw new Error('Only the root .env is allowed');
  }
  const filename = path.join(directory, '.env');
  let values = {};
  if (existsSync(filename)) {
    if ((statSync(filename).mode & 0o077) !== 0) throw new Error('.env must have mode 0600');
    values = parse(readFileSync(filename));
  }
  for (const name of ['APP_ENV', 'AI_MODE', 'EMAIL_MODE']) {
    if (inherited[name]) parseLocalConfig({ ...values, [name]: inherited[name] });
  }
  if (inherited.CLOUDFLARE_ENV || inherited.CLOUDFLARE_API_BASE_URL || inherited.WRANGLER_CONFIG) throw new Error('Cloud CLI overrides are unavailable in M0');
  return parseLocalConfig(values);
}
export function validateBindings(config) {
  if (config.account_id || config.routes || config.route || config.env || config.workers_dev !== false || config.preview_urls !== false) throw new Error('Cloud targets are unavailable in M0');
  if (config.main !== 'src/server/worker.ts' || config.name !== 'veyra-m0-local') throw new Error('Unexpected Worker configuration');
  for (const entry of config.d1_databases ?? []) if (entry.remote !== false || entry.database_id !== '00000000-0000-0000-0000-000000000000') throw new Error('Remote D1 rejected');
  for (const entry of config.r2_buckets ?? []) if (entry.remote !== false || !['veyra-local-media', 'veyra-local-backups'].includes(entry.bucket_name)) throw new Error('Remote R2 rejected');
  if (Object.keys(config).some(key => !['name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls', 'assets', 'd1_databases', 'r2_buckets', 'observability'].includes(key))) throw new Error('Unsupported binding or configuration');
}
