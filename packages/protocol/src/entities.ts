import { z } from 'zod';
import { DateOrigin, Id, Instant, LocalDate, Muscle, Source, Unit } from './primitives.ts';
import { GateId, VerifierId } from './rules.ts';

/* ───────────────────────────── 动作目录 ───────────────────────────── */

export const ExerciseType = z.enum(['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight']);
export type ExerciseType = z.infer<typeof ExerciseType>;

/**
 * 动作。load 的单位跟随器械读数（自由重量常为 lb，器械常为 kg）。
 * - dumbbell：perHand=true 时 load 为单边重量。
 * - assisted：load 表示辅助配重，有效负荷 = 体重 − load（kg）。
 * - barbell：barLoad 为空杆重量（同 unit），用于杠片计算。
 */
export const Exercise = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  aliases: z.array(z.string().max(40)).default([]),
  type: ExerciseType,
  unit: Unit,
  barLoad: z.number().positive().optional(),
  perHand: z.boolean().default(false),
  muscles: z.partialRecord(Muscle, z.number().min(0).max(1)).describe('肌群 → 计入有效组的权重（1 = 主动肌，0.5 = 协同）'),
  increment: z.number().positive().optional().describe('覆盖默认加重档位（同 unit）'),
});
export type Exercise = z.infer<typeof Exercise>;

/* ───────────────────────────── 训练计划 ───────────────────────────── */

export const ProgramItem = z.strictObject({
  exerciseId: Id,
  sets: z.number().int().min(1).max(10),
  repMin: z.number().int().min(1).max(50),
  repMax: z.number().int().min(1).max(50),
  startLoad: z.number().min(0).nullable().default(null).describe('首次处方重量；null = 第一次由你自选'),
  note: z.string().max(400).optional(),
}).refine(v=>v.repMin<=v.repMax,'次数下限不能高于上限');
export type ProgramItem = z.infer<typeof ProgramItem>;

export const ProgramDay = z.strictObject({
  id: Id,
  name: z.string().min(1).max(20).describe('如「胸」「肩 + 手臂」'),
  weekday: z.number().int().min(0).max(6).nullable().default(null).describe('0 = 周日；仅作默认建议'),
  items: z.array(ProgramItem),
});
export type ProgramDay = z.infer<typeof ProgramDay>;

export const RampWeek = z.strictObject({
  week: z.number().int().min(1),
  setMultiplier: z.number().min(0.1).max(1.5),
  targetRir: z.number().int().min(0).max(5),
  label: z.string().max(20),
});
export type RampWeek = z.infer<typeof RampWeek>;

/** 用户约束：优先级高于通用区间（不变量 I6）。 */
export const Constraint = z.strictObject({
  kind: z.literal('frequency_cap'),
  muscles: z.array(Muscle).min(1),
  perWeek: z.number().int().min(0).max(7),
  label: z.string().max(40).describe('界面显示，如「每周一次」'),
});
export type Constraint = z.infer<typeof Constraint>;

export const Goal = z.strictObject({
  mode:z.enum(['gain','lose','maintain','record']),
  confirmedAt:Instant.optional(),
  maintenanceKg:z.strictObject({min:z.number().positive(),max:z.number().positive()}).refine(v=>v.min<=v.max,'范围下限不能高于上限').nullable().default(null),
});
export const Targets = z.strictObject({
  goal:Goal.optional(),
  bodyweightKg: z.number().positive().nullable().default(null),
  rateKgPerWeek: z.strictObject({ min: z.number(), max: z.number() }).refine(v=>v.min<=v.max,'范围下限不能高于上限').nullable().default(null),
  weeklySets: z.strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() }).refine(v=>v.min<=v.max).nullable().default(null),
  calorieTrigger: z
    .strictObject({
      thresholdKgPerWeek: z.number(),
      comparison:z.enum(['above','below']).optional(),
      confirmedAt:Instant.optional(),
      kcalDelta: z.number().int(),
      everyDays: z.number().int().min(7).max(56),
    })
    .nullable()
    .default(null),
}).superRefine((v,ctx)=>{
  if(v.goal?.mode==='gain'&&v.rateKgPerWeek&&v.rateKgPerWeek.min<0||v.goal?.mode==='lose'&&v.rateKgPerWeek&&v.rateKgPerWeek.max>0)ctx.addIssue({code:'custom',path:['rateKgPerWeek'],message:'目标方向与速度不一致'});
  if(v.goal?.mode==='record'&&(v.bodyweightKg!=null||v.rateKgPerWeek!=null||v.calorieTrigger!=null))ctx.addIssue({code:'custom',path:['goal'],message:'只记录模式不设置体重或饮食目标'});
  if(v.calorieTrigger&&v.goal&&(!v.rateKgPerWeek||v.calorieTrigger.everyDays<14))ctx.addIssue({code:'custom',path:['calorieTrigger'],message:'饮食建议需要目标速度及至少 14 天观察期'});
});
export type Targets = z.infer<typeof Targets>;

export const Program = z.strictObject({
  cycleStart: LocalDate.nullable().default(null),
  ramp: z.array(RampWeek).default([]),
  days: z.array(ProgramDay).default([]),
  constraints: z.array(Constraint).default([]),
  targets: Targets.default({
    bodyweightKg: null,
    rateKgPerWeek: null,
    weeklySets: null,
    calorieTrigger: null,
  }),
});
export type Program = z.infer<typeof Program>;

/* ───────────────────────────── 事件日志（只追加） ───────────────────────────── */

const EntryCommon = {
  id: Id,
  date: LocalDate,
  dateOrigin: DateOrigin,
  createdAt: Instant,
  source: Source,
};

export const WeighInCondition = z.enum(['fasted', 'post_bm', 'unspecified']);
export type WeighInCondition = z.infer<typeof WeighInCondition>;

export const WeightEntry = z.object({
  ...EntryCommon,
  kind: z.literal('weight'),
  kg: z.number().min(20).max(400),
  raw: z.object({ value: z.number(), unit: Unit }),
  condition: WeighInCondition.default('unspecified'),
});

export const LoadKind = z.enum(['external', 'assist', 'bodyweight']);
export type LoadKind = z.infer<typeof LoadKind>;

export const SetEntry = z.object({
  ...EntryCommon,
  kind: z.literal('set'),
  sessionId: Id,
  exerciseId: Id,
  setIndex: z.number().int().min(1),
  load: z.number().min(0).describe('单位见 unit；assist 时为辅助配重'),
  unit: Unit,
  loadKind: LoadKind.default('external'),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(10).nullable().default(null),
  straps: z.boolean().optional(),
  setRole:z.enum(['work','warmup','unknown']).optional(),
  recommendation:z.object({ruleVersion:z.string(),inputs:z.array(Id),load:z.number().nullable(),unit:Unit}).optional(),
});

export const SetAnnotationEntry=z.object({...EntryCommon,kind:z.literal('set_annotation'),targetId:Id,setRole:z.enum(['work','warmup','unknown'])});

export const SessionEntry = z.object({
  ...EntryCommon,
  kind: z.literal('session'),
  sessionId: Id,
  event: z.enum(['start', 'end']),
  dayId: Id.nullable().default(null),
  prescription:z.array(ProgramItem).optional(),
});

export const WaistEntry = z.object({
  ...EntryCommon,
  kind: z.literal('waist'),
  cm: z.number().min(30).max(200),
});

export const NoteEntry = z.object({
  ...EntryCommon,
  kind: z.literal('note'),
  text: z.string().min(1).max(4000),
});

export const DirectiveEntry = z.object({
  ...EntryCommon,
  kind: z.literal('directive'),
  directive: z.literal('calorie_delta'),
  kcal: z.number().int(),
  effectiveFrom: LocalDate,
  triggerId: Id.nullable().default(null),
});

/** 撤销：唯一的「修改」方式。只有 actor=user 可以写（不变量 I1/I3）。 */
export const RevertEntry = z.object({
  ...EntryCommon,
  kind: z.literal('revert'),
  targetId: Id,
  reason: z.string().max(400).default(''),
});

export const Entry = z.discriminatedUnion('kind', [
  WeightEntry,
  SetEntry,
  SetAnnotationEntry,
  SessionEntry,
  WaistEntry,
  NoteEntry,
  DirectiveEntry,
  RevertEntry,
]);
export type Entry = z.infer<typeof Entry>;
export type WeightEntry = z.infer<typeof WeightEntry>;
export type SetEntry = z.infer<typeof SetEntry>;
export type SessionEntry = z.infer<typeof SessionEntry>;
export type WaistEntry = z.infer<typeof WaistEntry>;
export type NoteEntry = z.infer<typeof NoteEntry>;
export type DirectiveEntry = z.infer<typeof DirectiveEntry>;
export type RevertEntry = z.infer<typeof RevertEntry>;

/**
 * 草稿：写入请求里的条目，还没有 id / createdAt（由服务端分配）。
 * 模型写入时必须带 confidence（0–1），闸门 G5 用它判断是否需要确认。
 */
const DRAFT_OMIT = { id: true, createdAt: true } as const;
const confidence = { confidence: z.number().min(0).max(1).optional() };

export const EntryDraft = z.discriminatedUnion('kind', [
  WeightEntry.omit(DRAFT_OMIT).extend(confidence),
  SetEntry.omit(DRAFT_OMIT).extend(confidence),
  SetAnnotationEntry.omit(DRAFT_OMIT).extend(confidence),
  SessionEntry.omit(DRAFT_OMIT).extend(confidence),
  WaistEntry.omit(DRAFT_OMIT).extend(confidence),
  NoteEntry.omit(DRAFT_OMIT).extend(confidence),
  DirectiveEntry.omit(DRAFT_OMIT).extend(confidence),
]);
export type EntryDraft = z.infer<typeof EntryDraft>;

/* ───────────────────────────── 需要确认（被闸门拦下的草稿） ───────────────────────────── */

export const HeldOption = z.object({
  id: z.string().max(32),
  label: z.string().max(40),
  hint: z.string().max(60).optional(),
  suggested: z.boolean().default(false).describe('模型或规则的推测；界面只加「推测」标记，不预选'),
  action: z.enum(['commit', 'discard']).default('commit'),
  reverts: z.array(Id).default([]).describe('选中后同时撤销的已有记录（如「替换」今天的旧体重）'),
  patches: z
    .array(z.object({ draft: z.number().int().min(0), set: z.record(z.string(), z.unknown()) }))
    .default([])
    .describe('选中后对 drafts[draft] 做的字段覆盖'),
});
export type HeldOption = z.infer<typeof HeldOption>;

export const Held = z.object({
  id: Id,
  createdAt: Instant,
  gate: GateId,
  drafts: z.array(EntryDraft).min(1),
  question: z.string().max(120).describe('标题就是问题本身'),
  context: z.string().max(400).optional().describe('一句补充说明，如「有两组 125 lb。」'),
  highlight: z.string().max(200).optional().describe('原话中需要高亮的片段'),
  options: z.array(HeldOption).min(1),
  skip: z.enum(['commit', 'discard']).describe('用户选择「跳过」时如何处理 drafts'),
  deferUntilSessionEnd: z.boolean().default(false).describe('训练中产生的拦截延后到训练完成页（I10）'),
  approvedQuestions: z.array(z.string()).default([]).describe('本草稿已由用户回答的闸门问题'),
  pendingReverts: z.array(Id).default([]).describe('全部闸门完成后才追加的替换撤销'),
});
export type Held = z.infer<typeof Held>;

/* ───────────────────────────── 提议 / 触发器 / 派生值 ───────────────────────────── */

export const Proposal = z.object({
  id: Id,
  createdAt: Instant,
  author: Source,
  kind: z.enum(['program_change', 'note']),
  title: z.string().max(80),
  rationale: z.string().max(1000),
  ruleRefs: z.array(VerifierId).default([]),
  patch: z.record(z.string(), z.unknown()).describe('对 Program 的 JSON Merge Patch（RFC 7396）'),
  status: z.enum(['open', 'accepted', 'rejected', 'expired']).default('open'),
  decidedAt: Instant.optional(),
  decisionNote: z.string().max(400).optional(),
  snoozedUntil:LocalDate.optional(),
  baseProgram:Program.optional(),
  exercises:z.array(Exercise).max(30).optional(),
});
export type Proposal = z.infer<typeof Proposal>;

export const Trigger = z.object({
  id: Id,
  rule: VerifierId,
  dueDate: LocalDate,
  metric: z.literal('slope7d'),
  threshold: z.number(),
  current: z.number().nullable(),
  action: z.object({ type: z.literal('calorie_delta'), kcal: z.number().int() }),
  status: z.enum(['pending', 'will_fire', 'fired', 'accepted_early', 'vetoed', 'not_met']),
  reason: z.string().max(400).optional(),
  snoozedUntil:LocalDate.optional(),
});
export type Trigger = z.infer<typeof Trigger>;

/** 派生值：永远由验证器计算，永远可追溯（不变量 I4）。 */
export const Derived = z.object({
  key: z.string().max(80),
  label: z.string().max(60),
  value: z.number().nullable(),
  unit: z.string().max(16).nullable(),
  rule: VerifierId,
  ruleVersion: z.string(),
  inputs: z.array(Id),
  asOf: LocalDate,
  formula: z.string().max(400).describe('代入数字后的公式，用于 ƒ 抽屉'),
});
export type Derived = z.infer<typeof Derived>;

/* ───────────────────────────── 快照 ───────────────────────────── */

export const Snapshot = z.object({
  protocol: z.string(),
  today: LocalDate,
  timezone: z.string().describe('IANA 时区，如 America/Chicago'),
  entries: z.array(Entry),
  held: z.array(Held),
  proposals: z.array(Proposal),
  triggers: z.array(Trigger),
  program: Program,
  exercises: z.array(Exercise),
  decisionSlots:z.record(LocalDate,z.object({kind:z.enum(['proposal','trigger']),id:Id,closed:z.boolean()})).optional(),
});
export type Snapshot = z.infer<typeof Snapshot>;

export { GateId };

/** Model submissions exclude directives, reverts and live-session controls. */
export const ModelEntryDraft=z.discriminatedUnion('kind',[EntryDraft.options[0].extend({source:Source.default({actor:'model',channel:'mcp'}),confidence:z.number().min(0).max(1),corrects:Id.optional().describe('更正本人已有同类记录的 ID；用户确认时追加撤销与新记录，模型不能自行撤销。')}),EntryDraft.options[1].extend({source:Source.default({actor:'model',channel:'mcp'}),confidence:z.number().min(0).max(1),corrects:Id.optional().describe('更正本人已有同类记录的 ID；用户确认时追加撤销与新记录，模型不能自行撤销。')}),EntryDraft.options[2].extend({source:Source.default({actor:'model',channel:'mcp'}),confidence:z.number().min(0).max(1),corrects:Id.optional().describe('更正本人已有同类记录的 ID；用户确认时追加撤销与新记录，模型不能自行撤销。')}),EntryDraft.options[4].extend({source:Source.default({actor:'model',channel:'mcp'}),confidence:z.number().min(0).max(1),corrects:Id.optional().describe('更正本人已有同类记录的 ID；用户确认时追加撤销与新记录，模型不能自行撤销。')}),EntryDraft.options[5].extend({source:Source.default({actor:'model',channel:'mcp'}),confidence:z.number().min(0).max(1),corrects:Id.optional().describe('更正本人已有同类记录的 ID；用户确认时追加撤销与新记录，模型不能自行撤销。')})]);
export const ProgramPatch=z.strictObject({
  days:z.array(ProgramDay).max(14).optional(),cycleStart:LocalDate.nullable().optional(),ramp:z.array(RampWeek).max(52).optional(),constraints:z.array(Constraint).optional(),
  targets:z.strictObject(Targets.shape).partial().extend({goal:Goal.omit({confirmedAt:true}).partial().optional(),calorieTrigger:Targets.shape.calorieTrigger.unwrap().unwrap().omit({confirmedAt:true}).partial().nullable().optional()}).optional(),
});
