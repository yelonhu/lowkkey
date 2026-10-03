import { z } from 'zod';
import { Derived, Entry, EntryDraft, Held, Program, Proposal, Snapshot, Trigger, Exercise, ModelEntryDraft } from './entities.ts';
import { Id, LocalDate } from './primitives.ts';

/* ───────────────────────────── 权限 ───────────────────────────── */

/**
 * 权限范围。服务端按 token 的 scope 判定，客户端声称的能力不作数。
 * - user：只有用户本人的会话（网页 / App）持有。唯一可以撤销、改计划、做决定的 scope。
 * - read：读取状态与派生值。
 * - submit：模型提交待审批次；只有用户确认时才原子入账。
 * - propose：提出计划修改（进收件箱，不直接生效）。
 */
export const Scope = z.enum(['user', 'read', 'submit', 'propose']);
export type Scope = z.infer<typeof Scope>;

/* ───────────────────────────── 错误 ───────────────────────────── */

export const ApiError = z.object({
  error: z.object({
    code:z.string().describe('稳定错误码；conflict/account_mismatch 不可原样自动重试'),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/* ───────────────────────────── 请求与响应 ───────────────────────────── */

export const StateQuery = z.object({
  from: LocalDate.optional(),
  to: LocalDate.optional(),
});

export const SubmissionQuestion=z.object({id:z.string(),gate:z.string(),question:z.string(),context:z.string().optional(),options:z.array(z.object({id:z.string(),label:z.string()}))});
export const Submission=z.object({id:Id,clientId:z.string(),rawText:z.string(),drafts:z.array(z.union([ModelEntryDraft,EntryDraft])),status:z.enum(['pending','accepted','skipped']),capturedAt:z.iso.datetime({offset:true}),timeZone:z.string(),createdAt:z.iso.datetime({offset:true}),questions:z.array(SubmissionQuestion)});
export const ClientPublic=z.object({id:Id,name:z.string(),scopes:z.array(z.enum(['read','submit','propose'])),status:z.enum(['active','revoked']),createdAt:z.iso.datetime({offset:true}),lastUsedAt:z.iso.datetime({offset:true}).nullable()});
export const StateResponse = Snapshot.extend({
  accountId: Id,
  revision: z.number().int().nonnegative(),
  eventCursor: z.number().int().nonnegative(),
  derived: z.record(z.string(), Derived),
  submissions: z.array(Submission),
  clients: z.array(ClientPublic),
});
export type StateResponse = z.infer<typeof StateResponse>;

/** 应用内文字捕获：确定性解析器处理；照片与语音交由用户授权的外部客户端。 */
export const CaptureRequest = z.object({
  text: z.string().max(4000).optional(),
  capturedAt: z.iso.datetime({offset:true}),
  capturedLocalDate: LocalDate,
  timeZone: z.string().min(1).max(80),
  context: z
    .object({ sessionId: Id.optional(), inSession: z.boolean().default(false) })
    .optional()
    .describe('训练中捕获时带上，闸门拦截会延后到训练结束（I10）'),
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;

export const WriteResult = z.object({
  committed: z.array(Entry),
  held: z.array(Held),
  unparsed: z.array(z.string()).default([]).describe('既不能规则解析、也无模型可用的片段'),
});
export type WriteResult = z.infer<typeof WriteResult>;
export const ReviewDetails=z.object({kind:z.enum(['submission','proposal','held','trigger']),id:Id,status:z.string(),revision:z.number().int(),reviewUrl:z.string(),title:z.string().optional(),source:z.string().optional(),drafts:z.array(z.union([ModelEntryDraft,EntryDraft])).optional(),result:WriteResult.nullable().optional(),item:z.union([Proposal,Held,Trigger]).optional(),exercises:z.array(Exercise).optional(),program:Program.optional()});


/** 界面直接写入（如完成一组）。同样过闸。 */
export const LogRequest = z.object({
  entries: z.array(EntryDraft).min(1).max(100),
  inSession: z.boolean().default(false),
});
export type LogRequest = z.infer<typeof LogRequest>;
export const BatchDecisionRequest=z.object({decision:z.enum(['accept','skip']),answers:z.record(z.string(),z.string()).optional(),expectedRevision:z.number().int().nonnegative()});
export const BatchReviewRequest=z.object({answers:z.record(z.string(),z.string())});
export const BatchReviewResponse=z.object({questions:z.array(SubmissionQuestion),ready:z.boolean(),revision:z.number().int().nonnegative()});
export const TimeZoneRequest=z.object({timeZone:z.string().min(1).max(80)});
export const Backup=z.object({format:z.literal('lowkkey.v1'),accountId:Id,exportedAt:z.iso.datetime({offset:true}).optional(),snapshot:Snapshot});

export const RevertRequest = z.object({ reason: z.string().max(400).default('') });

export const ResolveHeldRequest = z.union([
  z.object({ optionId: z.string().max(32) }),
  z.object({ skip: z.literal(true) }),
]);
export type ResolveHeldRequest = z.infer<typeof ResolveHeldRequest>;

export const ProposalDecisionRequest = z.object({
  decision: z.enum(['accept', 'reject','later']),
  expectedRevision:z.number().int().nonnegative(),
  note: z.string().max(400).optional(),
});

export const TriggerDecisionRequest = z.object({
  decision: z.enum(['accept', 'later']),
  expectedRevision:z.number().int().nonnegative(),
  reason: z.string().max(400).optional().describe('decision=later 时建议填写'),
});

export const ProposeChangeRequest = z.object({
  kind: z.enum(['program_change', 'note']),
  title: z.string().max(80),
  rationale: z.string().max(1000),
  ruleRefs: z.array(z.string()).default([]),
  patch: z.record(z.string(), z.unknown()).default({}),
  exercises:z.array(Exercise).max(30).optional(),
  expectedRevision:z.number().int().nonnegative().optional(),
});

/* ───────────────────────────── 路由表 ───────────────────────────── */

type Route = {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  scope: Scope | Scope[];
  summary: string;
  request?: z.ZodType;
  response: z.ZodType;
};

/** REST v1。所有路径前缀 /v1，JSON，网页用户由 Cloudflare Access 认证。 */
export const ROUTES = {
  getState: { method: 'GET', path: '/v1/state', scope: ['user', 'read'], summary: '读取快照与派生值', request: StateQuery, response: StateResponse },
  capture: { method: 'POST', path: '/v1/capture', scope: 'user', summary: '捕获一句话：解析 → 过闸 → 入账或需要确认', request: CaptureRequest, response: WriteResult },
  log: { method: 'POST', path: '/v1/entries', scope: 'user', summary: '用户直接写入草稿（过闸）', request: LogRequest, response: WriteResult },
  decideBatch: { method:'POST',path:'/v1/submissions/{id}/decision',scope:'user',summary:'原子确认或跳过模型批次',request:BatchDecisionRequest,response:WriteResult },
  reviewBatch: { method:'POST',path:'/v1/submissions/{id}/review',scope:'user',summary:'预览逐级闸门问题，不写入账本',request:BatchReviewRequest,response:BatchReviewResponse },
  revert: { method: 'POST', path: '/v1/entries/{id}/revert', scope: 'user', summary: '撤销一条记录（追加一条 revert）', request: RevertRequest, response: Entry },
  resolveHeld: { method: 'POST', path: '/v1/held/{id}/resolve', scope: 'user', summary: '回答一个确认问题', request: ResolveHeldRequest, response: WriteResult },
  decideProposal: { method: 'POST', path: '/v1/proposals/{id}/decision', scope: 'user', summary: '采用、拒绝或延期提议；须匹配状态版本', request: ProposalDecisionRequest, response: Proposal },
  decideTrigger: { method: 'POST', path: '/v1/triggers/{id}/decision', scope: 'user', summary: '采用或推迟触发器', request: TriggerDecisionRequest, response: Trigger },
  propose: { method: 'POST', path: '/v1/proposals', scope: ['user', 'propose'], summary: '提出计划修改（进收件箱）', request: ProposeChangeRequest, response: Proposal },
  claimDecision:{method:'POST',path:'/v1/decisions/today',scope:'user',summary:'占用本人当地日期的唯一主动建议位',request:z.strictObject({}),response:Snapshot},
  getProgram: { method: 'GET', path: '/v1/program', scope: ['user', 'read'], summary: '读取训练计划', response: Program },
  putProgram: { method: 'PUT', path: '/v1/program', scope: 'user', summary: '替换训练计划（仅用户）', request: Program, response: Program },
  getTimeZone:{method:'GET',path:'/v1/preferences/timezone',scope:'user',summary:'读取用户专属时区',response:TimeZoneRequest},
  putTimeZone:{method:'PUT',path:'/v1/preferences/timezone',scope:'user',summary:'设置用户专属 IANA 时区',request:TimeZoneRequest,response:TimeZoneRequest},
  getReview:{method:'GET',path:'/v1/reviews/{kind}/{id}',scope:['user','read'],summary:'读取指定事项及处理结果',response:ReviewDetails},
  getAccount:{method:'GET',path:'/v1/account',scope:'user',summary:'读取当前客户账户',response:z.object({accountId:Id,email:z.string(),mode:z.enum(['customer','access'])})},
  getClients:{method:'GET',path:'/v1/clients',scope:'user',summary:'查看本人 OAuth 客户端授权',response:z.array(ClientPublic)},
  revokeClient:{method:'POST',path:'/v1/clients/{id}/revoke',scope:'user',summary:'撤销本人 OAuth 客户端',request:z.object({}),response:z.object({id:Id,status:z.literal('revoked')})},
  exportAll: { method: 'GET', path: '/v1/export', scope: 'user', summary: '导出本人数据', response: Backup },
  importAll: { method: 'POST', path: '/v1/import', scope: 'user', summary: '导入本人备份（仅追加）', request: Backup, response: z.object({imported:z.number().int()}) },
} satisfies Record<string, Route>;

/* ───────────────────────────── 实时事件（SSE：GET /v1/events） ───────────────────────────── */

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entry.committed'), entry: Entry }),
  z.object({ type: z.literal('entry.reverted'), revert: Entry }),
  z.object({ type: z.literal('held.created'), held: Held }),
  z.object({ type: z.literal('held.resolved'), heldId: Id }),
  z.object({ type: z.literal('proposal.created'), proposal: Proposal }),
  z.object({ type: z.literal('proposal.decided'), proposal: Proposal }),
  z.object({ type: z.literal('trigger.updated'), trigger: Trigger }),
  z.object({ type: z.literal('program.updated'), program: Program }),
  z.object({ type: z.literal('submission.created'), submissionId: Id }),
  z.object({ type: z.literal('submission.decided'), submissionId: Id, decision:z.enum(['accept','skip']) }),
  z.object({ type:z.literal('client.authorized'),clientId:Id }),
  z.object({ type: z.literal('client.revoked'), clientId: Id }),
  z.object({ type: z.literal('backup.imported'), count:z.number().int() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
