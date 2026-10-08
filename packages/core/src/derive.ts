import { STRENGTH_EXERCISES, exerciseById, type Brief, type Facts, type Plan, type StrengthSeries, type TrainingSession, type Weight } from '@lowkkey/protocol';
import { addDays } from './util.ts';
import { scoreSet, setExclusion, weightMean } from './verifiers.ts';

export function currentContext(plans: Plan[]) {
  const latest = (key: 'body_revision' | 'gain_target_revision') => plans.reduce<Plan | null>((best, plan) =>
    plan[key] != null && (best?.[key] == null || plan[key]! > best[key]!) ? plan : best, null);
  return {
    body_notes: latest('body_revision')?.notes.body ?? null,
    gain_target: latest('gain_target_revision')?.notes.gain_target ?? null,
  };
}
export function bestSets(session: TrainingSession, weights: Weight[]) {
  const best: Record<string, { set_index: number; lb: number }> = {};
  session.sets.forEach((set, index) => {
    const lb = scoreSet(set, weights, session.date);
    if (lb != null && (!best[set.exerciseId] || lb > best[set.exerciseId].lb)) best[set.exerciseId] = { set_index: index, lb };
  });
  return best;
}
export function strengthSeries(facts: Facts): StrengthSeries[] {
  const sessions = [...facts.sessions].sort((a, b) => a.date.localeCompare(b.date));
  const scored = sessions.map(session => ({ date: session.date, best: bestSets(session, facts.weights) }));
  return STRENGTH_EXERCISES.map(exerciseId => {
    const exercise = exerciseById(exerciseId);
    const points = scored.flatMap(row => row.best[exerciseId] ? [{ date: row.date, ...row.best[exerciseId] }] : []);
    return {
      exerciseId, name: exercise.name, per_hand: exercise.perHand, unit: 'lb',
      points, best: points.reduce<StrengthSeries['best']>((best, point) => !best || point.lb > best.lb ? point : best, null),
      latest: points.at(-1) ?? null,
    };
  });
}
export function weightSeries(weights: Weight[]) {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];
  const result = [];
  for (let date = sorted[0].date; date <= sorted.at(-1)!.date; date = addDays(date, 1)) result.push(weightMean(sorted, date));
  return result;
}
export function getBrief(facts: Facts, generatedAt = new Date().toISOString()): Brief {
  const latest = [...facts.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  const coverage = (rows: { date: string }[]) => {
    const dates = [...new Set(rows.map(row => row.date))].sort();
    return { first_date: dates[0] ?? null, last_date: dates.at(-1) ?? null, total_dates: dates.length };
  };
  return {
    generated_at: generatedAt,
    coverage: { training: { ...coverage(facts.sessions), returned_dates: Math.min(facts.sessions.length, 30) }, weight: coverage(facts.weights) },
    sessions: [...facts.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
    plans: facts.plans, latest_weight: latest,
    weight_mean_7d: latest ? weightMean(facts.weights, latest.date) : null,
    ...currentContext(facts.plans),
    strength: strengthSeries(facts).map(series => {
      const excluded = new Map<NonNullable<ReturnType<typeof setExclusion>>, number>();
      let recorded_sets = 0;
      for (const session of facts.sessions) for (const set of session.sets) {
        if (set.exerciseId !== series.exerciseId) continue;
        recorded_sets++;
        const reason = setExclusion(set, facts.weights, session.date);
        if (reason) excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
      }
      return { exerciseId: series.exerciseId, name: series.name, per_hand: series.per_hand, unit: series.unit, best: series.best, latest: series.latest,
        recorded_sets, excluded_sets: [...excluded].map(([reason, count]) => ({ reason, count })) };
    }),
  };
}
