import {
  BAR,
  INCREMENTS,
  PLATES,
  type Constraint,
  type Entry,
  type Exercise,
  type LocalDate,
  type Muscle,
  type Program,
  type ProgramItem,
  type RampWeek,
  type SetEntry,
  type Targets,
  type Unit,
  type WaistEntry,
  type WeightEntry,
} from '@lowkkey/protocol';
import { bodyweightOn, dailyWeights, active } from './ledger.ts';
import { addDays, convert, dayIndex, diffDays, fromDayIndex, ols, round, toKg, weekStart } from './util.ts';

/* ═══════════════ V1 体重趋势 ═══════════════ */

export type Trend = { slopePerWeek: number; intercept: number; n: number; from: LocalDate; to: LocalDate; inputs: string[] };

/**
 * V1：对 (日序号, kg) 做最小二乘，斜率 × 7 = kg/周。
 * window 为天数（含当天）；省略则用全部读数。少于 3 个点返回 null。
 * 非标准条件（排便后）的读数同样参与，只标注不剔除。
 */
export function trend(entries: Entry[], asOf: LocalDate, windowDays?: number): Trend | null {
  const pts = dailyWeights(entries).filter((w) => w.date <= asOf && (windowDays == null || diffDays(asOf, w.date) < windowDays));
  if (pts.length < 3) return null;
  const fit = ols(
    pts.map((p) => dayIndex(p.date)),
    pts.map((p) => p.kg),
  );
  if (!fit) return null;
  return { slopePerWeek: fit.slope * 7, intercept: fit.intercept, n: pts.length, from: pts[0]!.date, to: pts[pts.length - 1]!.date, inputs: pts.map((p) => p.id) };
}

/** 趋势线在某日的拟合值。 */
export function trendAt(t: Trend, d: LocalDate): number {
  return t.intercept + (t.slopePerWeek / 7) * dayIndex(d);
}

/** 按某个速度从 fromKg 走到 targetKg 的日期；速度 ≤ 0 或已达到返回 null。 */
export function projectDate(from: LocalDate, fromKg: number, ratePerWeek: number, targetKg: number): LocalDate | null {
  if (ratePerWeek <= 0 || targetKg <= fromKg) return null;
  return fromDayIndex(dayIndex(from) + Math.ceil(((targetKg - fromKg) / ratePerWeek) * 7));
}

/* ═══════════════ V2 / V3 e1RM 与有效负荷 ═══════════════ */

/** V2 Epley。reps < 1 或 > 20 返回 null。 */
export function e1rm(load: number, reps: number): number | null {
  if (reps < 1 || reps > 20 || load <= 0) return null;
  return load * (1 + reps / 30);
}

/**
 * V3 有效负荷，统一换算到动作单位（exercise.unit）。
 * assist：体重 − 辅助（kg）；bodyweight：体重（+ 负重）。无体重时辅助动作返回 null。
 */
export function effectiveLoad(set: SetEntry, ex: Exercise, bodyweightKg: number | null): number | null {
  if (set.loadKind === 'assist' || (ex.type === 'assisted' && set.loadKind !== 'external')) {
    if (bodyweightKg == null) return null;
    return convert(bodyweightKg - toKg(set.load, set.unit), 'kg', ex.unit);
  }
  if (set.loadKind === 'bodyweight') {
    if (bodyweightKg == null) return null;
    return convert(bodyweightKg + toKg(set.load, set.unit), 'kg', ex.unit);
  }
  return convert(set.load, set.unit, ex.unit);
}

/* ═══════════════ V4 热身 ═══════════════ */

/** V4：同场同动作中，负荷 < 最高组 85% 的组为热身。返回与输入等长的布尔数组。 */
export function warmupFlags(loads: (number | null)[]): boolean[] {
  const max = Math.max(...loads.map((l) => l ?? 0));
  return loads.map((l) => l != null && max > 0 && l < 0.85 * max);
}

/* ═══════════════ 档位与杠片 ═══════════════ */

const LOWER: Muscle[] = ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'];

export function isLowerBody(ex: Exercise): boolean {
  const entries = Object.entries(ex.muscles) as [Muscle, number][];
  const primary = entries.filter(([, w]) => w >= 1).map(([m]) => m);
  return primary.some((m) => LOWER.includes(m));
}

/** 一档加重（动作单位）。辅助动作的「加重」= 减少辅助，由调用方取反。 */
export function increment(ex: Exercise): number {
  if (ex.increment) return ex.increment;
  const u = ex.unit;
  switch (ex.type) {
    case 'barbell':
      return isLowerBody(ex) ? (u === 'lb' ? INCREMENTS.barbellLowerLb : INCREMENTS.barbellLowerKg) : u === 'lb' ? INCREMENTS.barbellUpperLb : INCREMENTS.barbellUpperKg;
    case 'dumbbell':
      return u === 'lb' ? INCREMENTS.dumbbellLb : INCREMENTS.dumbbellKg;
    case 'assisted':
      return INCREMENTS.assistKg;
    default:
      return u === 'kg' ? INCREMENTS.machineKg : INCREMENTS.machineLb;
  }
}

/** 按档位移动负荷：steps > 0 表示更难。辅助动作更难 = 辅助更少。 */
export function stepLoad(ex: Exercise, load: number, steps: number): number {
  const inc = increment(ex);
  const next = ex.type === 'assisted' ? load - steps * inc : load + steps * inc;
  return Math.max(0, round(next, 2));
}

/** 杠片：每侧从大到小贪心。返回每侧片重列表与无法凑出的余数。 */
export function plates(total: number, unit: Unit, bar: number = BAR[unit]): { perSide: number[]; bar: number; remainder: number } {
  let side = (total - bar) / 2;
  const perSide: number[] = [];
  if (side < 0) return { perSide, bar, remainder: round(total - bar, 2) };
  for (const p of PLATES[unit]) {
    while (side + 1e-9 >= p) {
      perSide.push(p);
      side -= p;
    }
  }
  return { perSide, bar, remainder: round(side * 2, 2) };
}

/* ═══════════════ V5 组内调节 ═══════════════ */

export type NextSet = { load: number; reason: string; steps: number };

/**
 * V5：
 * - 次数 ≥ 上限 且 RIR ≥ 2 → +2 档
 * - 次数 ≥ 上限 且 RIR = 1 → +1 档
 * - RIR = 0 且 次数 ≥ 下限 → 保持
 * - 次数 < 下限 → −1 档
 * - 其余（在区间内且 RIR ≥ 1，或 RIR 未知）→ 保持
 */
export function nextSet(ex: Exercise, last: { load: number; reps: number; rir: number | null }, repMin: number, repMax: number): NextSet {
  const { reps, rir } = last;
  let steps = 0;
  let reason = '在区间内，保持';
  if (reps < repMin) {
    steps = -1;
    reason = `次数 ${reps} 低于下限 ${repMin}，降一档`;
  } else if (reps >= repMax && rir != null && rir >= 2) {
    steps = 2;
    reason = `已到上限 ${repMax}，RIR ${rir} ≥ 2，加两档`;
  } else if (reps >= repMax && rir === 1) {
    steps = 1;
    reason = `已到上限 ${repMax}，RIR 1，加一档`;
  } else if (rir === 0) {
    reason = `RIR 0，保持`;
  }
  return { load: stepLoad(ex, last.load, steps), reason, steps };
}

/* ═══════════════ V6 双进阶 + 周期 ═══════════════ */

export function cycleWeek(cycleStart: LocalDate | null, date: LocalDate): number | null {
  if (!cycleStart) return null;
  const d = diffDays(date, cycleStart);
  return d < 0 ? null : Math.floor(d / 7) + 1;
}

export function rampFor(ramp: RampWeek[], week: number | null): RampWeek | null {
  if (week == null || ramp.length === 0) return null;
  const idx = Math.min(week, ramp.length) - 1;
  return ramp[idx] ?? null;
}

export type Prescription = {
  exerciseId: string;
  load: number | null;
  unit: Unit;
  sets: number;
  repMin: number;
  repMax: number;
  targetRir: number | null;
  reason: string;
  basedOn: string[];
};

/**
 * V6：上次该动作所有有效组都达到上限，且 RIR ≥ 1（或未记录）→ +1 档；否则保持上次最重有效组。
 * 没有历史 → startLoad（可能为 null：由你自选）。组数按周期系数缩放：max(2, round(sets × 系数))。
 */
export function prescribe(item: ProgramItem, ex: Exercise, entries: Entry[], asOf: LocalDate, program: Pick<Program, 'cycleStart' | 'ramp'>): Prescription {
  const week = cycleWeek(program.cycleStart, asOf);
  const r = rampFor(program.ramp, week);
  const sets = r ? Math.max(2, Math.round(item.sets * r.setMultiplier)) : item.sets;
  const base = { exerciseId: ex.id, unit: ex.unit, sets, repMin: item.repMin, repMax: item.repMax, targetRir: r?.targetRir ?? null };

  const hist = active(entries).filter((e): e is SetEntry => e.kind === 'set' && e.exerciseId === ex.id && e.date < asOf);
  if (hist.length === 0) {
    return { ...base, load: item.startLoad, reason: item.startLoad == null ? '第一次练，重量自选' : '计划起始重量', basedOn: [] };
  }
  const lastDate = hist.reduce((m, s) => (s.date > m ? s.date : m), hist[0]!.date);
  const last = hist.filter((s) => s.date === lastDate);
  const loads = last.map((s) => convert(s.load, s.unit, ex.unit));
  const warm = ex.type === 'assisted' ? loads.map(() => false) : warmupFlags(loads);
  const work = last.filter((_, i) => !warm[i]);
  const workLoads = work.map((s) => convert(s.load, s.unit, ex.unit));
  const top = ex.type === 'assisted' ? Math.min(...workLoads) : Math.max(...workLoads);
  const allTop = work.every((s) => s.reps >= item.repMax && (s.rir == null || s.rir >= 1));
  if (allTop) {
    return { ...base, load: stepLoad(ex, top, 1), reason: `${lastDate} 全部有效组达到 ${item.repMax} 次，加一档`, basedOn: work.map((s) => s.id) };
  }
  return { ...base, load: round(top, 2), reason: `${lastDate} 未全部达到上限，保持`, basedOn: work.map((s) => s.id) };
}

/* ═══════════════ V7 每周有效组 ═══════════════ */

export type VolumeRow = { muscle: Muscle; sets: number; status: 'low' | 'ok' | 'high' | 'constrained'; constraint: Constraint | null; inputs:string[] };

function classify(muscle: Muscle, sets: number, targets: Pick<Targets, 'weeklySets'>, constraints: Constraint[],inputs:string[]=[]): VolumeRow {
  const c = constraints.find((k) => k.muscles.includes(muscle)) ?? null;
  const status: VolumeRow['status'] = c && sets < targets.weeklySets.min ? 'constrained' : sets < targets.weeklySets.min ? 'low' : sets > targets.weeklySets.max ? 'high' : 'ok';
  return { muscle, sets: round(sets, 1), status, constraint: c, inputs };
}

/** V7（实际）：本周（周一起）已完成的有效组（不含热身）。 */
export function weeklyVolume(entries: Entry[], exercises: Exercise[], asOf: LocalDate, program: Pick<Program, 'targets' | 'constraints'>): VolumeRow[] {
  const from = weekStart(asOf);
  const to = addDays(from, 6);
  const acc = new Map<Muscle, number>();
  const ids = new Map<Muscle,string[]>();
  const bySessionEx = new Map<string, SetEntry[]>();
  for (const e of active(entries)) {
    if (e.kind !== 'set' || e.date < from || e.date > to) continue;
    const k = `${e.sessionId}|${e.exerciseId}`;
    (bySessionEx.get(k) ?? bySessionEx.set(k, []).get(k)!).push(e);
  }
  for (const group of bySessionEx.values()) {
    const ex = exercises.find((x) => x.id === group[0]!.exerciseId);
    if (!ex) continue;
    const loads = group.map((s) => convert(s.load, s.unit, ex.unit));
    const warm = ex.type === 'assisted' ? loads.map(() => false) : warmupFlags(loads);
    const work = group.filter((_, i) => !warm[i]);
    for (const [m, w] of Object.entries(ex.muscles) as [Muscle, number][]) {
      acc.set(m, (acc.get(m) ?? 0) + work.length * w);
      ids.set(m,[...(ids.get(m)??[]),...work.map(set=>set.id)]);
    }
  }
  return [...acc.entries()].map(([m, s]) => classify(m, s, program.targets, program.constraints,ids.get(m)??[])).sort((a, b) => b.sets - a.sets);
}

/* ═══════════════ V8 热量触发器 ═══════════════ */

export type CalorieCheck = {
  dueDate: LocalDate;
  threshold: number;
  kcal: number;
  slope7d: number | null;
  willFire: boolean;
};

/** V8：判决日 = 周期起点（或首次称重）+ k × everyDays 中不早于今天的最近一天。 */
export function calorieCheck(entries: Entry[], program: Program, today: LocalDate): CalorieCheck | null {
  const cfg = program.targets.calorieTrigger;
  if (!cfg) return null;
  const ws = dailyWeights(entries);
  const origin = program.cycleStart ?? ws[0]?.date;
  if (!origin) return null;
  const k = Math.max(1, Math.ceil(diffDays(today, origin) / cfg.everyDays));
  const dueDate = addDays(origin, k * cfg.everyDays);
  const t = trend(entries, today, 7);
  const slope = t?.slopePerWeek ?? null;
  return { dueDate, threshold: cfg.thresholdKgPerWeek, kcal: cfg.kcalDelta, slope7d: slope, willFire: slope != null && slope > cfg.thresholdKgPerWeek };
}

/* ═══════════════ V9 腰围 ═══════════════ */

/** V9：以首次腰围为基线，Δ腰围(cm) / Δ体重(kg)。 */
export function waistRatio(entries: Entry[]): { ratio: number | null; ok: boolean | null; inputs: string[] } {
  const ws = active(entries).filter((e): e is WaistEntry => e.kind === 'waist').sort((a, b) => a.date.localeCompare(b.date));
  if (ws.length < 2) return { ratio: null, ok: null, inputs: ws.map((w) => w.id) };
  const first = ws[0]!;
  const last = ws[ws.length - 1]!;
  const b0 = bodyweightOn(entries, first.date);
  const b1 = bodyweightOn(entries, last.date);
  if (!b0 || !b1 || b1.kg - b0.kg <= 0.2) return { ratio: null, ok: null, inputs: [first.id, last.id] };
  const ratio = (last.cm - first.cm) / (b1.kg - b0.kg);
  return { ratio, ok: ratio <= 0.5, inputs: [first.id, last.id, b0.id, b1.id] };
}

/* ═══════════════ V10 称重条件 ═══════════════ */

export function weighinObservation(entries: Entry[], asOf: LocalDate): { nonstandard: WeightEntry[]; belowTrend: number } {
  const t = trend(entries, asOf);
  const non = dailyWeights(entries).filter((w) => w.condition === 'post_bm');
  const below = t ? non.filter((w) => w.kg < trendAt(t, w.date)).length : 0;
  return { nonstandard: non, belowTrend: below };
}
