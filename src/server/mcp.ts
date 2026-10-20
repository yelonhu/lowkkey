import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MCP_INSTRUCTIONS, MCP_PROMPTS, MCP_TOOLS, mcpToolList, mcpOutput, PROTOCOL_VERSION } from '@lowkkey/protocol';
import type { D1Database } from '@cloudflare/workers-types';
import * as store from './store.ts';
import { readNotes, saveNote } from './notes.ts';
import { toolSuccess,event } from './lifecycle.ts';
import { StoreError } from './account.ts';

type Principal = { ownerId: string; clientId: string; scopes: string[] };
// Schema metadata is identical for every account. Generate it once per isolate;
// transports, handlers and permission filtering remain request-local.
const toolDescriptors = mcpToolList();
const registeredTools = MCP_TOOLS.map(tool => ({
  ...tool,
  descriptor: toolDescriptors.find(item => item.name === tool.name)!,
  output: mcpOutput(tool.name),
}));
const rawInput = z.looseObject({});
const response = (value: unknown, view_url?: string) => {
  const structuredContent = { result: value, ...(view_url ? { view_url } : {}) };
  return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
};
export async function mcpResponse(request: Request, db: D1Database, principal: Principal): Promise<Response> {
  const success = async (name:string,value:unknown,url?:string,activates=false) => {
    try { await toolSuccess(db,principal.ownerId,principal.clientId,name,url,activates); } catch { console.error('MCP_PROGRESS_FAILED'); }
    return response(value,url);
  };
  const origin = new URL(request.url).origin;
  const server = new McpServer({
    name: 'lowkkey', title: 'lowkkey', version: PROTOCOL_VERSION,
    description: 'Your training, plans and everyday notes, kept together.',
    websiteUrl: origin,
    icons: [{ src: `${origin}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
  }, { instructions: MCP_INSTRUCTIONS, capabilities:{tools:{},prompts:{}} });
  const view = (screen: string, key: string, value: string) => `${new URL(request.url).origin}/#${screen}?${key}=${encodeURIComponent(value)}`;
  // Prompts are plain user messages; they carry the keeper role regardless of how the host treats instructions.
  if (principal.scopes.includes('read')) for (const prompt of MCP_PROMPTS) {
    const argsSchema = Object.fromEntries(prompt.arguments.map(argument => [argument.name, z.string().describe(argument.description)]));
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema }, (args) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.text((args ?? {}) as Record<string,string>) } }],
    }));
  }
  for (const tool of registeredTools) {
    if (!principal.scopes.includes(tool.scope)||(tool.scope==='notes:write'&&!principal.scopes.includes('read'))) continue;
    const descriptor = tool.descriptor;
    server.registerTool(tool.name, {
      title: tool.title, description: tool.description, inputSchema: rawInput, outputSchema: tool.output,
      annotations: descriptor.annotations, _meta: descriptor._meta,
    }, async (args: unknown) => {
      try {
        // Validate here to return structured field paths, not an SDK-only text error.
        args = tool.input.parse(args);
        switch (tool.name) {
          case 'log_session': { const saved = await store.logSession(db, principal.ownerId, args); return success(tool.name,saved,view('log','date',saved.date),saved.sets.length>0); }
          case 'log_weight': { const saved = await store.logWeight(db, principal.ownerId, args); return success(tool.name,saved,view('body','date',saved.date),true); }
          case 'set_plan': { const saved = await store.setPlan(db, principal.ownerId, args); return success(tool.name,saved,view('next','title',saved?.title??(args as {title:string}).title),!!saved?.items.length); }
          case 'set_profile': return success(tool.name,await store.setProfile(db, principal.ownerId, args),new URL(request.url).origin+'/#body');
          case 'curate': { const saved=await store.curate(db,principal.ownerId,args); return success(tool.name,saved,view('recap','week',saved.week)); }
          case 'delete': { const saved=await store.deleteFact(db,principal.ownerId,args); return success(tool.name,saved,view(saved.kind==='session'?'log':'body','date',saved.date)); }
          case 'write_note': { const input=args as {date:string;text:string;revision:number};const saved=await saveNote(db,principal.ownerId,input.date,{text:input.text,revision:input.revision});return success(tool.name,saved,view('notes','date',saved.date),!!saved.text); }
          case 'read_notes': return success(tool.name,await readNotes(db,principal.ownerId,args));
          case 'get_brief': return success(tool.name,await store.brief(db,principal.ownerId,args,new Date(),principal.scopes.filter((s):s is 'read'|'write'|'notes:write'=>s==='read'||s==='write'||s==='notes:write')));
        }
      } catch (cause) {
        const error = cause instanceof StoreError ? { code: cause.code, fields:cause.fields } : cause instanceof z.ZodError
          ? { code: 'invalid_arguments', fields: cause.issues.map(issue => ({ path: issue.path, message: issue.message })) }
          : { code: 'operation_failed' };
        await event(db,principal.ownerId,'tool_failed',tool.name+':'+error.code).catch(()=>{});
        return { ...response({ error }), isError: true };
      }
    });
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDescriptors
    .filter(tool => principal.scopes.includes(MCP_TOOLS.find(item => item.name === tool.name)!.scope)&&(tool.name!=='write_note'||principal.scopes.includes('read')))
    .map(tool => ({ ...tool, inputSchema: tool.inputSchema as Tool['inputSchema'], outputSchema: tool.outputSchema as Tool['outputSchema'] })) }));
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); } finally { await server.close(); }
}
