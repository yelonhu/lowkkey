import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { environment, root } from './environment.mjs';
const child = spawn(process.execPath, ['scripts/launcher.mjs', 'dev'], { cwd: root, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
let healthy = false;
const startedAt = performance.now(), deadline = startedAt + 45000;
try {
  // M1's module runner took ~25s on this host after the storage phase (<1s).
  // Bound elapsed time explicitly, including each health request's timeout.
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Development launcher exited before becoming healthy');
    try { const response = await fetch('http://127.0.0.1:5173/healthz', { signal: AbortSignal.timeout(500) }); healthy = response.ok && (await response.json()).status === 'ok'; } catch { /* Startup is still pending. */ }
    if (healthy) break;
    await delay(250);
  }
  if (!healthy) throw new Error('Development health check timed out');
} finally {
  child.kill('SIGTERM');
  const result = await Promise.race([closed, delay(8000).then(() => null)]);
  writeFileSync('.logs/dev-smoke.log', output);
  if (result === null) { child.kill('SIGKILL'); throw new Error('Development launcher failed to exit gracefully'); }
  writeFileSync('.artifacts/dev-smoke.json', JSON.stringify({ at: new Date().toISOString(), healthy, elapsedMs: Math.round(performance.now() - startedAt), ...result }, null, 2));
}
console.log('Development launcher served health and exited on SIGTERM.');
