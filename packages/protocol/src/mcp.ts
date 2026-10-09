import { z } from 'zod';
import { Brief, BriefInput, Curation, CurationInput, Deleted, DeleteInput, Plan, PlanInput, Profile, ProfileInput, SessionInput, TrainingSession, Weight, WeightInput } from './entities.ts';
import { EXERCISE_LIBRARY } from './catalog.ts';
const semantics = '重量保留 lb/kg；哑铃默认单只，挂片器械单边填 per:"side"。引体/双杠 kind 为 assist（辅助）或 bodyweight（额外负重，徒手为0）；其他使用 external。reps 包含借力次数，严格次数=reps-cheat。custom 动作必须带 name。';
const catalog = EXERCISE_LIBRARY.map(ex=>ex.id+'='+ex.name).join('；');
export const MCP_TOOLS = [
  {name:'get_brief',scope:'read',title:'读取精简简报',input:BriefInput,description:'默认最近6次，sessions可选0–30。读取计划、个人目标、体重、动作摘要、主项力量、本周事实和策展；所有派生数值已由代码计算。完整数据优先，不静默截断。'},
  {name:'log_session',scope:'write',title:'保存训练',input:SessionInput,description:'按日期整体覆盖，修正须重传完整一天。title是部位，note只放用户自己的话（≤200字），不接收raw_text。组按训练顺序。'+semantics+catalog},
  {name:'log_weight',scope:'write',title:'保存体重',input:WeightInput,description:'保存 date 和磅数 lb，同日覆盖。不要提交均线或模型计算的派生值。'},
  {name:'set_plan',scope:'write',title:'保存训练计划',input:PlanInput,description:'按title更新整日计划，weekday为0–6（周日0）。同一星期只允许一个计划，items=[]删除该日。coach省略保留、null清空。items使用loadKind，与组的kind含义相同。'+semantics+catalog},
  {name:'set_profile',scope:'write',title:'更新个人目标和备注',input:ProfileInput,description:'gain_target保存起点和每周增重上下限（lb），body_notes保存身体备注。省略保留，null清空。'},
  {name:'curate',scope:'write',title:'更新策展',input:CurationInput,description:'week必须是周一。省略字段保留、null清空；recap按字段合并，log按日期合并。所有文本不用emoji或感叹号。主题必须有理由；next指向今天或以后的实际计划日；picks引用本周真实记录；log引用真实训练。每次写入保存版本。'},
  {name:'delete',scope:'write',title:'删除训练或体重',input:DeleteInput,description:'删除kind=session或weight的指定日期，返回被删除内容和页面链接。不存在时报not_found。'},
] as const;
export const MCP_OUTPUTS = {get_brief:Brief,log_session:TrainingSession,log_weight:Weight,set_plan:Plan.nullable(),set_profile:Profile,curate:Curation,delete:Deleted};
export type ToolName = keyof typeof MCP_OUTPUTS;
export const MCP_INSTRUCTIONS = "lowkkey 是用户的私人训练档案。用户只给粗糙的记录，整理、写入和策展都由你做。\n\n事实：\n- 用户发来训练记录或截图时，转录成结构化的组，用 log_session 写入；title 写部位一个字。\n- note 只放用户自己说过的话（去掉口头语，不改意思），不要写你自己的评价。\n- 体重用 log_weight，单位 lb。不要提交均线、e1RM 等任何派生值。\n- 歧义只问一句，不猜。\n\n你的话（curate）：\n- 每次写完训练：更新 next（下一次训练的一句话，带日期），值得说时给这次训练写一条 log 批注。\n- 每周最后一次训练之后，或周一早上：写这一周的 recap（标题、周信、1–2 件 picks、focus），需要时写 body 的一句话。\n- 主题：只有 week_facts 里出现达成（鎏金）或突破（珍珠）时才考虑换，必须写理由；用户这周手动换过就不要再换。\n- 周信像一个看了用户一整周的朋友写的短信。先说训练里最值得说的那件事，再说要留意的。可以写训练以外、用户告诉过你的事（项目、在读的东西、这周的节奏），不写感情、健康诊断和用户没说过的推测。结尾可以是一句很轻的提醒。不夸、不喊口号，不用感叹号和 emoji。\n- 数字只引用 get_brief 返回的值。\n\n写入成功后把 view_url 给用户。";
export function mcpOutput(name:ToolName) { return name==='get_brief' ? z.object({result:MCP_OUTPUTS[name]}) : z.object({result:MCP_OUTPUTS[name],view_url:z.url()}); }
export function mcpToolList() { return MCP_TOOLS.map(tool=>({
  name:tool.name,title:tool.title,description:tool.description,
  inputSchema:z.toJSONSchema(tool.input,{io:'input',target:'draft-7'}),outputSchema:z.toJSONSchema(mcpOutput(tool.name),{io:'output',target:'draft-7'}),
  annotations:{readOnlyHint:tool.scope==='read',destructiveHint:tool.scope==='write',idempotentHint:tool.name!=='curate',openWorldHint:false},
  securitySchemes:[{type:'oauth2',scopes:[tool.scope]}],_meta:{securitySchemes:[{type:'oauth2',scopes:[tool.scope]}]},
})); }
