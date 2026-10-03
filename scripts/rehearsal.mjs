import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { environment, root } from './environment.mjs';
import { rehearsalClient } from './rehearsal/client.mjs';
import { fixtureProgram, fixtureRecords } from './rehearsal/fixtures.mjs';

const port=Number(process.env.LOWKKEY_REHEARSAL_PORT??5178),appPort=port+1;
if(!Number.isInteger(port)||port<1024||port>65534)throw new Error('Invalid local rehearsal port');
const origin=`http://127.0.0.1:${port}`,app=`http://127.0.0.1:${appPort}`;
let child,client,busy=false,pending=new Map(),stopping=false;
async function stopApp(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}child=null;}
async function reset(){
  await stopApp();client=null;
  child=spawn(process.execPath,['scripts/serve.mjs','--e2e'],{cwd:root,env:environment({LOWKKEY_E2E_PORT:String(appPort)}),stdio:['inherit','inherit','inherit','ipc']});
  const ready=await new Promise((resolve,reject)=>{
    const onExit=()=>reject(new Error('独立演练服务启动失败（请检查端口）'));
    child.once('error',reject);child.once('exit',onExit);
    child.once('message',message=>{child.off('exit',onExit);resolve(message);});
  });
  if(ready.type!=='ready'||!ready.isolated||ready.port!==appPort)throw new Error('未能验证独立演练服务');
  client=await rehearsalClient(appPort);const initial=await client.state();
  if(initial.entries.length||initial.program.days.length)throw new Error('演练要求全新空数据库');
  await client.user('/v1/program',fixtureProgram(initial),'PUT');
  const yesterday=new Date(Date.parse(`${initial.today}T12:00:00Z`)-86400000).toISOString().slice(0,10);
  const result=await client.user('/v1/entries',{entries:fixtureRecords(yesterday)});
  if(result.held?.length)throw new Error('演练初始化意外触发审阅');
  pending=new Map();
}
async function perform(task){
  if(task==='reset'){await reset();return '已重置独立演练数据库。个人数据未改变。';}
  if(!['proposal','batch'].includes(task))throw new Error('未知演练操作');
  let request=pending.get(task);
  if(!request){
    const state=await client.state();
    if(task==='proposal'){
      const days=state.program.days.map(day=>({...day,items:day.items.map((item,index)=>day.id==='rehearsal_today'&&index===1?{...item,sets:3,note:'比原安排多一组，采用后生效。'}:item)}));
      request={name:'propose_change',args:{idempotencyKey:randomUUID(),title:'胸与背：划船增加一组',rationale:'演练提案：从 2 组调整为 3 组。请比较修改前后，再决定是否采用。',patch:{days}}};
    }else{
      request={name:'propose_entries',args:{idempotencyKey:randomUUID(),rawText:'演练记录：体重与四个动作，等待你一次确认。',capturedAt:new Date().toISOString(),capturedLocalDate:state.today,timeZone:state.timezone,entries:fixtureRecords(state.today,'model')}};
    }
    pending.set(task,request);
  }
  const result=await client.tool(request.name,request.args),current=await client.state();
  if(task==='proposal'&&current.proposals.find(item=>item.id===result.id)?.status!=='open')return '这项调整已处理，可在计划中查看结果。重复点击不会新建第二项。';
  if(task==='batch'&&!current.submissions.some(item=>item.id===result.id))return '这批记录已处理，可在日志查看结果。重复点击不会重复提交。';
  return task==='proposal'?'提案已提交，尚未生效。请在首页或日志查看并采用。重复点击不会新建第二项。':'5 条记录已提交，尚未入账。请在页面一次确认，再查看图表和日志。重复点击不会重复提交。';
}
const html=await readFile(new URL('./rehearsal/index.html',import.meta.url));
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));};
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;}
  if(req.method==='GET'&&req.url==='/status'){json(client&&!busy?200:503,client&&!busy?{app}:{error:'独立演练正在启动'});return;}
  if(req.method!=='POST'||!req.url?.startsWith('/action/')){json(404,{error:'Not found'});return;}
  if(req.headers.origin!==origin){json(403,{error:'仅接受演练工具区的操作'});return;}
  if(busy){json(409,{error:'上一操作仍在进行'});return;}
  busy=true;try{json(200,{message:await perform(req.url.slice('/action/'.length))});}catch(error){json(500,{error:error.message});}finally{busy=false;}
});
async function stop(code=0){if(stopping)return;stopping=true;server.close();await stopApp();process.exit(code);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
// Bind the control port before starting a child, so duplicate launches cannot
// leave a second database/server behind.
server.listen(port,'127.0.0.1');await once(server,'listening');
try{busy=true;await reset();busy=false;console.log(`演练预览 · 测试数据: ${origin}`);}catch(error){console.error(error);await stop(1);}
