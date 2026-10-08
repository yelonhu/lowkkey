import { describe, expect, it } from 'vitest';
import { Brief, GainTarget, SessionInput, type Facts, type Plan, type TrainingSet, type Weight } from '@lowkkey/protocol';
import { bestSets, currentContext, e1rm, effectiveLoad, getBrief, scoreSet, strengthSeries, targetAt, weightMean, weightSeries } from '../src/index.ts';

const stamp = '2026-10-08T00:00:00Z';
const weight = (date: string, lb: number): Weight => ({ date, lb, updated_at: stamp });
const set = (patch: Partial<TrainingSet> = {}): TrainingSet => ({ exerciseId: 'bench_press', load: 100, unit: 'lb', loadKind: 'external', reps: 6, ...patch });
const session = (date: string, sets: TrainingSet[]) => ({ date, sets, raw_text: 'original\ntext', updated_at: stamp });
const empty: Facts = { sessions: [], weights: [], plans: [] };
const plan = (day: string, patch: Partial<Plan>): Plan => ({ day, items: [], notes: {}, updated_at: stamp, body_revision: null, gain_target_revision: null, ...patch });

describe('deterministic showroom metrics', () => {
  it('keeps actual singles and applies Epley only to eligible repetitions', () => {
    expect(e1rm(100,1)).toBe(100); expect(e1rm(100,6)).toBe(120);
    for (const reps of [0,21,2.5]) expect(e1rm(100,reps)).toBeNull();
    expect(e1rm(0,6)).toBeNull(); expect(e1rm(NaN,6)).toBeNull();
  });
  it('normalizes units without doubling per-hand dumbbells', () => {
    expect(effectiveLoad(set({ load: 50, unit: 'kg' }), null)).toBeCloseTo(110.231);
    expect(scoreSet(set({ exerciseId: 'db_shoulder_press', load: 40 }), [], '2026-10-08')).toBe(48);
  });
  it('uses the latest body weight on or before the session, never a future measurement', () => {
    const weights = [weight('2026-10-09',200), weight('2026-10-01',160), weight('2026-10-08',165)];
    const pull = set({ exerciseId: 'pull_up', loadKind: 'assist', load: 20, unit: 'kg' });
    expect(scoreSet(pull, weights, '2026-10-07')).toBeCloseTo((160 - 44.0924)*1.2);
    expect(scoreSet(pull, weights, '2026-09-30')).toBeNull();
    expect(scoreSet({ ...pull, loadKind: 'bodyweight', load: 10, unit: 'lb' }, weights, '2026-10-08')).toBe(210);
    expect(effectiveLoad({ ...pull, load: 1000 },160)).toBeNull();
  });
  it('selects a daily best eligible set and breaks ties by original order', () => {
    const s = session('2026-10-08',[set({ load: 200, setRole: 'warmup' }),set(),set({load:120,reps:1}),set({load:400,reps:21})]);
    expect(bestSets(s,[]).bench_press).toEqual({set_index:1,lb:120});
    const series = strengthSeries({ ...empty, sessions:[s,session('2026-10-01',[set({load:90})])] });
    expect(series).toHaveLength(4); expect(series[0].points.map(p=>p.date)).toEqual(['2026-10-01','2026-10-08']);
    expect(series[0].best?.lb).toBe(120); expect(series[3].points).toEqual([]);
  });
  it('averages seven calendar days, including sparse data and excluding future/old measurements', () => {
    const weights = [weight('2026-10-01',100),weight('2026-10-02',160),weight('2026-10-08',166),weight('2026-10-09',999)];
    expect(weightMean(weights,'2026-10-08')).toEqual({date:'2026-10-08',lb:163,samples:2});
    expect(weightMean(weights,'2026-09-30').lb).toBeNull();
    expect(weightMean(weights,'2026-10-16')).toEqual({date:'2026-10-16',lb:null,samples:0});
  });
  it('leaves empty windows blank and handles leap-day windows', () => {
    const weights = [weight('2024-02-29',160),weight('2024-03-10',170)];
    const series = weightSeries(weights);
    expect(series.find(p=>p.date==='2024-03-06')?.lb).toBe(160);
    expect(series.find(p=>p.date==='2024-03-07')?.lb).toBeNull();
    expect(series.at(-1)?.samples).toBe(1);
  });
  it('computes target bounds from explicit date and weekly rates', () => {
    const target = {start_date:'2026-10-01',start_lb:160,weekly_lb_min:.25,weekly_lb_max:.5};
    expect(targetAt(target,'2026-10-15')).toEqual({date:'2026-10-15',min:160.5,max:161});
    expect(targetAt(target,'2026-09-30')).toBeNull();
    expect(GainTarget.safeParse({...target,weekly_lb_min:1}).success).toBe(false);
  });
  it('uses explicit context revisions, including a null tombstone', () => {
    const plans = [plan('A',{notes:{body:'old'},body_revision:1}),plan('B',{notes:{body:null},body_revision:2}),plan('C',{notes:{coach:'latest unrelated update'}})];
    expect(currentContext(plans).body_notes).toBeNull();
    expect(currentContext(plans.slice(0,1)).body_notes).toBe('old');
  });
  it('preserves raw text, returns 30 recent dates, and labels the latest weight mean date', () => {
    const facts = {...empty, sessions:Array.from({length:31},(_,i)=>session('2026-08-'+String(i+1).padStart(2,'0'),[])),weights:[weight('2026-09-01',160)]};
    const brief = getBrief(facts);
    expect(brief.sessions).toHaveLength(30); expect(brief.sessions[0].date).toBe('2026-08-31');
    expect(brief.sessions[0].raw_text).toBe('original\ntext'); expect(brief.weight_mean_7d?.date).toBe('2026-09-01');
    expect(getBrief(empty).weight_mean_7d).toBeNull();
    expect(brief.coverage.training).toEqual({first_date:'2026-08-01',last_date:'2026-08-31',total_dates:31,returned_dates:30});
    expect(brief.coverage.weight.last_date).toBe('2026-09-01');
  });
  it('explains missing metrics without mistaking future body weight for usable data', () => {
    const brief = getBrief({...empty, weights:[weight('2026-10-09',160)],sessions:[session('2026-10-08',[
      set({exerciseId:'pull_up',loadKind:'bodyweight',load:0}), set({setRole:'warmup'}), set({reps:21}), set({load:0}),
    ])]},stamp);
    expect(Brief.parse(brief).generated_at).toBe(stamp);
    expect(brief.strength[0].recorded_sets).toBe(3);
    expect(brief.strength[0].excluded_sets).toEqual([{reason:'warmup',count:1},{reason:'reps_out_of_range',count:1},{reason:'non_positive_load',count:1}]);
    expect(brief.strength[3].excluded_sets).toEqual([{reason:'missing_bodyweight',count:1}]);
    expect(brief.strength[3].latest).toBeNull();
    expect(brief.strength[1].recorded_sets).toBe(0);
    expect(Brief.parse(getBrief(empty,stamp)).coverage.training.first_date).toBeNull();
  });
  it('rejects invalid dates, unknown units, and ambiguous pull-up load semantics', () => {
    expect(SessionInput.safeParse({date:'2026-02-30',raw_text:'x',sets:[]}).success).toBe(false);
    expect(SessionInput.safeParse({date:'2026-10-08',raw_text:'x',sets:[{...set(),unit:'pounds'}]}).success).toBe(false);
    expect(SessionInput.safeParse({date:'2026-10-08',raw_text:'x',sets:[set({exerciseId:'pull_up'})]}).success).toBe(false);
  });
});
