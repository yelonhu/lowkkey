import { describe, expect, it } from 'vitest';
import { EXERCISE_LIBRARY, MCP_TOOLS, PROGRAM_TEMPLATES, Snapshot as SnapshotSchema, type EntryDraft, type Snapshot } from '@lowkkey/protocol';
import {
  ForbiddenError,
  addDays,
  capture,
  decideTrigger,
  derive,
  e1rm,
  emptySnapshot,
  endSession,
  log,
  logSet,
  nextSet,
  parse,
  plates,
  prescribe,
  refreshTriggers,
  resolveHeld,
  revert,
  startSession,
  trend,
  warmupFlags,
  weekStart,
  weekday,
  type EngineContext,
} from '../src/index.ts';

/* 全部为合成数据，不含任何真实用户记录。 */

const TODAY = '2030-03-14';
const user = (today = TODAY): EngineContext => ({ now: `${today}T12:00:00.000Z`, today, source: { actor: 'user', channel: 'text', client: 'web' } });
const model = (today = TODAY): EngineContext => ({ now: `${today}T12:00:00.000Z`, today, source: { actor: 'model', channel: 'mcp', client: 'test-model' } });
const ex = (id: string) => EXERCISE_LIBRARY.find((x) => x.id === id)!;
const fresh = (): Snapshot => emptySnapshot(TODAY, 'UTC', structuredClone(PROGRAM_TEMPLATES[0]!.program));

function withWeights(snap: Snapshot, series: [string, number][]): Snapshot {
  let s = snap;
  for (const [d, kg] of series) s = log(s, [{ kind: 'weight', kg, raw: { value: kg, unit: 'kg' }, condition: 'fasted', date: d, dateOrigin: 'explicit', source: { actor: 'user', channel: 'ui' } }], user(d)).snap;
  return s;
}

describe('util', () => {
  it('日期运算', () => {
    expect(addDays('2030-02-28', 1)).toBe('2030-03-01');
    expect(weekday('2030-03-14')).toBe(4); // 周四
    expect(weekStart('2030-03-17')).toBe('2030-03-11'); // 周日 → 本周一
  });
});

describe('verifiers', () => {
  it('V2 Epley', () => {
    expect(e1rm(100, 10)).toBeCloseTo(133.33, 2);
    expect(e1rm(100, 21)).toBeNull();
  });

  it('杠片', () => {
    expect(plates(125, 'lb').perSide).toEqual([35, 5]);
    expect(plates(135, 'lb').perSide).toEqual([45]);
    expect(plates(100, 'kg').perSide).toEqual([25, 15]);
    expect(plates(40, 'lb').remainder).toBe(-5);
  });

  it('V1 线性序列斜率', () => {
    const s = withWeights(fresh(), [0, 1, 2, 3, 4, 5, 6].map((i) => [addDays('2030-03-01', i), 70 + i * 0.1] as [string, number]));
    const t = trend(s.entries, '2030-03-07')!;
    expect(t.slopePerWeek).toBeCloseTo(0.7, 6);
    expect(trend(s.entries, '2030-03-07', 7)!.n).toBe(7);
  });

  it('V4 热身', () => {
    expect(warmupFlags([60, 80, 100, 100])).toEqual([true, true, false, false]);
  });

  it('V5 组内调节', () => {
    const bench = ex('bench_press');
    expect(nextSet(bench, { load: 135, reps: 8, rir: 2 }, 5, 8).load).toBe(145);
    expect(nextSet(bench, { load: 135, reps: 8, rir: 1 }, 5, 8).load).toBe(140);
    expect(nextSet(bench, { load: 135, reps: 6, rir: 0 }, 5, 8).load).toBe(135);
    expect(nextSet(bench, { load: 135, reps: 4, rir: 0 }, 5, 8).load).toBe(130);
    expect(nextSet(ex('pull_up'), { load: 20, reps: 8, rir: 2 }, 5, 8).load).toBeCloseTo(15.4, 5); // 辅助减少
  });

  it('V6 双进阶：下肢杠铃 +10 lb', () => {
    let s = fresh();
    const ctx = user('2030-03-10');
    for (let i = 0; i < 3; i++) s = logSet(s, { sessionId: 's1', exerciseId: 'back_squat', load: 185, unit: 'lb', reps: 8, rir: 2 }, ctx).snap;
    const rx = prescribe({ exerciseId: 'back_squat', sets: 4, repMin: 6, repMax: 8, startLoad: null }, ex('back_squat'), s.entries, TODAY, s.program);
    expect(rx.load).toBe(195);
  });
});

describe('parser', () => {
  const ctx = { today: TODAY, exercises: EXERCISE_LIBRARY };

  it('一句话里的多组、引用与体重', () => {
    const r = parse('卧推 95lb*5+135lb*8+145lb*6+145lb*4，145那组rir0。今日体重150lb', ctx);
    const sets = r.items.filter((i) => i.type === 'set');
    expect(sets).toHaveLength(4);
    expect(r.items.find((i) => i.type === 'weight')).toMatchObject({ kg: 68.04, raw: { value: 150, unit: 'lb' } });
    expect(r.ambiguities).toHaveLength(1);
    expect(r.ambiguities[0]!.question).toBe('RIR 0 指的是哪一组？');
    expect(r.ambiguities[0]!.options.map((o) => o.label)).toEqual(['145 × 6', '145 × 4', '两组都是']);
    expect(r.unparsed).toEqual([]);
  });

  it('明确日期与称重条件', () => {
    const r = parse('昨天体重70.2kg，上过大号', ctx);
    expect(r.date).toBe(addDays(TODAY, -1));
    expect(r.dateOrigin).toBe('explicit');
    expect(r.items[0]).toMatchObject({ type: 'weight', kg: 70.2, condition: 'post_bm' });
  });

  it('单边写法与 RIR', () => {
    const r = parse('哑铃上斜 40lb单边10个 rir2', ctx);
    expect(r.items[0]).toMatchObject({ type: 'set', exerciseId: 'incline_db_press', load: 40, reps: 10, rir: 2 });
  });

  it('重量 × 次数 × 组数', () => {
    const r = parse('侧平举 20lb*15*3组', ctx);
    expect(r.items).toHaveLength(3);
  });

  it('解析不了的原样返回', () => {
    expect(parse('今天状态不错', ctx).unparsed).toEqual(['今天状态不错']);
  });
});

describe('engine：闸门与撤销', () => {
  it('G1：歧义组进入确认，其余直接记录', () => {
    const out = capture(fresh(), '卧推 95lb*5+135lb*8+145lb*6+145lb*4，145那组rir0。今日体重150lb', user());
    expect(out.result.committed.map((e) => e.kind)).toEqual(['set', 'set', 'weight']);
    expect(out.result.held).toHaveLength(1);
    const h = out.result.held[0]!;
    expect(h.gate).toBe('G1');
    expect(h.drafts).toHaveLength(2);
    const r = resolveHeld(out.snap, h.id, { optionId: h.options[0]!.id }, user());
    const sets = r.result.committed.filter((e) => e.kind === 'set');
    expect(sets.map((s) => (s.kind === 'set' ? [s.setIndex, s.rir] : null))).toEqual([
      [3, 0],
      [4, null],
    ]);
    expect(r.snap.held).toHaveLength(0);
  });

  it('G3：同日第二次体重需要确认；替换会追加撤销', () => {
    let s = capture(fresh(), '体重 70kg', user()).snap;
    const out = capture(s, '体重 70.4kg', user());
    expect(out.result.held[0]!.gate).toBe('G3');
    s = resolveHeld(out.snap, out.result.held[0]!.id, { optionId: 'replace' }, user()).snap;
    expect(s.entries.filter((e) => e.kind === 'revert')).toHaveLength(1);
  });

  it('G2：模型推断的日期不自动记录', () => {
    const d: EntryDraft = { kind: 'weight', kg: 70, raw: { value: 70, unit: 'kg' }, condition: 'unspecified', date: addDays(TODAY, -2), dateOrigin: 'inferred', source: { actor: 'model', channel: 'mcp', client: 'test-model', rawText: '前两天称的' }, confidence: 0.95 };
    const out = log(fresh(), [d], model());
    expect(out.result.committed).toHaveLength(0);
    expect(out.result.held[0]!.gate).toBe('G2');
  });

  it('G5：低置信需要确认', () => {
    const d: EntryDraft = { kind: 'waist', cm: 80, date: TODAY, dateOrigin: 'device', source: { actor: 'model', channel: 'photo', client: 'test-model' }, confidence: 0.5 };
    expect(log(fresh(), [d], model()).result.held[0]!.gate).toBe('G5');
  });

  it('同一草稿逐级回答 G5、G2、G3、G4，最后才追加替换撤销和记录', () => {
    const yesterday=addDays(TODAY,-1);
    let s=withWeights(fresh(),[[yesterday,70]]);
    const draft:EntryDraft={kind:'weight',kg:74,raw:{value:74,unit:'kg'},condition:'unspecified',date:yesterday,dateOrigin:'inferred',source:{actor:'model',channel:'mcp',client:'test-model'},confidence:0.5};
    const initial=log(s,[draft],model());s=initial.snap;
    const steps:[string,string][]=[['G5','yes'],['G2','inferred'],['G3','replace'],['G4','yes']];
    for(const [index,[gateId,option]] of steps.entries()){
      const held=s.held[0]!;expect(held.gate).toBe(gateId);
      const resolved=resolveHeld(s,held.id,{optionId:option},user());s=resolved.snap;
      if(index<steps.length-1){expect(resolved.result.committed).toHaveLength(0);expect(s.entries).toHaveLength(1);}
    }
    expect(s.entries.map(entry=>entry.kind)).toEqual(['weight','revert','weight']);
    expect(s.held).toHaveLength(0);
  });

  it('G4：体重离群', () => {
    const s = withWeights(fresh(), [[addDays(TODAY, -1), 70]]);
    expect(capture(s, '体重 73kg', user()).result.held[0]!.gate).toBe('G4');
  });

  it('I1：模型不能撤销', () => {
    const s = capture(fresh(), '体重 70kg', user()).snap;
    expect(() => revert(s, s.entries[0]!.id, '', model())).toThrow(ForbiddenError);
  });

  it('I10：训练中的拦截延后', () => {
    let s = withWeights(fresh(), [[TODAY, 70]]);
    const { snap, sessionId } = startSession(s, 'upper_a', user());
    s = logSet(snap, { sessionId, exerciseId: 'bench_press', load: 135, unit: 'lb', reps: 8, rir: 2 }, user()).snap;
    const out = logSet(s, { sessionId, exerciseId: 'bench_press', load: 185, unit: 'kg', reps: 8, rir: 0 }, user());
    expect(out.result.held[0]!.deferUntilSessionEnd).toBe(true);
    s = endSession(out.snap, sessionId, user());
    expect(SnapshotSchema.parse(s)).toBeTruthy();
  });
  it('V5：首次输入另一单位时先换算再给出下一组', () => {
    const started=startSession(fresh(),'upper_a',user());
    const recorded=logSet(started.snap,{sessionId:started.sessionId,exerciseId:'bench_press',load:70,unit:'kg',reps:8,rir:2},user());
    expect(recorded.result.held[0]?.gate).toBe('G4');
    const approved=resolveHeld(recorded.snap,recorded.result.held[0]!.id,{optionId:'as_is'},user());
    const next=derive(approved.snap)['next.bench_press'];
    expect(next.value).toBeGreaterThan(150);
    expect(next.unit).toBe('lb');
    expect(next.formula).toContain('70 kg →');
    expect(next.inputs).toHaveLength(1);
  });
});

describe('派生值与触发器', () => {
  it('derive 产出协议约定的键', () => {
    let s = withWeights(fresh(), [0, 1, 2, 3, 4, 5, 6].map((i) => [addDays('2030-03-08', i), 70 + i * 0.2] as [string, number]));
    s = { ...s, program: { ...s.program, targets: { ...s.program.targets, bodyweightKg: 75 } } };
    s = logSet(s, { sessionId: 's1', exerciseId: 'bench_press', load: 135, unit: 'lb', reps: 8, rir: 2 }, user()).snap;
    const d = derive(s);
    expect(d['bw.slope7d']!.value).toBeCloseTo(1.4, 2);
    expect(d['bw.projection']!.value).toBeGreaterThan(0);
    expect(d['e1rm.best.bench_press']!.value).toBe(171);
    expect(d['rel.bench_press']!.unit).toBe('×体重');
    expect(d[`load.effective.${s.entries.at(-1)!.id}`]!.rule).toBe('V3');
    expect(Object.keys(d).some((k) => k.startsWith('rx.upper_a.'))).toBe(true);
    expect(d['volume.chest']!.value).toBe(1);
    expect(d['volume.chest']!.inputs).toContain(s.entries.at(-1)!.id);
    expect(Object.values(d).some(value=>value.rule==='V4')).toBe(true);
    expect(Object.values(d).every(value=>value.ruleVersion&&value.formula&&value.asOf)).toBe(true);
  });

  it('V8–V10 保留规则、输入与计算日期',()=>{
    let s=withWeights(fresh(),[0,1,2,3,4,5,6].map(i=>[addDays('2030-03-08',i),70+i*0.2] as [string,number]));
    s={...s,program:{...s.program,cycleStart:'2030-03-07',targets:{...s.program.targets,calorieTrigger:{thresholdKgPerWeek:0.5,kcalDelta:-200,everyDays:7}}}};
    for(const [date,cm] of [['2030-03-08',80],['2030-03-14',80.5]] as const)s=log(s,[{kind:'waist',date,dateOrigin:'explicit',source:{actor:'user',channel:'ui'},cm}],user(date)).snap;
    s=log(s,[{kind:'weight',date:'2030-03-15',dateOrigin:'explicit',source:{actor:'user',channel:'ui'},raw:{value:71.5,unit:'kg'},kg:71.5,condition:'post_bm'}],user('2030-03-15')).snap;
    const d=derive(s,'2030-03-15');
    expect(d['calorie.dueInDays']?.rule).toBe('V8');
    expect(d['waist.ratio']?.rule).toBe('V9');
    expect(d['waist.ratio']?.inputs).toHaveLength(4);
    expect(d['bw.postBmCount']?.rule).toBe('V10');
    expect(d['bw.postBmCount']?.inputs).toHaveLength(1);
  });

  it('V8：斜率超过阈值 → 将触发；采用后写入指令', () => {
    let s = withWeights(fresh(), [0, 1, 2, 3, 4, 5, 6].map((i) => [addDays('2030-03-08', i), 70 + i * 0.2] as [string, number]));
    s = { ...s, program: { ...s.program, cycleStart: '2030-03-04' } };
    s = refreshTriggers(s, user());
    const t = s.triggers[0]!;
    expect(t.status).toBe('will_fire');
    expect(t.dueDate).toBe('2030-03-18');
    s = decideTrigger(s, t.id, 'accept', undefined, user());
    expect(s.entries.at(-1)).toMatchObject({ kind: 'directive', kcal: -300 });
  });
});

describe('protocol', () => {
  it('MCP 工具里没有撤销、修改、决定', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(['get_state', 'get_history', 'run_verifiers', 'propose_entries', 'propose_change', 'list_inbox']);
    expect(names.some((n) => /revert|update|delete|decide|commit/.test(n))).toBe(false);
  });
});
