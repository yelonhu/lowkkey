import type { ExclusionReason, GainTarget, TrainingSet, Weight } from '@lowkkey/protocol';
import { diffDays, toLb } from './util.ts';
export const strictReps = (set:TrainingSet) => set.reps-(set.cheat??0);
export function e1rm(load:number,reps:number):number|null {
  if (!Number.isFinite(load)||load<=0||!Number.isInteger(reps)||reps<1||reps>20) return null;
  return reps===1?load:load*(1+reps/30);
}
export function bodyweightOn(weights:Weight[],date:string):Weight|null { return weights.reduce<Weight|null>((latest,w)=>w.date<=date&&(!latest||w.date>latest.date)?w:latest,null); }
export function effectiveLoad(set:TrainingSet,bodyLb:number|null):number|null {
  const load=toLb(set.load,set.unit);
  if(set.kind==='external')return load;
  if(bodyLb==null)return null;
  const effective=bodyLb+(set.kind==='assist'?-load:load);
  return effective>0?effective:null;
}
export function setExclusion(set:TrainingSet,weights:Weight[],date:string):ExclusionReason|null {
  if(set.role==='warmup')return 'warmup';
  if(set.role==='drop')return 'drop';
  if(set.partial)return 'partial_rom';
  if(set.per==='side')return 'unknown_total_load';
  if(strictReps(set)<1||strictReps(set)>20)return 'reps_out_of_range';
  const body=bodyweightOn(weights,date)?.lb??null;
  if(set.kind!=='external'&&body==null)return 'missing_bodyweight';
  const load=effectiveLoad(set,body);
  return load==null||load<=0?'non_positive_load':null;
}
export function scoreSet(set:TrainingSet,weights:Weight[],date:string):number|null {
  if(setExclusion(set,weights,date))return null;
  return e1rm(effectiveLoad(set,bodyweightOn(weights,date)?.lb??null)!,strictReps(set));
}
export function weightMean(weights:Weight[],date:string) {
  const rows=weights.filter(w=>diffDays(date,w.date)>=0&&diffDays(date,w.date)<7);
  return {date,lb:rows.length>=4?rows.reduce((a,w)=>a+w.lb,0)/rows.length:null,n:rows.length};
}
export function weightRate(weights:Weight[],date:string):number|null {
  const rows=weights.filter(w=>diffDays(date,w.date)>=0&&diffDays(date,w.date)<14);
  if(rows.length<8)return null;
  const mx=rows.reduce((a,w)=>a+diffDays(w.date,date),0)/rows.length,my=rows.reduce((a,w)=>a+w.lb,0)/rows.length;
  return rows.reduce((a,w)=>a+(diffDays(w.date,date)-mx)*(w.lb-my),0)/rows.reduce((a,w)=>a+(diffDays(w.date,date)-mx)**2,0)*7;
}
export function targetStatus(rate:number|null,target:GainTarget|null) { return rate==null||!target?null:rate>target.max?'above':rate<target.min?'below':'within'; }
export function targetAt(target:GainTarget,date:string) { const weeks=diffDays(date,target.start)/7;return weeks<0?null:{date,min:target.startLb+weeks*target.min,max:target.startLb+weeks*target.max}; }
