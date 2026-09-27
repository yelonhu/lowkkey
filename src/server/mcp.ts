import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { EntryDraft, VerifierId } from '@lowkkey/protocol';
import { derive, sessions } from '@lowkkey/core';
import type { D1Database } from '@cloudflare/workers-types';
import * as store from './v1-store.ts';

type Principal={ownerId:string;clientId:string;scopes:string[]};
const response=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:{result:value}});
const clock={capturedAt:z.iso.datetime({offset:true}),capturedLocalDate:z.iso.date(),timeZone:z.string().min(1).max(80)};

export async function mcpResponse(request:Request,db:D1Database,principal:Principal):Promise<Response>{
  const server=new McpServer({name:'lowkkey',version:'1.0.0'});
  const can=(scope:string)=>principal.scopes.includes(scope);
  if(can('read')){
    server.registerTool('get_state',{title:'读取状态',description:'读取本人账本和 V1–V10 派生值，结论包含规则版本、公式、输入条目 ID 与计算日期。',inputSchema:{from:z.iso.date().optional(),to:z.iso.date().optional()}},async({from,to})=>{
      const data=await store.state(db,principal.ownerId);
      return response({...data,entries:data.entries.filter(e=>(!from||e.date>=from)&&(!to||e.date<=to))});
    });
    server.registerTool('get_history',{title:'读取动作历史',description:'读取本人的有效训练组。',inputSchema:{exerciseId:z.string(),limit:z.number().int().min(1).max(50).default(10)}},async({exerciseId,limit})=>{
      const data=await store.state(db,principal.ownerId);
      return response(sessions(data.entries).filter(session=>session.sets.some(set=>set.exerciseId===exerciseId)).sort((a,b)=>b.date.localeCompare(a.date)||(b.startedAt??'').localeCompare(a.startedAt??'')).slice(0,limit).map(session=>({sessionId:session.id,date:session.date,sets:session.sets.filter(set=>set.exerciseId===exerciseId)})));
    });
    server.registerTool('run_verifiers',{title:'运行验证器',description:'运行 V1–V10，返回可追溯派生值。',inputSchema:{ids:z.array(VerifierId).optional(),asOf:z.iso.date().optional()}},async({ids,asOf})=>{
      const data=await store.state(db,principal.ownerId);
      const values=asOf?derive({...data,today:asOf}):data.derived;
      return response(Object.fromEntries(Object.entries(values).filter(([,value])=>!ids||ids.includes(value.rule))));
    });
    server.registerTool('list_inbox',{title:'读取收件箱',description:'读取本人待确认批次、闸门、计划提议与触发器。',inputSchema:{}},async()=>{
      const data=await store.state(db,principal.ownerId);
      return response({submissions:data.submissions,held:data.held,proposals:data.proposals.filter(p=>p.status==='open'),triggers:data.triggers.filter(t=>t.status==='pending'||t.status==='will_fire')});
    });
  }
  if(can('submit'))server.registerTool('propose_entries',{title:'提交待审记录',description:'提交模型解析草稿。只进入用户收件箱；用户一次确认后才原子入账。捕获时钟在重试时保持不变。',inputSchema:{idempotencyKey:z.uuid(),rawText:z.string().min(1).max(4000),entries:z.array(EntryDraft).min(1).max(100),...clock}},async({idempotencyKey,rawText,entries,capturedAt,capturedLocalDate,timeZone})=>response(await store.submitModelEntries(db,principal.ownerId,principal.clientId,idempotencyKey,rawText,entries,{capturedAt,capturedLocalDate,timeZone})));
  if(can('propose'))server.registerTool('propose_change',{title:'提出计划修改',description:'提交待用户决策的计划建议，不直接更改计划。',inputSchema:{idempotencyKey:z.uuid(),title:z.string().max(80),rationale:z.string().max(1000),ruleRefs:z.array(VerifierId).default([]),patch:z.record(z.string(),z.unknown())}},async({idempotencyKey,...value})=>response(await store.createProposal(db,principal.ownerId,principal.clientId,idempotencyKey,{kind:'program_change',...value},{actor:'model',channel:'mcp',client:principal.clientId})));
  const transport=new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(request);
}
