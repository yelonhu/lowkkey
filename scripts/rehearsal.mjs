import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { environment, root } from './environment.mjs';
import { rehearsalClient } from './rehearsal/client.mjs';
import { seedShowroom, fixturePlans, fixtureSessions, fixtureToday } from './rehearsal/fixtures.mjs';

const port = Number(process.env.LOWKKEY_REHEARSAL_PORT ?? 5178), appPort = port + 1;
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Invalid local port');
const origin = `http://127.0.0.1:${port}`, app = `http://127.0.0.1:${appPort}`;
let child, client, busy = false, stopping = false;
async function stopApp() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child,'exit'); } child = null; }
async function reset() {
  await stopApp(); client = null;
  child = spawn(process.execPath,['scripts/serve.mjs','--e2e'],{cwd:root,env:environment({LOWKKEY_E2E_PORT:String(appPort)}),stdio:['inherit','inherit','inherit','ipc']});
  const ready = await new Promise((resolve,reject) => {
    const onExit = () => reject(new Error('Isolated rehearsal server failed'));
    child.once('error',reject); child.once('exit',onExit);
    child.once('message',message=>{child.off('exit',onExit);resolve(message);});
  });
  if (ready.type !== 'ready' || !ready.isolated || ready.port !== appPort) throw new Error('Expected isolated server');
  client = await rehearsalClient(appPort);
  const initial = await client.state();
  if (initial.sessions.length || initial.weights.length || initial.plans.length) throw new Error('Expected empty database');
  await seedShowroom(client.tool);
}
async function perform(task) {
  switch (task) {
    case 'reset': await reset(); return '已重置独立演练库。';
    case 'plan': await client.tool('set_plan',{...fixturePlans[0],coach:'演练更新：稳定完成三组，再考虑加重量。'}); return '计划已直接更新。';
    case 'session': await client.tool('log_session',{...fixtureSessions.at(-1),date:fixtureToday,note:'演练新记录：今天完成训练，最后一组稳稳做完。'}); return '训练已保存，重复点击不会增加第二条。';
    case 'weight': await client.tool('log_weight',{date:fixtureToday,lb:162}); return '体重已保存，均线由领域代码更新。';
    case 'brief': { const brief = await client.tool('get_brief',{}); return '简报：'+brief.sessions.length+' 个训练日；7 日均值 '+(brief.weight.mean7?.lb?.toFixed(1) ?? '—')+' lb。'; }
    default: throw new Error('Unknown action');
  }
}
const html = await readFile(new URL('./rehearsal/index.html',import.meta.url));
const server = createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return; }
  const json = (status,value) => res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html); return; }
  if (req.method === 'GET' && req.url === '/status') { json(client && !busy ? 200 : 503,client && !busy ? {app} : {error:'Starting'}); return; }
  if (req.method !== 'POST' || !req.url?.startsWith('/action/')) { json(404,{error:'Not found'}); return; }
  if (req.headers.origin !== origin) { json(403,{error:'Origin required'}); return; }
  if (busy) { json(409,{error:'Operation in progress'}); return; }
  busy = true;
  try { json(200,{message:await perform(req.url.slice('/action/'.length))}); }
  catch (error) { json(500,{error:error.message}); } finally { busy = false; }
});
async function stop(code = 0) { if (stopping) return; stopping = true; server.close(); await stopApp(); process.exit(code); }
process.on('SIGINT',()=>stop()); process.on('SIGTERM',()=>stop());
server.listen(port,'127.0.0.1'); await once(server,'listening');
try { busy = true; await reset(); busy = false; console.log('Isolated showroom rehearsal: '+origin); }
catch (error) { console.error(error); await stop(1); }
