import { writeFileSync, unlinkSync, existsSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import path from 'node:path';
import { environment, root } from './environment.mjs';
const target = `/private/tmp/veyra-denied-${process.pid}`;
const failures = [];
function denyWrite(filename) {
  try { writeFileSync(filename, 'isolation probe', { flag: 'wx' }); failures.push('WRITE_BOUNDARY_BROKEN'); }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; }
}
denyWrite(target);
const link = path.join(root, '.tmp/escape-probe');
if (existsSync(link)) unlinkSync(link);
symlinkSync('/private/tmp', link);
try { denyWrite(path.join(link, path.basename(target))); } finally { unlinkSync(link); }
const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {writeFileSync} from 'node:fs';try{writeFileSync(${JSON.stringify(target)},'probe',{flag:'wx'});process.exit(2)}catch(e){process.exit(['EPERM','EACCES'].includes(e.code)?0:3)}`], { env: environment() });
if (child.status !== 0) failures.push('CHILD_BOUNDARY_BROKEN');
const externalDenied = await new Promise(resolve => {
  const socket = connect({ host: '1.1.1.1', port: 443 });
  socket.on('connect', () => { socket.destroy(); resolve(false); });
  socket.on('error', error => resolve(['EPERM', 'EACCES'].includes(error.code)));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
if (!externalDenied) failures.push('NETWORK_DENIAL_UNPROVEN');
const result = { at: new Date().toISOString(), platform: process.platform, architecture: process.arch, node: process.version, deniedOutsideWrite: !existsSync(target), childRestricted: child.status === 0, deniedExternalNetwork: externalDenied, homePreserved: environment().HOME === process.env.HOME, codexHomePreserved: environment().CODEX_HOME === process.env.CODEX_HOME, failures };
writeFileSync('.artifacts/environment-probe.json', JSON.stringify(result, null, 2));
console.log(readFileSync('.artifacts/environment-probe.json', 'utf8'));
if (failures.length) process.exit(1);
