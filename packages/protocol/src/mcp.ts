import { z } from 'zod';
import { ModelEntryDraft, ProgramPatch, Exercise, Entry, Proposal, Derived, Held, Trigger } from './entities.ts';
import { Id, LocalDate } from './primitives.ts';
import { VerifierId } from './rules.ts';
import { StateResponse,Submission,ReviewDetails } from './api.ts';
import type { Scope } from './api.ts';

/**
 * MCP 工具定义。MCP 服务器只做三件事：鉴权（scope）、参数校验（下面的 zod）、调用与 REST 相同的服务层。
 *
 * 刻意不存在的工具：revert / update / delete / decide。
 * 模型只能提交待审批次和提议；撤销、入账、改计划、做决定只属于用户（不变量 I1）。
 */
export type McpTool = {
  name: string;
  scope: Scope;
  title: string;
  description: string;
  input: z.ZodObject;
};

export const MCP_TOOLS = [
  {
    name: 'get_state',
    scope: 'read',
    title: '读取状态',
    description:
      '读取用户的训练与体征状态：条目、训练计划、需要确认的事项、提议、触发器，以及所有派生值（带公式与输入）。' +
      '引用任何数字（斜率、e1RM、录入参考、周组数）前必须先读取这里的派生值，不得自行计算。V5/V6 沿用实际重量，不按次数或 RIR 自动加减；trainingReference 给出原始单位与来源，arrangement 是单独的已确认安排。',
    input: z.object({
      from: LocalDate.optional().describe('可选起始日期'),
      to: LocalDate.optional().describe('可选结束日期'),
      limit:z.number().int().min(1).max(100).default(50),
      cursor:z.string().optional().describe('上一页返回的不透明记录游标'),
    }),
  },
  {
    name: 'get_history',
    scope: 'read',
    title: '读取动作历史',
    description: '读取某个动作最近 n 次训练的全部组（按时间倒序）。',
    input: z.object({
      exerciseId: Id,
      limit: z.number().int().min(1).max(50).default(10),
      cursor:z.string().optional(),
    }),
  },
  {
    name: 'run_verifiers',
    scope: 'read',
    title: '运行验证器',
    description: '按需运行验证器（V1–V10）并返回派生值。用于回答「为什么是这个数」。',
    input: z.object({
      ids: z.array(VerifierId).optional().describe('默认全部'),
      asOf: LocalDate.optional(),
    }),
  },
  {
    name: 'propose_entries',
    scope: 'submit',
    title: '提交待审批次',
    description:
      '把用户原话或截图内容提交成结构化草稿。用户回答批次内歧义后，一次确认才会原子入账。' +
      '捕获时刻、本地日期与 IANA 时区必须固定，离线重试沿用同一幂等键和内容。',
    input: z.object({
      idempotencyKey: z.uuid(),
      rawText: z.string().min(1).max(4000),
      capturedAt: z.iso.datetime({offset:true}),
      capturedLocalDate: LocalDate,
      timeZone: z.string().min(1).max(80),
      entries: z.array(ModelEntryDraft).min(1).max(100),
    }),
  },
  {
    name: 'propose_change',
    scope: 'propose',
    title: '提出计划修改',
    description:
      '提出对训练计划的修改（JSON Merge Patch）。可提议换动作、调整训练日或参考重量。' +
      '重量安排与实际记录分别保留。提议进入收件箱，用户采用后才生效；录入默认仍沿用实际记录。',
    input: z.object({
      idempotencyKey: z.uuid(),
      title: z.string().max(80),
      rationale: z.string().max(1000),
      ruleRefs: z.array(VerifierId).default([]),
      patch: ProgramPatch,
      exercises:z.array(Exercise).max(30).optional().describe('新增个人动作，与计划一起审阅；不得覆盖已有动作 ID。'),
      expectedRevision:z.number().int().nonnegative().describe('get_state 返回的 revision，状态变化时重新读取后提交。'),
    }),
  },
  {
    name: 'list_inbox',
    scope: 'read',
    title: '读取收件箱',
    description: '读取待用户处理的事项：需要确认、未决提议、待决触发器。',
    input: z.object({}),
  },
  {name:'list_exercises',scope:'read',title:'查找动作',description:'查询本人可用动作及器械、单位、单只重量语义。未知动作可以随计划提案新增，不能猜已有动作 ID。',input:z.object({query:z.string().max(80).optional()})},
  {name:'get_review',scope:'read',title:'查看提案及处理结果',description:'读取指定批次或计划提案的状态、详情及用户审阅链接。已提交不等于已入账。',input:z.object({kind:z.enum(['submission','proposal','held','trigger']),id:Id})},
] as const satisfies readonly McpTool[];


export const MCP_OUTPUTS={
  get_state:StateResponse.extend({nextCursor:z.string().nullable(),serverTime:z.iso.datetime({offset:true})}),
  get_history:z.object({items:z.array(z.object({id:Id,sessionId:Id,date:LocalDate,startedAt:z.string().nullable(),endedAt:z.string().nullable(),sets:z.array(Entry)})),nextCursor:z.string().nullable()}),
  run_verifiers:z.record(z.string(),Derived),
  propose_entries:Submission.extend({reviewUrl:z.string()}),
  propose_change:Proposal.extend({reviewUrl:z.string()}),
  list_inbox:z.object({submissions:z.array(Submission.extend({reviewUrl:z.string()})),held:z.array(Held),proposals:z.array(Proposal.extend({reviewUrl:z.string()})),triggers:z.array(Trigger)}),
  list_exercises:z.array(Exercise),get_review:ReviewDetails,
};
export function mcpOutput(name:keyof typeof MCP_OUTPUTS){return z.object({result:MCP_OUTPUTS[name]});}

/** 生成 MCP `tools/list` 所需的 JSON Schema 描述。 */
export function mcpToolList() {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: 'input',target:'draft-7' }),
    annotations: { readOnlyHint: t.scope === 'read', destructiveHint: false, idempotentHint: true,openWorldHint:false },
    outputSchema:z.toJSONSchema(mcpOutput(t.name),{io:'output',target:'draft-7'}),
  }));
}
