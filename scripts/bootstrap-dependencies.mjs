import { spawnSync } from 'node:child_process';
import { environment, nodeBin, root } from './environment.mjs';
for (const args of [
  [`${nodeBin}/../lib/node_modules/npm/bin/npm-cli.js`, 'ci', '--no-audit', '--no-fund'],
  ['scripts/adapt-vitest.mjs'],
  ['node_modules/playwright/cli.js', 'install', 'chromium'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: environment(), stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
