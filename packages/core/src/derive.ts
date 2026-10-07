import { MUSCLE_LABEL, VERIFIERS, type Derived, type LocalDate, type SetEntry, type Snapshot, type VerifierId } from '@lowkkey/protocol';
import { active, bodyweightOn, dailyWeights, openSession } from './ledger.ts';
import { calorieCheck, cycleWeek, e1rm, effectiveLoad, prescribe, projectDate, trend, trendAt, waistRatio, warmupFlags, weeklyVolume, weighinObservation } from './verifiers.ts';
import { trainingReference } from './training-reference.ts';
import { convert, diffDays, round, toKg } from './util.ts';

/**
 * 把快照算成派生值表。键名是协议的一部分（见 docs/PROTOCOL.md §派生值），前端、MCP、后端都按键读取。
 * 每个值都带公式与输入 id，ƒ 抽屉直接展示 formula。
 */
export function derive(snap: Snapshot, asOf: LocalDate = snap.today): Record<string, Derived> {
  const out: Record<string, Derived> = {};
  const put = (key: string, label: string, rule: VerifierId, value: number | null, unit: string | null, formula: string, inputs: string[]) => {
    out[key] = { key, label, value, unit, rule, ruleVersion: VERIFIERS[rule].version, inputs, asOf, formula };
  };
  const { program, exercises } = snap;const entries=snap.entries.filter(e=>e.date<=asOf);

  /* 体重 */
  const t7 = trend(entries, asOf, 7);
  const tAll = trend(entries, asOf);
  if (t7) put('bw.slope7d', '近 7 天体重变化', 'V1', round(t7.slopePerWeek, 2), 'kg/周', `OLS(${t7.from} → ${t7.to}, n=${t7.n}) × 7 = ${round(t7.slopePerWeek, 2)} kg/周`, t7.inputs);
  if (tAll) put('bw.slopeAll', '全程体重变化', 'V1', round(tAll.slopePerWeek, 2), 'kg/周', `OLS(${tAll.from} → ${tAll.to}, n=${tAll.n}) × 7 = ${round(tAll.slopePerWeek, 2)} kg/周`, tAll.inputs);
  const target = program.targets.bodyweightKg;
  if (tAll && target&&program.targets.goal?.mode!=='maintain') {
    const fitted = trendAt(tAll, asOf);
    const at = projectDate(asOf, fitted, tAll.slopePerWeek, target);
    const atTarget = projectDate(asOf, fitted, (program.targets.rateKgPerWeek?(program.targets.rateKgPerWeek.min + program.targets.rateKgPerWeek.max) / 2:0), target);
    put('bw.projection', '按当前趋势达到目标', 'V1', at ? diffDays(at, asOf) : null, '天', at ? `(${target} − ${round(fitted, 2)}) ÷ ${round(tAll.slopePerWeek, 2)} kg/周 → ${at}` : '趋势未朝目标方向', tAll.inputs);
    put('bw.projectionTarget', '按目标速度达到目标', 'V1', atTarget ? diffDays(atTarget, asOf) : null, '天', atTarget ? `(${target} − ${round(fitted, 2)}) ÷ ${(program.targets.rateKgPerWeek?(program.targets.rateKgPerWeek.min + program.targets.rateKgPerWeek.max) / 2:0)} kg/周 → ${atTarget}` : '—', tAll.inputs);
  }

  /* 周期 */
  const wk = cycleWeek(program.cycleStart, asOf);
  if (wk != null) put('cycle.week', '周期第几周', 'V6', wk, '周', `floor((${asOf} − ${program.cycleStart}) ÷ 7) + 1 = ${wk}`, []);

  /* 力量 */
  const sets = active(entries).filter((e): e is SetEntry => e.kind === 'set' && e.date <= asOf);
  const byEx = new Map<string, SetEntry[]>();
  for (const s of sets) (byEx.get(s.exerciseId) ?? byEx.set(s.exerciseId, []).get(s.exerciseId)!).push(s);
  const latestBw = bodyweightOn(entries, asOf);
  const bySessionExercise=new Map<string,SetEntry[]>();
  for(const set of sets){const ex=exercises.find(x=>x.id===set.exerciseId);if(!ex)continue;
    const bw=bodyweightOn(entries,set.date),load=effectiveLoad(set,ex,bw?.kg??null);
    put(`load.effective.${set.id}`,`${ex.name} 有效负荷`,'V3',load==null?null:round(load,2),ex.unit,
      load==null?'缺少同日或之前的体重，无法换算有效负荷':set.loadKind==='assist'?`${bw?.kg} kg 体重 − ${set.load} ${set.unit} 辅助 = ${round(load,2)} ${ex.unit}`:set.loadKind==='bodyweight'?`${bw?.kg} kg 体重 + ${set.load} ${set.unit} 负重 = ${round(load,2)} ${ex.unit}`:`${set.load} ${set.unit} → ${round(load,2)} ${ex.unit}`,
      bw&&set.loadKind!=='external'?[set.id,bw.id]:[set.id]);
    const key=`${set.sessionId}:${set.exerciseId}`;(bySessionExercise.get(key)??bySessionExercise.set(key,[]).get(key)!).push(set);
  }
  for(const [key,group] of bySessionExercise){const ex=exercises.find(x=>x.id===group[0]?.exerciseId);if(!ex||ex.type==='assisted')continue;
    const count=warmupFlags(group).filter(Boolean).length;
    put(`warmup.${key}`,`${ex.name} 本场热身组`,'V4',count,'组',`明确标记为热身的组数 = ${count}`,group.map(set=>set.id));
  }
  for (const [exId, list] of byEx) {
    const ex = exercises.find((x) => x.id === exId);
    if (!ex) continue;
    const scored = list.filter(set=>set.setRole!=='warmup')
      .map((s) => {
        const bw = bodyweightOn(entries, s.date);
        const load = effectiveLoad(s, ex, bw?.kg ?? null);
        return { s, load, v: load == null ? null : e1rm(load, s.reps) };
      })
      .filter((x): x is { s: SetEntry; load: number; v: number } => x.v != null);
    if (!scored.length) continue;
    const dates = [...new Set(scored.map((x) => x.s.date))].sort();
    const bestOn = (d: string) => scored.filter((x) => x.s.date === d).reduce((a, b) => (b.v > a.v ? b : a));
    const best = scored.reduce((a, b) => (b.v > a.v ? b : a));
    const first = bestOn(dates[0]!);
    const latest = bestOn(dates[dates.length - 1]!);
    const f = (x: typeof best) => `${round(x.load, 1)}${x.s.reps===1?'':` × (1 + ${x.s.reps}/30)`} = ${round(x.v, 1)} ${ex.unit}（${x.s.date}；${x.s.reps===1?'单次实际重量':x.s.reps>12?'高次数估算，误差较大':'估算值，非实测最大重量'}）`;
    put(`e1rm.best.${exId}`, `${ex.name} 最佳估算 e1RM`, 'V2', round(best.v, 1), ex.unit, f(best), [best.s.id]);
    put(`e1rm.first.${exId}`, `${ex.name} 首次估算 e1RM`, 'V2', round(first.v, 1), ex.unit, f(first), [first.s.id]);
    put(`e1rm.latest.${exId}`, `${ex.name} 最近估算 e1RM`, 'V2', round(latest.v, 1), ex.unit, f(latest), [latest.s.id]);
    for(const sessionId of new Set(list.map(set=>set.sessionId))){
      const current=scored.filter(x=>x.s.sessionId===sessionId);if(!current.length)continue;
      const top=current.reduce((a,b)=>b.v>a.v?b:a),firstAt=current.reduce((min,x)=>x.s.createdAt<min?x.s.createdAt:min,current[0].s.createdAt);
      const prior=scored.filter(x=>x.s.sessionId!==sessionId&&x.s.createdAt<firstAt);
      put(`session.e1rm.${sessionId}.${exId}`,`${ex.name} 本场估算 e1RM`,'V2',round(top.v,1),ex.unit,f(top),[top.s.id]);
      put(`session.pr.${sessionId}.${exId}`,`${ex.name} 本场进步`,'V2',!prior.length?null:top.v>Math.max(...prior.map(x=>x.v))?1:0,null,!prior.length?'首次记录，建立起点':'本场估算与此前同动作估算比较；相等不算新纪录',[top.s.id,...prior.map(x=>x.s.id)]);
    }
    if (latestBw) {
      const rel = toKg(latest.v, ex.unit) / latestBw.kg;
      put(`rel.${exId}`, `${ex.name} 相对力量`, 'V2', round(rel, 2), '×体重', `${round(toKg(latest.v, ex.unit), 1)} kg ÷ ${round(latestBw.kg, 2)} kg = ${round(rel, 2)}×`, [latest.s.id, latestBw.id]);
    }
  }

  /* 处方 */
  for (const day of program.days)
    for (const it of day.items) {
      const ex = exercises.find((x) => x.id === it.exerciseId);
      if (!ex) continue;
      const rx = prescribe(it, ex, entries, asOf, program);
      put(`rx.${day.id}.${ex.id}`, `${ex.name} 录入参考`, 'V6', rx.load, ex.unit, `${rx.reason}；${rx.sets} 组 × ${rx.repMin}–${rx.repMax}${rx.targetRir != null ? `，RIR ${rx.targetRir}` : ''}`, rx.basedOn);
      out[`rx.${day.id}.${ex.id}`].trainingReference=trainingReference(entries,ex,asOf,{item:it});
    }

  /* 本场已确认快照与真实记录分开；自由训练也可沿用实际重量。 */
  const session = openSession(entries);
  if (session) {
    const items=session.prescription??program.days.find(d=>d.id===session.dayId)?.items??[];
    const ids=[...new Set([...items.map(item=>item.exerciseId),...session.sets.map(set=>set.exerciseId)])];
    for(const id of ids){
      const ex=exercises.find(ex=>ex.id===id);if(!ex)continue;
      for(const role of ['work','warmup'] as const){
        const reference=trainingReference(entries,ex,asOf,{session,item:items.find(item=>item.exerciseId===id),role});
        const key=role==='work'?`next.${id}`:`next.warmup.${id}`;
        const value=reference.load==null?null:round(convert(reference.load,reference.unit,ex.unit),2);
        const reason=reference.entryId?`${reference.source==='session'?'本场上一组':'最近实际记录'} ${reference.date}：${reference.load} ${reference.unit}${reference.unit===ex.unit?'':` → ${value} ${ex.unit}`}；沿用实际重量，不自动加减`:reference.source==='arrangement'?'没有同组别历史，使用已确认安排':reference.source==='legacy_snapshot'?'本场旧快照，来源未标注':'没有重量依据，由你填写';
        const start=entries.find(entry=>entry.kind==='session'&&entry.sessionId===session.id&&entry.event==='start');
        put(key,`${ex.name} ${role==='warmup'?'热身组':'本组'}录入参考`,'V5',value,ex.unit,reason,reference.entryId?[reference.entryId]:reference.load!=null&&start?[start.id]:[]);
        out[key].trainingReference=reference;
      }
    }
  }

  /* 周组数 */
  for(const row of weeklyVolume(entries,exercises,asOf,program)){
    put(`volume.${row.muscle}`,`${MUSCLE_LABEL[row.muscle]} 本周正式组`,'V7',row.sets,'组',`明确正式组 × 肌群权重 = ${row.sets}；计划 ${row.planned}；未分类 ${row.unknown}。不据此判断训练是否足够`,row.inputs);
    put(`volume.planned.${row.muscle}`,`${MUSCLE_LABEL[row.muscle]} 计划组`,'V7',row.planned,'组','基础计划组 × 肌群权重；按需训练日以一轮计',[]);
    put(`volume.unknown.${row.muscle}`,`${MUSCLE_LABEL[row.muscle]} 未分类组`,'V7',row.unknown,'组','未分类记录 × 肌群权重；未自动排除为热身',row.inputs);
  }

  const calorie=calorieCheck(entries,program,asOf);
  if(calorie){const inputs=trend(entries,asOf,program.targets.calorieTrigger!.everyDays)?.inputs??[];
    put('calorie.dueInDays','热量判决还有几天','V8',diffDays(calorie.dueDate,asOf),'天',`${calorie.dueDate} − ${asOf} = ${diffDays(calorie.dueDate,asOf)} 天`,inputs);
    put('calorie.willFire','热量建议达到触发条件','V8',calorie.willFire?1:0,null,`${calorie.slope7d==null?'数据不足':`${round(calorie.slope7d,2)} kg/周`} ${program.targets.calorieTrigger?.comparison==='below'?'<':'>'} ${calorie.threshold} kg/周（${program.targets.calorieTrigger?.comparison??'above'}；观察 ${program.targets.calorieTrigger!.everyDays} 天） → ${calorie.willFire?'是':'否'}`,inputs);
  }
  const asOfEntries=entries.filter(entry=>entry.date<=asOf);
  const waist=waistRatio(asOfEntries);
  if(waist.inputs.length)put('waist.ratio','腰围与体重变化比','V9',waist.ratio==null?null:round(waist.ratio,2),'cm/kg',waist.ratio==null?'至少需要两次腰围和对应体重':`Δ腰围 ÷ Δ体重 = ${round(waist.ratio,2)} cm/kg`,waist.inputs);
  const observation=weighinObservation(asOfEntries,asOf);
  if(observation.nonstandard.length){const ids=observation.nonstandard.map(w=>w.id);
    put('bw.postBmCount','排便后称重次数','V10',observation.nonstandard.length,'次',`标记为排便后称重的记录 = ${observation.nonstandard.length} 次`,ids);
    put('bw.postBmBelowTrend','排便后称重低于趋势次数','V10',observation.belowTrend,'次',`排便后读数低于 V1 趋势 = ${observation.belowTrend} 次`,[...ids,...(tAll?.inputs??[])]);
  }

  /* 体重读数本身（便于 ƒ 抽屉展示换算） */
  const lastW = dailyWeights(entries).filter((w) => w.date <= asOf).pop();
  if (lastW && lastW.raw.unit !== 'kg') put('bw.latestKg', '最近体重', 'V1', lastW.kg, 'kg', `${lastW.raw.value} lb ÷ 2.20462 = ${round(lastW.kg, 2)} kg`, [lastW.id]);

  const annotations=active(entries).filter(e=>e.kind==='set_annotation');
  for(const d of Object.values(out)){const ids=new Set(d.inputs);for(const a of annotations)if(a.kind==='set_annotation'&&ids.has(a.targetId))ids.add(a.id);for(const id of d.inputs){const set=sets.find(s=>s.id===id);if(set&&set.loadKind!=='external'){const bw=bodyweightOn(entries,set.date);if(bw)ids.add(bw.id);}}d.inputs=[...ids];}
  return out;
}
