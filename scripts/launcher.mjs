import { spawn } from 'node:child_process';
import { environment, root } from './environment.mjs';

process.chdir(root);
const commands = {
  dev: [['scripts/serve.mjs']],
  'preview:rehearsal': [['scripts/rehearsal.mjs']],
  'preview:empty': [['scripts/empty-preview.mjs']],
  check: [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/eslint/bin/eslint.js', '.']],
  'protocol:emit': [['packages/protocol/scripts/emit.ts']],
  test: [['node_modules/vitest/vitest.mjs', 'run']],
  build: [['node_modules/vite/bin/vite.js', 'build']],
  'test:oauth': [['scripts/test-oauth.mjs']],
  'test:e2e': [['node_modules/playwright/cli.js', 'test']],
  'migrate:local': [['scripts/migrate.mjs']],
};
const name = process.argv[2];
if (!name || name === 'help') { console.log(`lowkkey commands: ${Object.keys(commands).join(', ')}`); process.exit(0); }
if (!(name in commands) || process.argv.length > 3) { console.error('Unknown command'); process.exit(64); }
const env = environment({ NODE_ENV: name === 'build' ? 'production' : 'development' });
for (const args of commands[name]) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', detached: true });
  const stop = (signal) => { try { process.kill(-child.pid, signal); } catch { /* Already stopped. */ } };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const code = await new Promise(resolve => { child.on('error', () => resolve(1)); child.on('exit', value => resolve(value ?? 1)); });
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  if (code !== 0) process.exit(code);
}
