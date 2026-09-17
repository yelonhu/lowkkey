import { cpSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { environment, root } from './environment.mjs';
const directory = mkdtempSync(`${root}/.tmp/checksum-probe-`);
mkdirSync(`${directory}/scripts`); mkdirSync(`${directory}/.cache`);
cpSync('scripts/bootstrap-inner', `${directory}/scripts/bootstrap-inner`);
writeFileSync(`${directory}/.cache/node-v24.21.0-darwin-arm64.tar.gz`, 'deliberately incorrect archive');
// Already inside the project fence; no additional sandbox or network required.
const result = spawnSync('/bin/sh', [`${directory}/scripts/bootstrap-inner`], { env: environment(), encoding: 'utf8' });
const rejected = result.status === 1 && result.stderr.includes('Node checksum mismatch') && !existsSync(`${directory}/.toolchain/node-v24.21.0-darwin-arm64`);
writeFileSync('.artifacts/bootstrap-negative.json', JSON.stringify({ at: new Date().toISOString(), checksumMismatchRejected: rejected, exitCode: result.status }, null, 2));
if (!rejected) throw new Error('Checksum rejection was not proven');
console.log('Corrupt Node archive rejected before extraction or execution.');
