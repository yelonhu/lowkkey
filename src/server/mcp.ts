import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { MCP_TOOLS, mcpToolList, mcpOutput } from '@lowkkey/protocol';
import { derive, sessions } from '@lowkkey/core';
import type { D1Database } from '@cloudflare/workers-types';
import * as store from './v1-store.ts';
import { StoreError } from './account.ts';
import { reviewDetail,reviewURL } from './review.ts';
import reviewApp from './review-app.html?raw';

type Principal={ownerId:string;clientId:string;scopes:string[]};
type ToolName=typeof MCP_TOOLS[number]['name'];
function input<N extends ToolName>(name:N,value:unknown){return MCP_TOOLS.find(t=>t.name===name)!.input.parse(value) as z.infer<Extract<typeof MCP_TOOLS[number],{name:N}>['input']>;}
const response=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:{result:value}});
function page<T extends {id:string}>(rows:T[],cursor:string|undefined,limit:number){const start=cursor?rows.findIndex(row=>row.id===cursor)+1:0;if(cursor&&start===0)throw new StoreError('invalid_cursor',400);const items=rows.slice(start,start+limit);return {items,nextCursor:start+limit<rows.length?items.at(-1)?.id??null:null};}
export async function mcpResponse(request:Request,db:D1Database,principal:Principal):Promise<Response>{
  const server=new McpServer({name:'lowkkey',version:'1.1.0'}),origin=new URL(request.url).origin;
  if(principal.scopes.includes('read'))server.registerResource('review','ui://lowkkey/review.html',{mimeType:'text/html;profile=mcp-app',description:'训练提案与处理结果。确认由用户在 lowkkey 中完成。'},async()=>({contents:[{uri:'ui://lowkkey/review.html',mimeType:'text/html;profile=mcp-app',text:reviewApp,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}]}));
  for(const tool of MCP_TOOLS){
    if(!principal.scopes.includes(tool.scope))continue;
    const descriptor=mcpToolList().find(t=>t.name===tool.name)!;
    server.registerTool(tool.name,{title:tool.title,description:tool.description,inputSchema:tool.input,outputSchema:mcpOutput(tool.name),annotations:descriptor.annotations,_meta:{securitySchemes:[{type:'oauth2',scopes:[tool.scope]}],...(tool.name==='get_review'?{ui:{resourceUri:'ui://lowkkey/review.html'}}:{})}},async (args:unknown)=>{
      try{
        switch(tool.name){
          case 'get_state':{const {from,to,limit,cursor}=input(tool.name,args);if(from&&to&&from>to)throw new StoreError('bad_request',400);const data=await store.state(db,principal.ownerId);const result=page(data.entries.filter(e=>(!from||e.date>=from)&&(!to||e.date<=to)).slice().reverse(),cursor,limit);return response({...data,entries:result.items,nextCursor:result.nextCursor,serverTime:new Date().toISOString()});}
          case 'get_history':{const {exerciseId,limit,cursor}=input(tool.name,args),data=await store.state(db,principal.ownerId);const rows=sessions(data.entries).filter(s=>s.sets.some(set=>set.exerciseId===exerciseId)).sort((a,b)=>b.date.localeCompare(a.date)||(b.startedAt??'').localeCompare(a.startedAt??'')||b.id.localeCompare(a.id)).map(s=>({id:s.id,sessionId:s.id,date:s.date,startedAt:s.startedAt,endedAt:s.endedAt,sets:s.sets.filter(set=>set.exerciseId===exerciseId)}));return response(page(rows,cursor,limit));}
          case 'run_verifiers':{const {ids,asOf}=input(tool.name,args),data=await store.state(db,principal.ownerId),values=asOf?derive({...data,today:asOf}):data.derived;return response(Object.fromEntries(Object.entries(values).filter(([,value])=>!ids||ids.includes(value.rule))));}
          case 'list_inbox':{const data=await store.state(db,principal.ownerId);return response({submissions:data.submissions.map(s=>({...s,reviewUrl:reviewURL(origin,'submission',s.id)})),held:data.held.map(h=>({...h,reviewUrl:reviewURL(origin,'held',h.id)})),proposals:data.proposals.filter(p=>p.status==='open').map(p=>({...p,reviewUrl:reviewURL(origin,'proposal',p.id)})),triggers:data.triggers.filter(t=>t.status==='pending'||t.status==='will_fire')});}
          case 'list_exercises':{const {query}=input(tool.name,args),data=await store.state(db,principal.ownerId);return response(data.exercises.filter(ex=>!query||[ex.name,ex.id,...ex.aliases].some(name=>name.toLowerCase().includes(query.toLowerCase()))));}
          case 'get_review':{const {kind,id}=input(tool.name,args);return response(await reviewDetail(db,principal.ownerId,kind,id,origin));}
          case 'propose_entries':{const {idempotencyKey,rawText,entries,...clock}=input(tool.name,args);const result=await store.submitModelEntries(db,principal.ownerId,principal.clientId,idempotencyKey,rawText,entries,clock);return response({...result,reviewUrl:reviewURL(origin,'submission',result.id)});}
          case 'propose_change':{const {idempotencyKey,...value}=input(tool.name,args);const result=await store.createProposal(db,principal.ownerId,principal.clientId,idempotencyKey,{kind:'program_change',...value},{actor:'model',channel:'mcp',client:principal.clientId});return response({...result,reviewUrl:reviewURL(origin,'proposal',result.id)});}
        }
      }catch(cause){const error=cause instanceof StoreError?{code:cause.code,retryable:cause.status>=500}:cause instanceof z.ZodError?{code:'invalid_arguments',retryable:false,fields:cause.issues.map(i=>({path:i.path,message:i.message}))}:{code:'operation_failed',retryable:false};return {...response({error}),isError:true};}
    });
  }
  const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});await server.connect(transport);
  try{return await transport.handleRequest(request);}finally{await server.close();}
}
