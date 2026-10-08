import { z } from 'zod';
import { Brief, Plan, PlanInput, SessionInput, TrainingSession, Weight, WeightInput } from './entities.ts';
import { EXERCISE_LIBRARY } from './catalog.ts';
const semantics = '重量保留原始 lb/kg；哑铃为单只。引体/双杠 loadKind 为 assist（辅助重量）或 bodyweight（额外负重，徒手为 0），其他动作为 external。';
const catalog = EXERCISE_LIBRARY.map(ex => ex.id + '=' + ex.name).join('；');
export const MCP_TOOLS = [
  { name: 'log_session', scope: 'write', title: '保存训练记录', input: SessionInput,
    description: '直接保存原话与按原顺序解析的组。date 为 YYYY-MM-DD。按日期覆盖：修正或补充须重传当日完整 raw_text 和 sets。原话不得润色。未知信息保留在原话中，不猜测。无需 App 审批。' + semantics + catalog },
  { name: 'log_weight', scope: 'write', title: '保存体重', input: WeightInput,
    description: '直接保存测量日期（YYYY-MM-DD）与磅数 lb。同日覆盖，重复提交不会增加记录。不要提交均线或模型计算的派生值。' },
  { name: 'set_plan', scope: 'write', title: '保存下次训练安排', input: PlanInput,
    description: '直接更新一个训练日的完整动作安排；items=[] 清空安排。notes.coach 为该日备注；body 与 gain_target 为全局身体备注、增重目标，最近显式写入生效。备注字段省略保留，null 清空。目标指定起点和每周磅数上下限。无需 App 审批。' + semantics + catalog },
  { name: 'get_brief', scope: 'read', title: '读取训练简报', input: z.strictObject({}),
    description: '返回最近 30 个训练日期的原话和组、全部计划、最新体重、对应日期的 7 自然日滚动均值及样本数、身体备注、增重目标和四项力量摘要。e1RM 与均线由领域代码计算，引用返回值，不得大模型手算。' },
] as const;
export const MCP_OUTPUTS = { log_session: TrainingSession, log_weight: Weight, set_plan: Plan, get_brief: Brief };
export type ToolName = keyof typeof MCP_OUTPUTS;
export const MCP_INSTRUCTIONS = 'lowkkey 保存用户自己的训练事实和计划。先用 get_brief 了解已有记录；修正或补充训练必须提交该日期的完整原话与全部组，保留换行，不润色、不猜测。三个写工具成功即保存，同日覆盖，无 App 审批。notes 字段省略保留、null 清空。e1RM 与均线只引用领域代码返回值；generated_at 是简报生成时间，coverage 是记录范围，不代表今天测量。strength.recorded_sets=0 表示无记录；excluded_sets 说明热身、次数越界、缺训练当日或此前体重、有效负荷非正的排除原因。成功写入后可把 view_url 提供给用户查看。';
export function mcpOutput(name: ToolName) {
  return name === 'get_brief' ? z.object({ result: MCP_OUTPUTS[name] }) : z.object({ result: MCP_OUTPUTS[name], view_url: z.url() });
}
export function mcpToolList() {
  return MCP_TOOLS.map(tool => ({
    name: tool.name, title: tool.title, description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input', target: 'draft-7' }),
    outputSchema: z.toJSONSchema(mcpOutput(tool.name), { io: 'output', target: 'draft-7' }),
    annotations: { readOnlyHint: tool.scope === 'read', destructiveHint: tool.scope === 'write', idempotentHint: true, openWorldHint: false },
    securitySchemes: [{ type: 'oauth2', scopes: [tool.scope] }],
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: [tool.scope] }] },
  }));
}
