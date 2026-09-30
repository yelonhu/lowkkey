import { describe, expect, it } from 'vitest';
import { EXERCISE_LIBRARY, MCP_TOOLS, PROGRAM_TEMPLATES, Snapshot as SnapshotSchema, type EntryDraft, type Snapshot } from '@lowkkey/protocol';
import {
  ForbiddenError,
  active,claimDailyDecision,decideProposal,propose,projectDate,rampFor,weeklyVolume,putProgram,
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
    expect(warmupFlags([{setRole:'warmup'},{setRole:'work'},{}, {setRole:'work'}])).toEqual([true, false, false, false]);
  });

  it('V5 组内调节', () => {
    const bench = ex('bench_press');
    expect(nextSet(bench, { load: 135, reps: 8, rir: 2 }, 5, 8).load).toBe(140);
    expect(nextSet(bench, { load: 135, reps: 8, rir: 1 }, 5, 8).load).toBe(135);
    expect(nextSet(bench, { load: 135, reps: 6, rir: 0 }, 5, 8).load).toBe(135);
    expect(nextSet(bench, { load: 135, reps: 4, rir: 0 }, 5, 8).load).toBe(130);
    expect(nextSet(ex('pull_up'), { load: 20, reps: 8, rir: 2 }, 5, 8).load).toBeCloseTo(20, 5); // 辅助减少
  });

  it('V6 双进阶：下肢杠铃 +10 lb', () => {
    let s = fresh();
    const ctx = user('2030-03-10');const started=startSession(s,'lower_a',ctx);s=started.snap;
    for (let i = 0; i < 4; i++) s = logSet(s, { sessionId: started.sessionId, exerciseId: 'back_squat', load: 185, unit: 'lb', reps: 8, rir: 2 }, ctx).snap;
    s=endSession(s,started.sessionId,ctx);
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
    s={...s,program:{...s.program,cycleStart:'2030-03-07',targets:{...s.program.targets,goal:{mode:'gain',maintenanceKg:null,confirmedAt:user().now},rateKgPerWeek:{min:.1,max:.3},calorieTrigger:{thresholdKgPerWeek:0.5,kcalDelta:-200,everyDays:14,confirmedAt:user().now}}}};
    for(const [date,cm] of [['2030-03-08',80],['2030-03-14',80.5]] as const)s=log(s,[{kind:'waist',date,dateOrigin:'explicit',source:{actor:'user',channel:'ui'},cm}],user(date)).snap;
    s=log(s,[{kind:'weight',date:'2030-03-15',dateOrigin:'explicit',source:{actor:'user',channel:'ui'},raw:{value:71.5,unit:'kg'},kg:71.5,condition:'post_bm'}],user('2030-03-15')).snap;
    const d=derive(s,'2030-03-15');
    expect(d['calorie.dueInDays']?.rule).toBe('V8');
    expect(d['waist.ratio']?.rule).toBe('V9');
    expect(d['waist.ratio']?.inputs).toHaveLength(4);
    expect(d['bw.postBmCount']?.rule).toBe('V10');
    expect(d['bw.postBmCount']?.inputs).toHaveLength(1);
  });

  it('V8：充分观察并确认目标后，采用才写入指令', () => {
    let s = withWeights(fresh(), Array.from({length:14},(_,i)=>[addDays('2030-03-01',i),70+i*.2] as [string,number]));
    s={...s,program:{...s.program,cycleStart:'2030-03-04',targets:{...s.program.targets,goal:{mode:'gain',maintenanceKg:null,confirmedAt:user().now},rateKgPerWeek:{min:.1,max:.3},calorieTrigger:{thresholdKgPerWeek:.8,kcalDelta:-300,everyDays:14,confirmedAt:user().now}}}};
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


describe('natural training rules v1.1',()=>{
  it('keeps templates neutral and supports descending projections',()=>{
    const s=fresh();expect(s.program.ramp).toEqual([]);expect(s.program.targets.calorieTrigger).toBeNull();expect(s.program.targets.rateKgPerWeek).toBeNull();
    expect(projectDate(TODAY,80,-.5,79)).toBe(addDays(TODAY,14));expect(projectDate(TODAY,80,.5,79)).toBeNull();
    expect(e1rm(100,1)).toBe(100);expect(rampFor([{week:1,setMultiplier:.5,targetRir:4,label:'减载'}],2)).toBeNull();
  });
  it('never excludes a lower work set, and corrections append and can be reverted',()=>{
    const started=startSession(fresh(),'upper_a',user());let s=started.snap;
    s=logSet(s,{sessionId:started.sessionId,exerciseId:'bench_press',load:135,unit:'lb',reps:8,rir:2},user()).snap;
    s=logSet(s,{sessionId:started.sessionId,exerciseId:'bench_press',load:95,unit:'lb',reps:8,rir:2},user()).snap;
    const id=s.entries.at(-1)!.id,original=JSON.stringify(s.entries.at(-1));
    expect(weeklyVolume(s.entries,s.exercises,TODAY,s.program).find(r=>r.muscle==='chest')?.sets).toBe(2);
    s=log(s,[{kind:'set_annotation',targetId:id,setRole:'warmup',date:TODAY,dateOrigin:'device',source:user().source}],user()).snap;
    expect(JSON.stringify(s.entries.find(e=>e.id===id))).toBe(original);
    expect(weeklyVolume(s.entries,s.exercises,TODAY,s.program).find(r=>r.muscle==='chest')?.sets).toBe(1);
    s=revert(s,s.entries.at(-1)!.id,'标错了',user()).snap;
    expect(active(s.entries).find(e=>e.id===id)).toMatchObject({setRole:'work'});
  });
  it('limits increments and holds unknown effort or assistance',()=>{
    expect(nextSet(ex('lateral_raise'),{load:10,reps:15,rir:3},12,15).load).toBe(10);
    expect(nextSet(ex('bench_press'),{load:135,reps:8,rir:null},5,8).load).toBe(135);
    expect(nextSet(ex('pull_up'),{load:20,reps:8,rir:2},5,8,null).load).toBe(20);
    expect(nextSet(ex('pull_up'),{load:20,reps:8,rir:2},5,8,70).load).toBe(17.7);
  });
  it('does not progress an incomplete session or one with missing RIR',()=>{
    const started=startSession(fresh(),'upper_a',user());let s=started.snap;
    s=logSet(s,{sessionId:started.sessionId,exerciseId:'bench_press',load:135,unit:'lb',reps:8,rir:null},user()).snap;
    s=endSession(s,started.sessionId,user());
    const rx=prescribe(s.program.days[0].items[0],ex('bench_press'),s.entries,TODAY,s.program);expect(rx.load).toBe(135);
  });
  it('first session is a starting point, and an equal estimate is not a record',()=>{
    let s=fresh();for(let i=0;i<2;i++){const started=startSession(s,'upper_a',user());s=logSet(started.snap,{sessionId:started.sessionId,exerciseId:'bench_press',load:135,unit:'lb',reps:8,rir:2},user()).snap;s=endSession(s,started.sessionId,user());}
    const records=Object.values(derive(s)).filter(d=>d.key.startsWith('session.pr.'));expect(records.every(d=>d.value!==1)).toBe(true);
  });
  it('stores one daily decision, defers without rejecting, and needs user acceptance',()=>{
    let s=fresh();const first=propose(s,{kind:'program_change',title:'调整计划',rationale:'用户目标',patch:{cycleStart:TODAY},ruleRefs:['V6']},model());s=first.snap;
    s=propose(s,{kind:'note',title:'另一个建议',rationale:'以后查看',patch:{},ruleRefs:[]},model()).snap;
    s=claimDailyDecision(s);expect(s.decisionSlots?.[TODAY].id).toBe(first.proposal.id);
    s=decideProposal(s,first.proposal.id,'later',undefined,user());expect(s.program.cycleStart).toBeNull();expect(s.proposals[0].status).toBe('open');
    expect(claimDailyDecision(s).decisionSlots?.[TODAY].closed).toBe(true);
    expect(()=>decideProposal(s,first.proposal.id,'accept',undefined,model())).toThrow(ForbiddenError);
    expect(()=>propose(s,{kind:'program_change',title:'bad',rationale:'',patch:{targets:{unknown:null}},ruleRefs:[]},model())).toThrow();
  });
  it('expired dietary advice never writes a directive, and sparse observations do not qualify',()=>{
    let s=withWeights(fresh(),Array.from({length:14},(_,i)=>[addDays(TODAY,i-13),70+i*.1] as [string,number]));
    s=putProgram(s,{...s.program,targets:{...s.program.targets,goal:{mode:'gain',maintenanceKg:null},rateKgPerWeek:{min:.1,max:.2},calorieTrigger:{thresholdKgPerWeek:.4,kcalDelta:-150,everyDays:14}}},user());
    s=refreshTriggers(s,user());const count=s.entries.length,t=s.triggers[0];
    expect(t.status).toBe('will_fire');expect(refreshTriggers(s,user(addDays(TODAY,40))).entries).toHaveLength(count);
    const later=decideTrigger(s,t.id,'later',undefined,user());expect(later.entries).toHaveLength(count);expect(later.triggers[0].status).toBe('will_fire');
    const sparse={...s,entries:s.entries.slice(-3)};expect(refreshTriggers(sparse,user()).triggers[0].status).toBe('pending');
    expect(()=>decideTrigger(s,t.id,'accept',undefined,model())).toThrow(ForbiddenError);
    expect(decideTrigger(s,t.id,'accept',undefined,user()).entries).toHaveLength(count+1);
  });
});
