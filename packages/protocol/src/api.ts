import { z } from 'zod';
import { ClientPublic, Facts, ThemeInput, ThemeState, Preferences } from './entities.ts';
import { Id, Instant, LocalDate, PROTOCOL_VERSION } from './primitives.ts';
export const Scope = z.enum(['read', 'write']);
export type Scope = z.infer<typeof Scope>;
export const StateResponse = Facts.extend({ accountId: Id, protocol: z.literal(PROTOCOL_VERSION), today: LocalDate, theme_state: ThemeState });
export type StateResponse = z.infer<typeof StateResponse>;
export const ApiError = z.object({ error: z.object({ code: z.string(), fields: z.array(z.unknown()).optional() }) });
export const Backup = z.object({ format: z.literal('lowkkey.showroom.v5'), exportedAt: Instant, snapshot: StateResponse });
export const ROUTES = {
  theme: { method: 'POST', path: '/v1/preferences/theme', scope: 'user', summary: '保存本周手动主题', request: ThemeInput, response: Preferences },
  state: { method: 'GET', path: '/v1/state', scope: 'user', summary: '读取展厅事实', response: StateResponse },
  account: { method: 'GET', path: '/v1/account', scope: 'user', summary: '读取账户', response: z.object({ accountId: Id, email: z.string(), mode: z.string() }) },
  clients: { method: 'GET', path: '/v1/clients', scope: 'user', summary: '读取 AI 授权', response: z.array(ClientPublic) },
  revoke: { method: 'POST', path: '/v1/clients/{id}/revoke', scope: 'user', summary: '撤销 AI 授权', request: z.strictObject({}), response: z.object({ ok: z.literal(true) }) },
  export: { method: 'GET', path: '/v1/export', scope: 'user', summary: '导出本人事实', response: Backup },
} as const;
