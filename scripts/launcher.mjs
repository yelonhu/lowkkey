import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { environment, root } from './environment.mjs';
import { readConfiguration, validateBindings } from './configuration.mjs';

process.chdir(root);
const command = process.argv[2] ?? 'help';
const commands = {
  dev: [['scripts/serve.mjs']],
  check: [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/eslint/bin/eslint.js', 'src', 'db', 'tests'], ['scripts/check.mjs']],
  test: [['node_modules/vitest/vitest.mjs', 'run']],
  'test:e2e': [['node_modules/playwright/cli.js', 'test']],
  build: [['node_modules/vite/bin/vite.js', 'build'], ['scripts/scan-build.mjs']],
  'migrate:local': [['scripts/migrate.mjs']],
  'schema:generate': [['node_modules/drizzle-kit/bin.cjs', 'generate']],
  'probe:env': [['scripts/probe.mjs']],
  'verify:secrets': [['scripts/verify-secret-build.mjs']],
  'verify:bootstrap': [['scripts/probe-bootstrap.mjs']],
  'verify:dev': [['scripts/verify-dev.mjs']],
};
if (command === 'help') {
  console.log(`lowkkey local commands: ${Object.keys(commands).join(', ')}\nNot implemented: deploy:staging, deploy:production, backup, restore:drill`);
  process.exit(0);
}
if (!(command in commands) || process.argv.length > 3) { console.error('Command unavailable in this milestone (no work performed).'); process.exit(64); }
let env;
try {
  const configuration = readConfiguration();
  validateBindings(JSON.parse(readFileSync('wrangler.json', 'utf8')));
  env = environment({ ...configuration, NODE_ENV: command === 'build' ? 'production' : 'development' });
} catch { console.error('Local configuration rejected. Check the local environment and binding policy.'); process.exit(1); }
for (const args of commands[command]) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', detached: true });
  appendFileSync('.logs/processes.jsonl', JSON.stringify({ at: new Date().toISOString(), launcherPid: process.pid, pid: child.pid, command }) + '\n');
  const stop = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
  const result = await new Promise(resolve => { child.on('error', () => resolve(1)); child.on('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1))); });
  stop('SIGTERM');
  process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate);
  if (result !== 0) process.exit(result);
}
