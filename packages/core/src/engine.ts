import {
  EMPTY_PROGRAM,
  EXERCISE_LIBRARY,
  Entry as EntrySchema,
  GATE_THRESHOLDS,
  PROTOCOL_VERSION,
  type Entry,
  type EntryDraft,
  type Exercise,
  type Held,
  type HeldOption,
  type LocalDate,
  type Program,
  type Proposal,
  type SetEntry,
  type Snapshot,
  type Source,
  type Trigger,
  type WriteResult,
} from '@lowkkey/protocol';
import { active, bodyweightOn, dailyWeights, openSession, sessions } from './ledger.ts';
import { parse, type ParsedItem } from './parser.ts';
import { calorieCheck, e1rm, effectiveLoad } from './verifiers.ts';
import { convert, diffDays, newId, round } from './util.ts';

/**
 * 参考引擎：协议语义的可执行定义。纯函数——输入快照，输出新快照与结果，不做 I/O。
 * 前端本地模式直接使用；后端用同一套函数，外面包一层持久化、鉴权与事件推送。
 */

export type EngineContext = {
  /** ISO 时间戳（服务端时钟）。 */
  now: string;
  /** 用户本地今天。 */
  today: LocalDate;
  /** 本次操作的来源。撤销、决定、改计划要求 actor = 'user'。 */
  source: Source;
};

export type Outcome = { snap: Snapshot; result: WriteResult };

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}

export function emptySnapshot(today: LocalDate, timezone: string, program: Program = EMPTY_PROGRAM, exercises: Exercise[] = EXERCISE_LIBRARY): Snapshot {
  return { protocol: PROTOCOL_VERSION, today, timezone, entries: [], held: [], proposals: [], triggers: [], program, exercises };
}

function requireUser(ctx: EngineContext) {
  if (ctx.source.actor !== 'user') throw new ForbiddenError('只有用户可以执行此操作');
}

/* ─────────────── 描述（用于确认问题） ─────────────── */

function exName(snap: Snapshot, id: string) {
  return snap.exercises.find((x) => x.id === id)?.name ?? id;
}

export function describeDraft(snap: Snapshot, d: EntryDraft): string {
  switch (d.kind) {
    case 'weight':
      return `体重 ${round(d.kg, 2)} kg`;
    case 'set':
      return `${exName(snap, d.exerciseId)} ${d.load} ${d.unit} × ${d.reps}`;
    case 'waist':
      return `腰围 ${d.cm} cm`;
    case 'note':
      return d.text.slice(0, 24);
    case 'session':
      return d.event === 'start' ? '开始训练' : '结束训练';
    case 'directive':
      return `每天 ${d.kcal > 0 ? '+' : ''}${d.kcal} kcal`;
  }
}

const md = (d: LocalDate) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`;

/* ─────────────── 物化与会话 ─────────────── */

function materialize(d: EntryDraft, ctx: EngineContext): Entry {
  return EntrySchema.parse({ ...d, id: newId('e_'), createdAt: ctx.now });
}

/** 为某日找到可复用的训练 id：进行中的训练优先，其次当天已有的训练，否则新建。 */
function sessionFor(snap: Snapshot, date: LocalDate): string {
  const open = openSession(snap.entries);
  if (open && open.date === date) return open.id;
  const same = sessions(snap.entries).filter((s) => s.date === date);
  return same[same.length - 1]?.id ?? newId('s_');
}

function nextSetIndex(entries: Entry[], sessionId: string, exerciseId: string, pending: EntryDraft[]): number {
  const n = active(entries).filter((e) => e.kind === 'set' && e.sessionId === sessionId && e.exerciseId === exerciseId).length;
  const p = pending.filter((d) => d.kind === 'set' && d.sessionId === sessionId && d.exerciseId === exerciseId).length;
  return n + p + 1;
}

/* ─────────────── 闸门 G2–G5 ─────────────── */

type GateHit = Omit<Held, 'id' | 'createdAt' | 'drafts' | 'deferUntilSessionEnd' | 'approvedQuestions' | 'pendingReverts'>;
const gateToken=(hit:Pick<Held,'gate'|'question'|'context'|'options'>)=>JSON.stringify([hit.gate,hit.question,hit.context,hit.options]);

function gate(snap: Snapshot, d: EntryDraft, batch: EntryDraft[], approved: string[] = []): GateHit | null {
  const desc = describeDraft(snap, d);
  const unanswered = (hit: GateHit) => !approved.includes(gateToken(hit));
  const confirm = (question: string, context?: string): GateHit => ({
    gate: 'G4',
    question,
    context,
    options: [
      { id: 'yes', label: '确认', suggested: false, action: 'commit', reverts: [], patches: [] },
      { id: 'no', label: '不记录', suggested: false, action: 'discard', reverts: [], patches: [] },
    ],
    skip: 'discard',
  });

  // G5 低置信
  if (d.source.actor === 'model' && d.confidence != null && d.confidence < GATE_THRESHOLDS.modelConfidence) {
    const hit={ ...confirm(`记录「${desc}」，对吗？`, '这一项是模型读出来的，把握不大。'), gate: 'G5' as const };
    if(unanswered(hit))return hit;
  }
  // G2 推断的日期
  if (d.dateOrigin === 'inferred' && d.date !== snap.today) {
    const hit:GateHit = {
      gate: 'G2',
      question: `「${desc}」记到哪一天？`,
      context: '日期是推测出来的，不会自动记录。',
      options: [
        { id: 'inferred', label: md(d.date), hint: '推测的日期', suggested: true, action: 'commit', reverts: [], patches: [{ draft: 0, set: { dateOrigin: 'explicit' } }] },
        { id: 'today', label: '今天', hint: md(snap.today), suggested: false, action: 'commit', reverts: [], patches: [{ draft: 0, set: { date: snap.today, dateOrigin: 'device' } }] },
      ],
      skip: 'discard',
    };
    if(unanswered(hit))return hit;
  }
  if (d.kind === 'weight') {
    // G3 覆盖
    const same = dailyWeights(snap.entries).find((w) => w.date === d.date);
    const dupInBatch = batch.slice(0, batch.indexOf(d)).some((b) => b.kind === 'weight' && b.date === d.date);
    if (same || dupInBatch) {
      const hit:GateHit = {
        gate: 'G3',
        question: `${d.date === snap.today ? '今天' : md(d.date)}已有体重，替换吗？`,
        context: same ? `已记录 ${round(same.kg, 2)} kg，新的是 ${round(d.kg, 2)} kg。` : undefined,
        options: [
          { id: 'replace', label: '替换', suggested: false, action: 'commit', reverts: same ? [same.id] : [], patches: [] },
          { id: 'keep', label: '两条都保留', suggested: false, action: 'commit', reverts: [], patches: [] },
          { id: 'drop', label: '不记录', suggested: false, action: 'discard', reverts: [], patches: [] },
        ],
        skip: 'discard',
      };
      if(unanswered(hit))return hit;
    }
    // G4 体重离群
    const prev = bodyweightOn(snap.entries, d.date);
    if (prev && Math.abs(diffDays(d.date, prev.date)) <= 3 && Math.abs(d.kg - prev.kg) > GATE_THRESHOLDS.weightDailyDeltaKg) {
      const delta = round(d.kg - prev.kg, 1);
      const hit=confirm(`体重 ${round(d.kg, 2)} kg，确认吗？`, `比 ${md(prev.date)} 的 ${round(prev.kg, 2)} kg ${delta > 0 ? '多' : '少'} ${Math.abs(delta)} kg。`);
      if(unanswered(hit))return hit;
    }
  }
  if (d.kind === 'set') {
    // G4 e1RM 跳变 / 单位可疑
    const ex = snap.exercises.find((x) => x.id === d.exerciseId);
    if (ex) {
      const bw = bodyweightOn(snap.entries, d.date)?.kg ?? null;
      const now = effectiveLoad({ ...(d as SetEntry), id: '', createdAt: '' }, ex, bw);
      const est = now == null ? null : e1rm(now, d.reps);
      const hist = active(snap.entries).filter((e): e is SetEntry => e.kind === 'set' && e.exerciseId === ex.id);
      let best = 0;
      for (const s of hist) {
        const l = effectiveLoad(s, ex, bodyweightOn(snap.entries, s.date)?.kg ?? null);
        const v = l == null ? null : e1rm(l, s.reps);
        if (v != null && v > best) best = v;
      }
      if (est != null && best > 0 && est > best * GATE_THRESHOLDS.e1rmJumpRatio) {
        const hit=confirm(`${desc}，确认吗？`, `估算 1RM ${round(est)} ${ex.unit}，比历史最佳 ${round(best)} 高 ${Math.round((est / best - 1) * 100)}%。`);
        if(unanswered(hit))return hit;
      }
      if (d.unit !== ex.unit && ex.type !== 'assisted') {
        const conv = round(convert(d.load, d.unit, ex.unit));
        const hit:GateHit = {
          gate: 'G4',
          question: `${exName(snap, ex.id)}：${d.load} ${d.unit} 还是 ${d.load} ${ex.unit}？`,
          context: `这个动作通常按 ${ex.unit} 记录。`,
          options: [
            { id: 'as_is', label: `${d.load} ${d.unit}`, hint: `≈ ${conv} ${ex.unit}`, suggested: false, action: 'commit', reverts: [], patches: [] },
            { id: 'swap', label: `${d.load} ${ex.unit}`, suggested: false, action: 'commit', reverts: [], patches: [{ draft: 0, set: { unit: ex.unit } }] },
          ],
          skip: 'discard',
        };
        if(unanswered(hit))return hit;
      }
    }
  }
  return null;
}

/* ─────────────── 写入 ─────────────── */

function commitAll(snap: Snapshot, drafts: EntryDraft[], ctx: EngineContext): { snap: Snapshot; committed: Entry[] } {
  const committed = drafts.map((d) => materialize(d, ctx));
  return { snap: { ...snap, entries: [...snap.entries, ...committed] }, committed };
}

/** 写入草稿：逐条过闸，通过的入账，未通过的进入「需要确认」。 */
export function log(snap: Snapshot, drafts: EntryDraft[], ctx: EngineContext, opts: { inSession?: boolean } = {}): Outcome {
  const pass: EntryDraft[] = [];
  const held: Held[] = [];
  const prepared: EntryDraft[] = [];
  for (const raw of drafts) {
    let d = raw;
    if (d.kind === 'set' && (!d.setIndex || d.setIndex < 1)) d = { ...d, setIndex: nextSetIndex(snap.entries, d.sessionId, d.exerciseId, prepared) };
    prepared.push(d);
  }
  for (const d of prepared) {
    const hit = gate(snap, d, prepared);
    if (hit) held.push({ ...hit, id: newId('h_'), createdAt: ctx.now, drafts: [d], deferUntilSessionEnd: !!opts.inSession, approvedQuestions: [], pendingReverts: [] });
    else pass.push(d);
  }
  const c = commitAll(snap, pass, ctx);
  return { snap: { ...c.snap, held: [...c.snap.held, ...held] }, result: { committed: c.committed, held, unparsed: [] } };
}

/** 捕获一句话：规则解析 → 草稿 → 闸门（G1 来自解析器的歧义）。 */
export function capture(snap: Snapshot, text: string, ctx: EngineContext, opts: { inSession?: boolean; currentExerciseId?: string } = {}): Outcome {
  const parsed = parse(text, { today: ctx.today, exercises: snap.exercises, currentExerciseId: opts.currentExerciseId });
  const source: Source = { ...ctx.source, rawText: text };
  const sessionId = parsed.items.some((i) => i.type === 'set') ? sessionFor(snap, parsed.date) : '';
  const base = { date: parsed.date, dateOrigin: parsed.dateOrigin, source };

  const toDraft = (it: ParsedItem): EntryDraft => {
    switch (it.type) {
      case 'weight':
        return { ...base, kind: 'weight', kg: it.kg, raw: it.raw, condition: it.condition };
      case 'waist':
        return { ...base, kind: 'waist', cm: it.cm };
      case 'set':
        return { ...base, kind: 'set', sessionId, exerciseId: it.exerciseId, setIndex: 0, load: it.load, unit: it.unit, loadKind: snap.exercises.find((x) => x.id === it.exerciseId)?.type === 'assisted' ? 'assist' : 'external', reps: it.reps, rir: it.rir };
    }
  };

  // 先分配组序，保证歧义组与普通组的顺序与原话一致
  const all: EntryDraft[] = [];
  for (const it of parsed.items) {
    const d = toDraft(it);
    all.push(d.kind === 'set' ? { ...d, setIndex: nextSetIndex(snap.entries, d.sessionId, d.exerciseId, all) } : d);
  }

  const ambiguous = new Set(parsed.ambiguities.flatMap((a) => a.options.flatMap((o) => o.targets)));
  const heldG1: Held[] = parsed.ambiguities.map((a) => {
    const targets = [...new Set(a.options.flatMap((o) => o.targets))];
    const local = (i: number) => targets.indexOf(i);
    const options: HeldOption[] = a.options.map((o) => ({
      id: o.id,
      label: o.label,
      hint: o.hint,
      suggested: false,
      action: 'commit',
      reverts: [],
      patches: o.targets.map((t) => ({ draft: local(t), set: { rir: a.value } })),
    }));
    return { id: newId('h_'), createdAt: ctx.now, gate: 'G1', drafts: targets.map((t) => all[t]!), question: a.question, context: a.context, highlight: a.highlight, options, skip: 'commit', deferUntilSessionEnd: !!opts.inSession, approvedQuestions: [], pendingReverts: [] };
  });

  const rest = all.filter((_, i) => !ambiguous.has(i));
  const out = log(snap, rest, ctx, opts);
  return {
    snap: { ...out.snap, held: [...out.snap.held, ...heldG1] },
    result: { committed: out.result.committed, held: [...out.result.held, ...heldG1], unparsed: parsed.unparsed },
  };
}

/** 回答一个确认问题。 */
export function resolveHeld(snap: Snapshot, heldId: string, choice: { optionId: string } | { skip: true }, ctx: EngineContext): Outcome {
  requireUser(ctx);
  const h = snap.held.find((x) => x.id === heldId);
  if (!h) throw new NotFoundError('没有这条待确认事项');
  const rest = { ...snap, held: snap.held.filter((x) => x.id !== heldId) };
  let action: 'commit' | 'discard';
  let drafts = h.drafts;
  let reverts: string[] = [];
  if ('skip' in choice) action = h.skip;
  else {
    const o = h.options.find((x) => x.id === choice.optionId);
    if (!o) throw new NotFoundError('没有这个选项');
    action = o.action;
    reverts = o.reverts;
    drafts = h.drafts.map((d, i) => o.patches.filter((p) => p.draft === i).reduce((acc, p) => ({ ...acc, ...p.set }) as EntryDraft, d));
  }
  if (action === 'discard') return { snap: rest, result: { committed: [], held: [], unparsed: [] } };
  let s = rest;
  const committed: Entry[] = [];
  const held: Held[] = [];
  const approved=[...h.approvedQuestions,gateToken(h)];
  const pendingReverts=[...new Set([...h.pendingReverts,...reverts])];
  for(const draft of drafts){
    const hit=gate(s,draft,[draft],approved);
    if(hit){held.push({...hit,id:newId('h_'),createdAt:ctx.now,drafts:[draft],deferUntilSessionEnd:h.deferUntilSessionEnd,approvedQuestions:approved,pendingReverts});continue;}
    for (const id of pendingReverts) {
      if(s.entries.some(e=>e.kind==='revert'&&e.targetId===id))continue;
      const r = revert(s, id, '被新记录替换', ctx);
      s = r.snap;
      committed.push(r.entry);
    }
    const c=commitAll(s,[draft],ctx);s=c.snap;committed.push(...c.committed);
  }
  return { snap: {...s,held:[...s.held,...held]}, result: { committed, held, unparsed: [] } };
}

/** 撤销：追加一条 revert（不变量 I3）。仅用户。 */
export function revert(snap: Snapshot, entryId: string, reason: string, ctx: EngineContext): { snap: Snapshot; entry: Entry } {
  requireUser(ctx);
  const target = snap.entries.find((e) => e.id === entryId);
  if (!target || target.kind === 'revert') throw new NotFoundError('没有这条记录');
  const entry = EntrySchema.parse({ id: newId('e_'), createdAt: ctx.now, date: ctx.today, dateOrigin: 'device', source: ctx.source, kind: 'revert', targetId: entryId, reason });
  return { snap: { ...snap, entries: [...snap.entries, entry] }, entry };
}

/* ─────────────── 训练 ─────────────── */

export function startSession(snap: Snapshot, dayId: string | null, ctx: EngineContext): { snap: Snapshot; sessionId: string } {
  const open = openSession(snap.entries);
  if (open) return { snap, sessionId: open.id };
  const sessionId = newId('s_');
  const entry = materialize({ kind: 'session', event: 'start', sessionId, dayId, date: ctx.today, dateOrigin: 'device', source: ctx.source }, ctx);
  return { snap: { ...snap, entries: [...snap.entries, entry] }, sessionId };
}

export function endSession(snap: Snapshot, sessionId: string, ctx: EngineContext): Snapshot {
  const entry = materialize({ kind: 'session', event: 'end', sessionId, dayId: null, date: ctx.today, dateOrigin: 'device', source: ctx.source }, ctx);
  return { ...snap, entries: [...snap.entries, entry] };
}

export function logSet(
  snap: Snapshot,
  s: { sessionId: string; exerciseId: string; load: number; unit: SetEntry['unit']; reps: number; rir: number | null },
  ctx: EngineContext,
): Outcome {
  const ex = snap.exercises.find((x) => x.id === s.exerciseId);
  return log(
    snap,
    [{ kind: 'set', ...s, setIndex: 0, loadKind: ex?.type === 'assisted' ? 'assist' : 'external', date: ctx.today, dateOrigin: 'device', source: ctx.source }],
    ctx,
    { inSession: true },
  );
}

/* ─────────────── 计划、提议、触发器 ─────────────── */

/** RFC 7396 JSON Merge Patch。 */
export function mergePatch<T>(target: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out as T;
}

export function putProgram(snap: Snapshot, program: Program, ctx: EngineContext): Snapshot {
  requireUser(ctx);
  return { ...snap, program };
}

export function propose(snap: Snapshot, p: Pick<Proposal, 'kind' | 'title' | 'rationale' | 'ruleRefs' | 'patch'>, ctx: EngineContext): { snap: Snapshot; proposal: Proposal } {
  const proposal: Proposal = { ...p, id: newId('p_'), createdAt: ctx.now, author: ctx.source, status: 'open' };
  return { snap: { ...snap, proposals: [...snap.proposals, proposal] }, proposal };
}

export function decideProposal(snap: Snapshot, id: string, decision: 'accept' | 'reject', note: string | undefined, ctx: EngineContext): Snapshot {
  requireUser(ctx);
  const p = snap.proposals.find((x) => x.id === id);
  if (!p || p.status !== 'open') throw new NotFoundError('没有这条待决提议');
  const decided: Proposal = { ...p, status: decision === 'accept' ? 'accepted' : 'rejected', decidedAt: ctx.now, decisionNote: note };
  const program = decision === 'accept' && p.kind === 'program_change' ? mergePatch(snap.program, p.patch) : snap.program;
  return { ...snap, program, proposals: snap.proposals.map((x) => (x.id === id ? decided : x)) };
}

/** 刷新触发器（V8）：保证当前判决日有一条记录；判决日已过且未决定时自动执行。 */
export function refreshTriggers(snap: Snapshot, ctx: EngineContext): Snapshot {
  const check = calorieCheck(snap.entries, snap.program, ctx.today);
  if (!check) return snap;
  let triggers = snap.triggers.slice();
  let entries = snap.entries;
  // 过期未决的：到期自动执行或作废
  triggers = triggers.map((t) => {
    if ((t.status === 'pending' || t.status === 'will_fire') && t.dueDate < ctx.today) {
      if (t.status === 'will_fire') {
        const d = materialize({ kind: 'directive', directive: 'calorie_delta', kcal: t.action.kcal, effectiveFrom: t.dueDate, triggerId: t.id, date: t.dueDate, dateOrigin: 'device', source: { actor: 'rule', channel: 'ui', client: 'V8' } }, ctx);
        entries = [...entries, d];
        return { ...t, status: 'fired' as const };
      }
      return { ...t, status: 'not_met' as const };
    }
    return t;
  });
  const existing = triggers.find((t) => t.dueDate === check.dueDate);
  const status: Trigger['status'] = check.willFire ? 'will_fire' : 'pending';
  if (!existing) {
    triggers.push({ id: newId('t_'), rule: 'V8', dueDate: check.dueDate, metric: 'slope7d', threshold: check.threshold, current: check.slope7d, action: { type: 'calorie_delta', kcal: check.kcal }, status });
  } else if (existing.status === 'pending' || existing.status === 'will_fire') {
    triggers = triggers.map((t) => (t.id === existing.id ? { ...t, current: check.slope7d, status } : t));
  }
  return { ...snap, entries, triggers };
}

/** 用户对触发器的决定：采用（立即生效）或以后（写原因，本期作废）。 */
export function decideTrigger(snap: Snapshot, id: string, decision: 'accept' | 'later', reason: string | undefined, ctx: EngineContext): Snapshot {
  requireUser(ctx);
  const t = snap.triggers.find((x) => x.id === id);
  if (!t) throw new NotFoundError('没有这个触发器');
  if (decision === 'later') return { ...snap, triggers: snap.triggers.map((x) => (x.id === id ? { ...x, status: 'vetoed' as const, reason } : x)) };
  const d = materialize({ kind: 'directive', directive: 'calorie_delta', kcal: t.action.kcal, effectiveFrom: t.dueDate > ctx.today ? t.dueDate : ctx.today, triggerId: t.id, date: ctx.today, dateOrigin: 'device', source: ctx.source }, ctx);
  return { ...snap, entries: [...snap.entries, d], triggers: snap.triggers.map((x) => (x.id === id ? { ...x, status: 'accepted_early' as const } : x)) };
}
