import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { environment, root } from './environment.mjs';
import { readConfiguration } from './configuration.mjs';
if (existsSync('.env')) throw new Error('Use an empty local environment for the synthetic secret build; an existing .env is never overwritten.');
const fixture = 'MODEL_API_KEY="VEYRA_CANARY_MODEL_SECRET $(touch .tmp/env-evaluated) `id`\nsecond line"\nCLOUDFLARE_API_TOKEN=VEYRA_CANARY_DEPLOY_SECRET\n';
writeFileSync('.env', fixture, { flag: 'wx', mode: 0o600 });
try {
  const config = readConfiguration();
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: root, env: environment({ ...config, NODE_ENV: 'production' }), encoding: 'utf8' });
  writeFileSync('.logs/secret-build.log', (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0) throw new Error('Synthetic secret build failed; see sanitized project log');
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) scan(filename);
      else if (/VEYRA_CANARY_(MODEL|DEPLOY)_SECRET/.test(readFileSync(filename, 'utf8'))) throw new Error('SECRET_CANARY_LEAK');
    }
  }
  scan('.artifacts/build'); scan('.logs'); scan('.artifacts/mail-preview');
  if (existsSync('.tmp/env-evaluated')) throw new Error('DOTENV_EXECUTION_DETECTED');
  writeFileSync('.artifacts/secret-build.json', JSON.stringify({ at: new Date().toISOString(), buildPassed: true, noCanaryInArtifactsOrLogs: true, noCommandSubstitution: true }, null, 2));
  console.log('Synthetic root .env build passed; no secret canaries or command execution.');
} finally {
  if (readFileSync('.env', 'utf8') !== fixture) throw new Error('The synthetic .env changed concurrently; retained for review.');
  unlinkSync('.env');
}
