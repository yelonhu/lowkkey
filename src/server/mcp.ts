import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MCP_INSTRUCTIONS, MCP_TOOLS, mcpToolList, mcpOutput, PROTOCOL_VERSION } from '@lowkkey/protocol';
import type { D1Database } from '@cloudflare/workers-types';
import * as store from './store.ts';
import { StoreError } from './account.ts';

type Principal = { ownerId: string; clientId: string; scopes: string[] };
const response = (value: unknown, view_url?: string) => {
  const structuredContent = { result: value, ...(view_url ? { view_url } : {}) };
  return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
};
export async function mcpResponse(request: Request, db: D1Database, principal: Principal): Promise<Response> {
  const server = new McpServer({ name: 'lowkkey', version: PROTOCOL_VERSION }, { instructions: MCP_INSTRUCTIONS });
  const view = (screen: string, key: string, value: string) => `${new URL(request.url).origin}/#${screen}?${key}=${encodeURIComponent(value)}`;
  for (const tool of MCP_TOOLS) {
    if (!principal.scopes.includes(tool.scope)) continue;
    const descriptor = mcpToolList().find(t => t.name === tool.name)!;
    server.registerTool(tool.name, {
      title: tool.title, description: tool.description, inputSchema: z.looseObject({}), outputSchema: mcpOutput(tool.name),
      annotations: descriptor.annotations, _meta: descriptor._meta,
    }, async (args: unknown) => {
      try {
        // Validate here to return structured field paths, not an SDK-only text error.
        args = tool.input.parse(args);
        switch (tool.name) {
          case 'log_session': { const saved = await store.logSession(db, principal.ownerId, args); return response(saved, view('log', 'date', saved.date)); }
          case 'log_weight': { const saved = await store.logWeight(db, principal.ownerId, args); return response(saved, view('body', 'date', saved.date)); }
          case 'set_plan': { const saved = await store.setPlan(db, principal.ownerId, args); return response(saved, view('next', 'title', saved?.title ?? (args as {title:string}).title)); }
          case 'set_profile': return response(await store.setProfile(db, principal.ownerId, args),new URL(request.url).origin+'/#body');
          case 'curate': { const saved=await store.curate(db,principal.ownerId,args); return response(saved,view('recap','week',saved.week)); }
          case 'delete': { const saved=await store.deleteFact(db,principal.ownerId,args); return response(saved,view(saved.kind==='session'?'log':'body','date',saved.date)); }
          case 'get_brief': return response(await store.brief(db, principal.ownerId,args));
        }
      } catch (cause) {
        const error = cause instanceof StoreError ? { code: cause.code, fields:cause.fields } : cause instanceof z.ZodError
          ? { code: 'invalid_arguments', fields: cause.issues.map(issue => ({ path: issue.path, message: issue.message })) }
          : { code: 'operation_failed' };
        return { ...response({ error }), isError: true };
      }
    });
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpToolList()
    .filter(tool => principal.scopes.includes(MCP_TOOLS.find(item => item.name === tool.name)!.scope))
    .map(tool => ({ ...tool, inputSchema: tool.inputSchema as Tool['inputSchema'], outputSchema: tool.outputSchema as Tool['outputSchema'] })) }));
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); } finally { await server.close(); }
}
