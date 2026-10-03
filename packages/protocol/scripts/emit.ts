/**
 * 从 zod 生成语言无关的协议产物（提交进仓库，供其他语言的后端生成类型）：
 *   docs/lowkkey-handoff/protocol/schema.json     —— 所有实体的 JSON Schema（draft 2020-12）
 *   docs/lowkkey-handoff/protocol/openapi.json    —— REST v1 的 OpenAPI 3.1
 *   docs/lowkkey-handoff/protocol/mcp-tools.json  —— MCP tools/list 的返回体
 * 用法：npm run protocol:emit
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as P from '../src/index.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'lowkkey-handoff', 'protocol');
mkdirSync(out, { recursive: true });
const opts = { unrepresentable: 'any' } as const;

// 1) 组件：所有登记过 id 的实体
const components = (z.toJSONSchema(z.globalRegistry, { ...opts, io: 'output', uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, Record<string, unknown>> }).schemas;
for (const s of Object.values(components)) {
  delete s.$schema;
  delete s.$id;
}

// 2) 单个 schema：已登记的直接引用；否则展开，并把 $defs 提升为组件
function ref(schema: z.ZodType, io: 'input' | 'output') {
  const meta = z.globalRegistry.get(schema) as { id?: string } | undefined;
  if (meta?.id) return { $ref: `#/components/schemas/${meta.id}` };
  const js = z.toJSONSchema(schema, { ...opts, io }) as Record<string, unknown>;
  delete js.$schema;
  const defs = (js.$defs ?? {}) as Record<string, unknown>;
  delete js.$defs;
  for (const k of Object.keys(defs)) if (!components[k]) components[k] = defs[k] as Record<string, unknown>;
  return JSON.parse(JSON.stringify(js).replaceAll('#/$defs/', '#/components/schemas/'));
}

const paths: Record<string, Record<string, unknown>> = {};
for (const [op, r] of Object.entries(P.ROUTES)) {
  const route = r as { method: string; path: string; scope: string | string[]; summary: string; request?: z.ZodType; response: z.ZodType };
  const item: Record<string, unknown> = {
    operationId: op,
    summary: route.summary,
    'x-scopes': Array.isArray(route.scope) ? route.scope : [route.scope],
    responses: {
      '200': { description: 'OK', content: { 'application/json': { schema: ref(route.response, 'output') } } },
      default: { description: 'Error', content: { 'application/json': { schema: ref(P.ApiError, 'output') } } },
    },
  };
  const params: unknown[] = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
  if (route.request && route.method === 'GET') {
    const q = z.toJSONSchema(route.request, { ...opts, io: 'input' }) as { properties?: Record<string, unknown> };
    for (const [name, schema] of Object.entries(q.properties ?? {})) params.push({ name, in: 'query', required: false, schema });
  } else if (route.request) {
    item.requestBody = { required: true, content: { 'application/json': { schema: ref(route.request, 'input') } } };
  }
  if (params.length) item.parameters = params;
  (paths[route.path] ??= {})[route.method.toLowerCase()] = item;
}
paths['/v1/events'] = {
  get: {
    operationId: 'events',
    summary: '实时事件流（Server-Sent Events），每条 data 为一个 ServerEvent',
    'x-scopes': ['user', 'read'],
    responses: { '200': { description: 'text/event-stream', content: { 'text/event-stream': { schema: { $ref: '#/components/schemas/ServerEvent' } } } } },
  },
};

writeFileSync(
  join(out, 'openapi.json'),
  JSON.stringify(
    {
      openapi: '3.1.0',
      info: { title: 'lowkkey API', version: P.PROTOCOL_VERSION, description: '见 INTERFACE.md。客户网页使用应用会话；Access 仅保留管理和兼容环境；Remote MCP 使用 OAuth。客户写入必须携带 X-Lowkkey-Account。scope 见各操作的 x-scopes。' },
      servers: [{ url: '/' }],
      components: { schemas: components, securitySchemes: { customerSession:{type:'apiKey',in:'cookie',name:'__Secure-better-auth.session_token'},accessAssertion: { type: 'apiKey', in: 'header', name: 'Cf-Access-Jwt-Assertion' }, accessCookie: { type: 'apiKey', in: 'cookie', name: 'CF_Authorization' } } },
      security: [{customerSession:[]},{ accessAssertion: [] }, { accessCookie: [] }],
      paths,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(out, 'schema.json'),
  JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'lowkkey protocol', version: P.PROTOCOL_VERSION, $defs: components }, null, 2).replaceAll('#/components/schemas/', '#/$defs/'),
);

writeFileSync(join(out, 'mcp-tools.json'), JSON.stringify({ tools: P.mcpToolList() }, null, 2));
console.log('emitted →', out);
