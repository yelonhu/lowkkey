import { fork,spawn } from 'node:child_process';
import { once } from 'node:events';
const port=Number(process.env.LOWKKEY_OAUTH_TEST_PORT??5183);
const server=fork('scripts/serve.mjs',['--e2e'],{env:{...process.env,LOWKKEY_E2E_PORT:String(port)},stdio:['inherit','inherit','inherit','ipc']});
let child;
async function stop(){child?.kill('SIGTERM');if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try{
  const ready=await Promise.race([once(server,'message'),once(server,'exit').then(()=>{throw new Error('OAuth test server exited');})]);
  if(!ready[0]?.isolated)throw new Error('Expected isolated D1');
  child=spawn(process.execPath,['tests/oauth-mcp.e2e.mjs'],{env:{...process.env,LOWKKEY_TEST_ORIGIN:`http://127.0.0.1:${port}`},stdio:'inherit'});
  const [code]=await once(child,'exit');process.exitCode=code??1;
}finally{await stop();}
