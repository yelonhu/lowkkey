import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { connect } from 'node:net';
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const baseline = JSON.parse(readFileSync('.artifacts/baseline.json', 'utf8'));
const global = Object.fromEntries(Object.keys(baseline.global).map(name => {
  const file = path.join(process.env.HOME, name);
  return [name, existsSync(file) ? { sha256: hash(file), mode: statSync(file).mode } : null];
}));
const probe = JSON.parse(readFileSync('.artifacts/environment-probe.json', 'utf8'));
const unit = JSON.parse(readFileSync('.artifacts/m1/vitest.json', 'utf8'));
const browser = JSON.parse(readFileSync('.artifacts/playwright-results.json', 'utf8'));
const operations = readFileSync('.logs/processes.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line));
const lingering = operations.filter(event => {
  try { process.kill(-event.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
});
const portClosed = await new Promise(resolve => {
  const socket = connect({ host: '127.0.0.1', port: 5173 });
  socket.on('connect', () => { socket.destroy(); resolve(false); });
  socket.on('error', error => resolve(error.code === 'ECONNREFUSED'));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
const result = { at: new Date().toISOString(), lockUnchanged: hash('package-lock.json') === baseline.originalLockHash, globalConfigurationUnchanged: JSON.stringify(global) === JSON.stringify(baseline.global), unitTestsPassed: unit.numPassedTests, unitTestsFailed: unit.numFailedTests, browserPassed: browser.stats.expected, browserFailed: browser.stats.unexpected, probePassed: probe.failures.length === 0, lingeringProcessGroups: lingering, devPortClosed: portClosed, fileTraceStatus: 'requires separate privileged fs_usage evidence review', valEnv: 'pending-file-trace' };
writeFileSync('.artifacts/clean-verification.json', JSON.stringify(result, null, 2));
console.log(result);
if (!result.lockUnchanged || !result.globalConfigurationUnchanged || result.unitTestsFailed || result.browserFailed || !result.probePassed || lingering.length || !portClosed) process.exit(1);
