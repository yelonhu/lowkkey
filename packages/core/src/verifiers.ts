import {
  BAR,
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
import { bodyweightOn, dailyWeights, active } from './ledger.ts';
import { trainingReference } from './training-reference.ts';
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

/** 左右对称配片：优先精确匹配、再选较少片数，返回每侧片重及总重差额。 */
export function plates(total: number, unit: Unit, bar: number = BAR[unit], available:readonly number[]=PLATES[unit]): { perSide: number[]; bar: number; remainder: number } {
  const perSide:number[]=[],side=(total-bar)/2;
  if(side<0)return {perSide,bar,remainder:round(total-bar,2)};
  if(!Number.isFinite(side)||side>1000||!available.length)return {perSide,bar,remainder:round(total-bar,2)};
  // Integer hundredths avoid fractional drift. Dynamic programming handles
  // custom sets (e.g. 4 + 3) where greedy selection misses an exact solution.
  const target=Math.floor(side*100+1e-7),coins=[...new Set(available.map(p=>Math.round(p*100)))].filter(p=>p>0).sort((a,b)=>b-a);
  const counts=new Int32Array(target+1).fill(target+1),last=new Int32Array(target+1);counts[0]=0;
  for(let amount=1;amount<=target;amount++)for(const coin of coins)if(coin<=amount&&counts[amount-coin]+1<counts[amount]){counts[amount]=counts[amount-coin]+1;last[amount]=coin;}
  let matched=target;while(matched>0&&!last[matched])matched--;
  for(let amount=matched;amount>0;amount-=last[amount])perSide.push(last[amount]/100);
  return {perSide:perSide.sort((a,b)=>b-a),bar,remainder:round(total-bar-2*matched/100,2)};
}

/* ═══════════════ V6 跨场录入参考与已确认组次 ═══════════════ */

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

/** Actual history wins; a confirmed arrangement remains an explicit alternative. */
export function prescribe(item: ProgramItem, ex: Exercise, entries: Entry[], asOf: LocalDate, program: Pick<Program, 'cycleStart' | 'ramp'>): Prescription {
  const r=rampFor(program.ramp,cycleWeek(program.cycleStart,asOf));
  const reference=trainingReference(entries,ex,asOf,{item});
  const load=reference.load==null?null:round(convert(reference.load,reference.unit,ex.unit),2);
  return {exerciseId:ex.id,unit:ex.unit,sets:r?Math.max(2,Math.round(item.sets*r.setMultiplier)):item.sets,repMin:item.repMin,repMax:item.repMax,targetRir:r?.targetRir??null,
    load,reason:reference.entryId?`沿用 ${reference.date} 实际记录 ${reference.load} ${reference.unit}${reference.unit===ex.unit?'':` → ${load} ${ex.unit}`}；不自动加减重量`:load==null?'尚无重量依据，由你填写':'已确认安排的参考重量',basedOn:reference.entryId?[reference.entryId]:[]};
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
