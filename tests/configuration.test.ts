import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { parseLocalConfig, publicConfig } from '../src/server/config.ts';
import { readConfiguration, validateBindings } from '../scripts/configuration.mjs';
import { environment } from '../scripts/environment.mjs';
import bindings from '../wrangler.json';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true }); });
function temp() { mkdirSync('.tmp', { recursive: true }); const directory = mkdtempSync('.tmp/config-'); directories.push(directory); return directory; }
describe('local configuration and secret boundaries', () => {
  it('parses shell metacharacters literally', () => {
    const content = 'MODEL_API_KEY="$(touch NEVER_EXECUTE) `id`\nsecond line"\nCLOUDFLARE_API_TOKEN=VEYRA_CANARY_DEPLOY_SECRET';
    expect(parse(content).MODEL_API_KEY).toBe('$(touch NEVER_EXECUTE) `id`\nsecond line');
    const directory = temp(); writeFileSync(`${directory}/.env`, content, { mode: 0o600 });
    const config = readConfiguration(directory, {}); expect(config.AI_MODE).toBe('mock');
    expect(JSON.stringify(config)).not.toContain('CANARY'); expect(JSON.stringify(publicConfig(config))).not.toContain('MODEL_API_KEY');
    expect(Object.keys(publicConfig(config)).sort()).toEqual(['APP_ENV', 'APP_ORIGIN', 'DEFAULT_LOCALE']);
  });
  it('rejects unsafe file permissions and additional dotenv files', () => {
    const directory = temp(); writeFileSync(`${directory}/.env`, 'APP_ENV=development', { mode: 0o600 }); chmodSync(`${directory}/.env`, 0o644);
    expect(() => readConfiguration(directory, {})).toThrow('0600'); chmodSync(`${directory}/.env`, 0o600);
    writeFileSync(`${directory}/.env.production`, ''); expect(() => readConfiguration(directory, {})).toThrow('Only the root');
  });
  it.each([{ APP_ENV: 'production' }, { APP_ENV: 'staging' }, { AI_MODE: 'live' }, { EMAIL_MODE: 'live' }, { EMAIL_MODE: 'allowlist' }, { APP_ORIGIN: 'https://production.example' }])('rejects unsupported config %j', value => expect(() => parseLocalConfig(value)).toThrow('M0_LOCAL_CONFIGURATION_REJECTED'));
  it('rejects inherited cloud overrides and production selection', () => { const directory = temp(); expect(() => readConfiguration(directory, { APP_ENV: 'production' })).toThrow(); expect(() => readConfiguration(directory, { CLOUDFLARE_ENV: 'production' })).toThrow(); });
  it('does not inherit tokens, NODE_OPTIONS, or entire process.env', () => {
    const clean = environment();
    for (const key of ['MODEL_API_KEY', 'RESEND_API_KEY', 'CLOUDFLARE_API_TOKEN', 'NODE_OPTIONS', 'NODE_PATH']) expect(clean).not.toHaveProperty(key);
    expect(clean.HOME).toBe(process.env.HOME); expect(clean.CODEX_HOME).toBe(process.env.CODEX_HOME);
  });
  it('rejects remote bindings and unexpected Worker configuration', () => {
    expect(() => validateBindings(bindings)).not.toThrow();
    for (const candidate of [{ ...bindings, account_id: 'real-account' }, { ...bindings, workers_dev: true }, { ...bindings, services: [{ binding: 'REMOTE' }] }, { ...bindings, d1_databases: [{ ...bindings.d1_databases[0], remote: true }] }]) expect(() => validateBindings(candidate)).toThrow();
  });
});
