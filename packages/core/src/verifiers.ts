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
  type Unit,
  type WaistEntry,
  type WeightEntry,
} from '@lowkkey/protocol';
import { bodyweightOn, dailyWeights, active, sessions } from './ledger.ts';
import { addDays, convert, dayIndex, diffDays, fromDayIndex, ols, round, toKg, weekStart } from './util.ts';

/* ═══════════════ V1 体重趋势 ═══════════════ */

export type Trend = { slopePerWeek: number; intercept: number; n: number; from: LocalDate; to: LocalDate; inputs: string[] };

/**
 * V1：对 (日序号, kg) 做最小二乘，斜率 × 7 = kg/周。
 * window 为天数（含当天）；省略则用全部读数。少于 3 个点返回 null。
 * 称重条件作为背景记录，不据此剔除。
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

/** 按某个速度从 fromKg 走到 targetKg 的日期；速度为零、方向相反或已达到返回 null。 */
export function projectDate(from: LocalDate, fromKg: number, ratePerWeek: number, targetKg: number): LocalDate | null {
  if (ratePerWeek === 0 || (targetKg-fromKg)*ratePerWeek <= 0) return null;
  return fromDayIndex(dayIndex(from) + Math.ceil(((targetKg - fromKg) / ratePerWeek) * 7));
}

/* ═══════════════ V2 / V3 e1RM 与有效负荷 ═══════════════ */

/** V2 Epley。reps < 1 或 > 20 返回 null。 */
export function e1rm(load: number, reps: number): number | null {
  if (reps < 1 || reps > 20 || load <= 0) return null;
  return reps===1?load:load * (1 + reps / 30);
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

/** V4：仅显式热身标记；负荷高低不能确定训练意图。 */
export function warmupFlags(sets: Pick<SetEntry,'setRole'>[]): boolean[] {
  return sets.map(set=>set.setRole==='warmup');
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
      return convert(INCREMENTS.assistKg,'kg',u);
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
 * - 次数 ≥ 上限 且 RIR ≥ 2 → 至多 +1 档（且不超过 10%）
 * - RIR = 1 或未知 → 保持
 * - RIR = 0 且 次数 ≥ 下限 → 保持
 * - 次数 < 下限 → −1 档
 * - 其余（在区间内且 RIR ≥ 1，或 RIR 未知）→ 保持
 */
/** At most one hardware step and 10% of effective load; this is a product guardrail. */
export function guardedStep(ex:Exercise,load:number,steps:number,bodyweightKg:number|null=null):number {
  const effective=ex.type==='assisted'?(bodyweightKg==null?null:convert(bodyweightKg,'kg',ex.unit)-load):load;
  const next=stepLoad(ex,load,steps);
  return effective==null||effective<=0||Math.abs(next-load)>effective*.1+1e-6?load:next;
}
export function nextSet(ex: Exercise, last: { load: number; reps: number; rir: number | null }, repMin: number, repMax: number,bodyweightKg:number|null=null): NextSet {
  const desired=last.reps<repMin?-1:last.reps>=repMax&&last.rir!=null&&last.rir>=2?1:0;
  const load=guardedStep(ex,last.load,desired,bodyweightKg),steps=load===last.load?0:desired;
  return {load,steps,reason:steps>0?'达到次数上限，还能再做至少 2 次；加一档':steps<0?'低于次数下限；减一档':desired?'器械档位超过 10% 或有效负荷未知，保持':'保持本组重量'};
}

/* ═══════════════ V6 双进阶 + 周期 ═══════════════ */

export function cycleWeek(cycleStart: LocalDate | null, date: LocalDate): number | null {
  if (!cycleStart) return null;
  const d = diffDays(date, cycleStart);
  return d < 0 ? null : Math.floor(d / 7) + 1;
}

export function rampFor(ramp: RampWeek[], week: number | null): RampWeek | null {
  if (week == null || week>ramp.length || ramp.length === 0) return null;
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
 * V6：最近完成场次的全部规定正式组达到上限且明确 RIR ≥ 1 → 至多 +1 档；否则沿用最近重量。
 * 没有历史 → startLoad（可能为 null：由你自选）。组数按周期系数缩放：max(2, round(sets × 系数))。
 */
export function prescribe(item: ProgramItem, ex: Exercise, entries: Entry[], asOf: LocalDate, program: Pick<Program, 'cycleStart' | 'ramp'>): Prescription {
  const week = cycleWeek(program.cycleStart, asOf);
  const r = rampFor(program.ramp, week);
  const sets = r ? Math.max(2, Math.round(item.sets * r.setMultiplier)) : item.sets;
  const base = { exerciseId: ex.id, unit: ex.unit, sets, repMin: item.repMin, repMax: item.repMax, targetRir: r?.targetRir ?? null };

  const last=sessions(entries).filter(session=>session.endedAt&&session.date<=asOf&&session.sets.some(set=>set.exerciseId===ex.id)).sort((a,b)=>a.endedAt!.localeCompare(b.endedAt!)).at(-1);
  const history=active(entries).filter((e):e is SetEntry=>e.kind==='set'&&e.exerciseId===ex.id&&e.date<=asOf);
  const previous=last?.sets.filter(set=>set.exerciseId===ex.id&&set.setRole!=='warmup')??history.filter(set=>set.setRole!=='warmup').slice(-1);
  if(!previous.length)return {...base,load:item.startLoad,reason:item.startLoad==null?'第一次练，重量自选':'计划起始重量',basedOn:[]};
  const recent=previous.at(-1)!,load=convert(recent.load,recent.unit,ex.unit);
  const required=last?.prescription?.find(it=>it.exerciseId===ex.id)?.sets;
  const work=previous.filter(set=>set.setRole==='work');
  const complete=!!last&&required!=null&&work.length>=required&&previous.every(set=>set.setRole==='work'&&set.reps>=item.repMax&&set.rir!=null&&set.rir>=1&&Math.abs(convert(set.load,set.unit,ex.unit)-load)<.01);
  const next=complete?guardedStep(ex,load,1,bodyweightOn(entries,last!.date)?.kg??null):load;
  return {...base,load:round(next,2),reason:next!==load?'上次完成全部正式组并达到上限，加一档':'沿用最近记录；资料不完整或未全部达到上限',basedOn:previous.map(set=>set.id)};
}

/* ═══════════════ V7 每周有效组 ═══════════════ */

export type VolumeRow = { muscle: Muscle; sets: number; planned:number; unknown:number; status:'recorded'; constraint:Constraint|null; inputs:string[] };
export function weeklyVolume(entries: Entry[], exercises: Exercise[], asOf: LocalDate, program: Pick<Program, 'targets' | 'constraints'|'days'>): VolumeRow[] {
  const from=weekStart(asOf),rows=new Map<Muscle,VolumeRow>();
  const row=(muscle:Muscle)=>{if(!rows.has(muscle))rows.set(muscle,{muscle,sets:0,planned:0,unknown:0,status:'recorded',constraint:program.constraints.find(c=>c.muscles.includes(muscle))??null,inputs:[]});return rows.get(muscle)!;};
  for(const day of program.days)for(const item of day.items){const ex=exercises.find(ex=>ex.id===item.exerciseId);if(ex)for(const [m,w] of Object.entries(ex.muscles) as [Muscle,number][])row(m).planned+=item.sets*w;}
  for(const set of active(entries)){
    if(set.kind!=='set'||set.date<from||set.date>asOf||set.setRole==='warmup')continue;
    const ex=exercises.find(ex=>ex.id===set.exerciseId);if(!ex)continue;
    for(const [m,w] of Object.entries(ex.muscles) as [Muscle,number][]){const value=row(m);if(set.setRole==='work')value.sets+=w;else value.unknown+=w;value.inputs.push(set.id);}
  }
  return [...rows.values()].map(row=>({...row,sets:round(row.sets,1),planned:round(row.planned,1),unknown:round(row.unknown,1)}));
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
  if (!cfg||!cfg.confirmedAt||!program.targets.goal?.confirmedAt||!program.targets.rateKgPerWeek||cfg.everyDays<14||program.targets.goal.mode==='record') return null;
  const ws = dailyWeights(entries).filter(w=>w.date<=today);
  const origin = program.cycleStart ?? ws[0]?.date;
  if (!origin) return null;
  const k = Math.max(1, Math.ceil(diffDays(today, origin) / cfg.everyDays));
  const dueDate = addDays(origin, k * cfg.everyDays);
  const observed=ws.filter(w=>diffDays(today,w.date)<cfg.everyDays);
  const enough=observed.length>=7&&diffDays(observed.at(-1)!.date,observed[0]!.date)>=Math.min(13,cfg.everyDays-1);
  const t = enough?trend(entries,today,cfg.everyDays):null;
  const slope = t?.slopePerWeek ?? null;
  return { dueDate, threshold: cfg.thresholdKgPerWeek, kcal: cfg.kcalDelta, slope7d: slope, willFire: slope != null && (cfg.comparison==='below'?slope<cfg.thresholdKgPerWeek:slope>cfg.thresholdKgPerWeek) };
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
  return { ratio, ok: null, inputs: [first.id, last.id, b0.id, b1.id] };
}

/* ═══════════════ V10 称重条件 ═══════════════ */

export function weighinObservation(entries: Entry[], asOf: LocalDate): { nonstandard: WeightEntry[]; belowTrend: number } {
  const t = trend(entries, asOf);
  const non = dailyWeights(entries).filter((w) => w.condition === 'post_bm');
  const below = t ? non.filter((w) => w.kg < trendAt(t, w.date)).length : 0;
  return { nonstandard: non, belowTrend: below };
}
