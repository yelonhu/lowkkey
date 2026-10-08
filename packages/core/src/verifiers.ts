import type { ExclusionReason, GainTarget, TrainingSet, Weight } from '@lowkkey/protocol';
import { diffDays, toLb } from './util.ts';

// Epley; one completed rep is the actual load, not an inflated estimate.
export function e1rm(load: number, reps: number): number | null {
  if (!Number.isFinite(load) || load <= 0 || !Number.isInteger(reps) || reps < 1 || reps > 20) return null;
  return reps === 1 ? load : load * (1 + reps / 30);
}
export function bodyweightOn(weights: Weight[], date: string): Weight | null {
  return weights.reduce<Weight | null>((latest, weight) =>
    weight.date <= date && (!latest || weight.date > latest.date) ? weight : latest, null);
}
export function effectiveLoad(set: TrainingSet, bodyLb: number | null): number | null {
  const load = toLb(set.load, set.unit);
  if (set.loadKind === 'external') return load;
  if (bodyLb == null) return null;
  const effective = bodyLb + (set.loadKind === 'assist' ? -load : load);
  return effective > 0 ? effective : null;
}
export function scoreSet(set: TrainingSet, weights: Weight[], date: string): number | null {
  if (setExclusion(set, weights, date)) return null;
  const load = effectiveLoad(set, bodyweightOn(weights, date)?.lb ?? null);
  return load == null ? null : e1rm(load, set.reps);
}
export function setExclusion(set: TrainingSet, weights: Weight[], date: string): ExclusionReason | null {
  if (set.setRole === 'warmup') return 'warmup';
  if (set.reps < 1 || set.reps > 20) return 'reps_out_of_range';
  const body = bodyweightOn(weights, date)?.lb ?? null;
  if (set.loadKind !== 'external' && body == null) return 'missing_bodyweight';
  const load = effectiveLoad(set, body);
  return load == null || load <= 0 ? 'non_positive_load' : null;
}
export function weightMean(weights: Weight[], date: string) {
  const window = weights.filter(weight => { const days = diffDays(date, weight.date); return days >= 0 && days < 7; });
  return { date, lb: window.length ? window.reduce((sum, weight) => sum + weight.lb, 0) / window.length : null, samples: window.length };
}
export function targetAt(target: GainTarget, date: string) {
  const weeks = diffDays(date, target.start_date) / 7;
  return weeks < 0 ? null : { date, min: target.start_lb + weeks * target.weekly_lb_min, max: target.start_lb + weeks * target.weekly_lb_max };
}
