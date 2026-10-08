import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { environment, root } from './environment.mjs';

process.chdir(root);
const config = 'wrangler.showroom-beta.json';
const settings = JSON.parse(readFileSync(config, 'utf8'));
if (settings.name !== 'lowkkey-showroom-beta' || settings.d1_databases[0].database_name !== 'lowkkey-showroom-beta' || settings.d1_databases[0].migrations_dir !== 'db/showroom-migrations' || settings.vars.AUTH_MODE !== 'customer') throw new Error('Unexpected release target');
const credentials = Object.fromEntries(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
const env = environment({ ...credentials, NODE_ENV: 'production', LOWKKEY_WRANGLER_CONFIG: config });
const [command, ...args] = process.argv.slice(2);
const secretsFile = '.local/config/showroom-beta.secrets.json';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function run(argv, extra = {}) {
  const child = spawnSync(process.execPath, argv, { env, stdio: 'inherit', ...extra });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
const wrangler = (...args) => run(['node_modules/wrangler/bin/wrangler.js', ...args, '--config', config]);
function provisioned() {
  if (!/^[\da-f-]{36}$/.test(settings.d1_databases[0].database_id) || !/^[\da-f]{32}$/.test(settings.kv_namespaces[0].id)) throw new Error('Provision new D1 and KV; replace release config placeholders first');
  const legacy = JSON.parse(readFileSync('wrangler.json', 'utf8'));
  if (legacy.d1_databases.some(db => db.database_id === settings.d1_databases[0].database_id) || legacy.kv_namespaces.some(kv => kv.id === settings.kv_namespaces[0].id)) throw new Error('Release must not use legacy storage');
}
switch (command) {
  case 'login': wrangler('login', '--browser=false', '--scopes', 'account:read', 'user:read', 'workers:write', 'workers_kv:write', 'workers_scripts:write', 'd1:write'); break;
  case 'whoami': wrangler('whoami'); break;
  case 'resources': wrangler('d1', 'list', '--json'); wrangler('kv', 'namespace', 'list'); break;
  case 'create-d1': wrangler('d1', 'create', settings.d1_databases[0].database_name, '--update-config=false'); break;
  case 'create-kv': wrangler('kv', 'namespace', 'create', 'lowkkey-showroom-beta-oauth', '--update-config=false'); break;
  case 'init-secrets': {
    if (existsSync(secretsFile)) throw new Error('Secrets file already exists; it will not be overwritten');
    writeFileSync(secretsFile, JSON.stringify({ BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, null, 2) + '\n', { mode: 0o600 });
    console.log('Created ignored, private secrets file. Fill Google credentials locally; do not paste them into chat.');
    break;
  }
  case 'migrate': provisioned(); wrangler('d1', 'migrations', 'apply', 'DB', '--remote'); break;
  case 'invite': {
    provisioned();
    if (args.length !== 1) throw new Error('Usage: ./scripts/release invite EMAIL');
    run(['scripts/invite.mjs', 'add', args[0], config, '--remote']); break;
  }
  case 'build': run(['node_modules/vite/bin/vite.js', 'build']); break;
  case 'deploy': {
    provisioned();
    if (git('status', '--porcelain')) throw new Error('Commit the release before deployment so /healthz identifies the exact source');
    if (!existsSync(secretsFile)) throw new Error('Run init-secrets and configure Google credentials first');
    const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
    if (Object.keys(secrets).some(key => !['BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].includes(key)) || typeof secrets.BETTER_AUTH_SECRET !== 'string' || secrets.BETTER_AUTH_SECRET.length < 32 || typeof secrets.GOOGLE_CLIENT_ID !== 'string' || !secrets.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com') || typeof secrets.GOOGLE_CLIENT_SECRET !== 'string' || !secrets.GOOGLE_CLIENT_SECRET) throw new Error('Incomplete or unexpected release secrets');
    chmodSync(secretsFile, 0o600);
    const sha = git('rev-parse', 'HEAD');
    run(['node_modules/vite/bin/vite.js', 'build']);
    // The Vite plugin generates the worker entrypoint and asset paths here.
    const generated = JSON.parse(readFileSync('.wrangler/deploy/config.json', 'utf8'));
    run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', '.wrangler/deploy/' + generated.configPath, '--secrets-file', secretsFile, '--tag', sha.slice(0, 12)]);
    console.log('Published commit ' + sha + ' at ' + settings.vars.APP_ORIGIN);
    break;
  }
  case 'status': {
    for (const path of ['/healthz', '/api/auth/config', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await fetch(settings.vars.APP_ORIGIN + path);
      console.log(path, response.status, await response.text());
    }
    break;
  }
  default: console.log('Usage: ./scripts/release login|whoami|resources|create-d1|create-kv|init-secrets|migrate|invite EMAIL|build|deploy|status');
}
