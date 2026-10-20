import { STRENGTH_EXERCISES, exerciseById, LB_PER_KG, type Brief, type BriefGuide, type Curation, type CurationInput, type Fact, type Facts, type GuideMissing, type Pick, type Plan, type PlanItem, type StrengthSeries, type TrainingSession, type TrainingSet, type Weight, type WeekStatus } from '@lowkkey/protocol';
import { addDays, diffDays, fmt, localToday, monday, relativeDay, round, toLb, weekday } from './util.ts';
import { bodyweightOn, scoreSet, strictReps, targetStatus, weightMean, weightRate } from './verifiers.ts';
export const exerciseKey = (x:{ex:string;name?:string}) => x.ex==='custom'?'custom:'+x.name:x.ex;
export const exerciseName = (x:{ex:string;name?:string}) => x.ex==='custom'?x.name!:(exerciseById(x.ex)?.name??x.ex);
export const perHand = (ex:string) => exerciseById(ex)?.perHand??false;
export const SHORT:Record<string,string> = {back_squat:'深蹲',bench_press:'卧推',pull_up:'引体',db_shoulder_press:'推肩'};
export const unitLabel = (x:{ex:string;unit:string;per?:string}) => x.unit+(x.per==='side'?' / 边':perHand(x.ex)?' / 只':'');
export function groupSets(sets:TrainingSet[]) { const groups=new Map<string,TrainingSet[]>();for(const set of sets){const k=exerciseKey(set);groups.set(k,[...(groups.get(k)??[]),set]);}return [...groups.values()]; }
export function compactSets(sets:TrainingSet[],withUnits=false):string {
  const groups:{set:TrainingSet;reps:string[]}[]=[];
  for(const set of sets){if(set.role==='warmup')continue;const rep=(set.cheat?strictReps(set)+'+'+set.cheat:String(set.reps))+(set.partial?'*':'');const last=groups.at(-1);
    if(last&&last.set.load===set.load&&last.set.unit===set.unit&&last.set.kind===set.kind&&last.set.per===set.per)last.reps.push(rep);else groups.push({set,reps:[rep]});}
  return groups.map(({set,reps})=>(set.kind==='assist'?'辅助 ':set.kind==='bodyweight'?'负重 ':'')+fmt(set.load)+(withUnits?' '+unitLabel(set):'')+' × '+reps.join(' / ')).join(' · ');
}
export function plates(total:number,bar=45,sizes=[45,35,25,10,5,2.5]):number[]|null {let side=(total-bar)/2;if(side<0)return null;const out:number[]=[];for(const p of sizes)while(side>=p-1e-9){out.push(p);side-=p;}return side<1e-6?out:null;}
export function bestSets(session:TrainingSession,weights:Weight[]) {const out:Record<string,{set_index:number;e1rm:number}>={};session.sets.forEach((set,i)=>{const v=scoreSet(set,weights,session.date),key=exerciseKey(set);if(v!=null&&(!out[key]||v>out[key].e1rm))out[key]={set_index:i,e1rm:v};});return out;}
export function scoredSessions(facts:Facts){const best:Record<string,number>={};return [...facts.sessions].sort((a,b)=>a.date.localeCompare(b.date)).map(s=>{const values=bestSets(s,facts.weights),prs:string[]=[];for(const [ex,p] of Object.entries(values)){if(best[ex]!=null&&p.e1rm>best[ex]+1e-6)prs.push(ex);best[ex]=Math.max(best[ex]??0,p.e1rm);}return {...s,best:values,prs};});}
export function strengthSeries(facts:Facts):StrengthSeries[]{const scored=scoredSessions(facts);return STRENGTH_EXERCISES.map(ex=>{const points=scored.flatMap(s=>s.best[ex]?[{date:s.date,...s.best[ex]}]:[]);return {ex,points,first:points[0]??null,best:points.reduce<StrengthSeries['best']>((b,p)=>!b||p.e1rm>b.e1rm?p:b,null),latest:points.at(-1)??null};});}
export function lastExercise(sessions:TrainingSession[],item:{ex:string;name?:string}) {return [...sessions].sort((a,b)=>b.date.localeCompare(a.date)).flatMap(s=>{const sets=s.sets.filter(x=>exerciseKey(x)===exerciseKey(item));return sets.length?[{date:s.date,sets}]:[];});}
export function heaviest(facts:Facts,ex:string){let best:{set:TrainingSet;date:string}|null=null;for(const session of [...facts.sessions].sort((a,b)=>a.date.localeCompare(b.date)))for(const set of session.sets){if(set.ex!==ex||set.role==='warmup'||set.role==='drop'||set.partial||strictReps(set)<1)continue;
  if(ex==='pull_up'||ex==='dip'){if(strictReps(set)<8)continue;const kg=(set.kind==='assist'?1:-1)*toLb(set.load,set.unit)/LB_PER_KG;const prior=best?(best.set.kind==='assist'?1:-1)*toLb(best.set.load,best.set.unit)/LB_PER_KG:Infinity;if(kg<prior||kg===prior&&session.date>=(best?.date??''))best={set,date:session.date};}
  else if(!best||toLb(set.load,set.unit)>toLb(best.set.load,best.set.unit)||toLb(set.load,set.unit)===toLb(best.set.load,best.set.unit)&&strictReps(set)>strictReps(best.set))best={set,date:session.date};}
  return best;
}
export function selfShare(set:TrainingSet,date:string,weights:Weight[]) {const bw=bodyweightOn(weights,date)?.lb;if(!bw)return null;return Math.max(0,Math.min(1,(bw-(set.kind==='assist'?toLb(set.load,set.unit):0))/bw));}
export function upcoming(facts:{plans:Plan[];sessions:TrainingSession[]},today:string){const out:{plan:Plan;date:string;rel:string}[]=[];for(let i=0;i<7;i++){const date=addDays(today,i),plan=facts.plans.find(p=>p.weekday===weekday(date)&&p.items.length);if(plan&&!(i===0&&facts.sessions.some(s=>s.date===date)))out.push({plan,date,rel:relativeDay(date,today)});}return out;}
export function currentCuration(facts:Facts,today:string){return facts.curations.find(c=>c.week===monday(today))??null;}
export function latestRecap(facts:Facts,today:string){return [...facts.curations].filter(c=>c.week<=monday(today)&&c.recap?.letter?.length).sort((a,b)=>b.week.localeCompare(a.week))[0]??null;}
export function datedCuration(facts:Facts,field:'next'|'body',today:string){const value=[...facts.curations].sort((a,b)=>b.revision-a.revision).find(c=>Object.hasOwn(c,field))?.[field];return value&&value.date<=addDays(today,field==='next'?6:0)&&value.date>=addDays(today,field==='body'?-6:0)?value:null;}
export function themeState(facts:Facts,today:string){
  const source=facts.curations.filter(c=>c.week<=monday(today)&&c.theme).sort((a,b)=>b.week.localeCompare(a.week))[0];
  return {user:'ink' as const,active:source?.theme?.id??'ink' as const,manual_this_week:false,source_week:source?.week??null,reason:source?.theme?.why??null};
}
export function weightSeries(weights:Weight[]){return [...weights].sort((a,b)=>a.date.localeCompare(b.date)).map(w=>weightMean(weights,w.date));}
export function weeklyWeights(weights:Weight[],zero?:string){if(!weights.length)return [];const start=monday(zero??[...weights].sort((a,b)=>a.date.localeCompare(b.date))[0].date);const weeks=new Map<string,Weight[]>();for(const w of weights){const key=monday(w.date);weeks.set(key,[...(weeks.get(key)??[]),w]);}return [...weeks].sort(([a],[b])=>a.localeCompare(b)).map(([week,rows])=>({week,index:Math.floor(diffDays(week,start)/7)+1,n:rows.length,mean:rows.reduce((n,w)=>n+w.lb,0)/rows.length}));}
export function planOn(facts:Facts,date:string):Plan[]{return [...facts.plan_history].filter(h=>h.effective_date<=date).sort((a,b)=>a.effective_date.localeCompare(b.effective_date)||a.revision-b.revision).at(-1)?.plans??[];}
export function completedWeeks(facts:Facts,today:string){let weeks=0;const earliest=facts.plan_history.map(h=>h.effective_date).sort()[0];if(!earliest)return 0;for(let week=addDays(monday(today),-7);week>=earliest;week=addDays(week,-7)){let due=0,missed=false;for(let i=0;i<7;i++){const date=addDays(week,i),p=planOn(facts,date).find(p=>p.weekday===weekday(date));if(p){due++;if(!facts.sessions.some(s=>s.date===date&&s.title===p.title))missed=true;}}if(!due||missed)break;weeks++;}return weeks;}
export function weekFacts(facts:Facts,today:string):Fact[]{const out:Fact[]=[],week=monday(today),within=(d:string)=>d>=week&&d<=today;
  for(const line of strengthSeries(facts)){let high:number|null=null,stall=0;for(const p of line.points.filter(p=>p.date<=today)){if(high!=null&&p.e1rm>high+1e-6){if(within(p.date)){out.push({kind:'pr',ex:line.ex,date:p.date,e1rm:round(p.e1rm),prev_e1rm:round(high)});if(stall>=3)out.push({kind:'unstuck',ex:line.ex,date:p.date,after_sessions:stall});}stall=0;}else if(high!=null)stall++;high=Math.max(high??0,p.e1rm);}if(stall>=3&&line.latest&&within(line.latest.date))out.push({kind:'stall',ex:line.ex,sessions:stall});
    const seen=new Set<string>();for(const session of [...facts.sessions].filter(s=>s.date<=today).sort((a,b)=>a.date.localeCompare(b.date))){for(const set of session.sets){if(set.ex!==line.ex||scoreSet(set,facts.weights,session.date)==null)continue;const load=toLb(set.load,set.unit),bw=bodyweightOn(facts.weights,session.date)?.lb;const thresholds:{what:'一片'|'两片'|'超过体重';ok:boolean}[]=['bench_press','back_squat'].includes(set.ex)?[{what:'一片',ok:load>=135},{what:'两片',ok:load>=225},{what:'超过体重',ok:bw!=null&&load>bw}]:[];
      for(const t of thresholds)if(t.ok&&!seen.has(t.what)){seen.add(t.what);if(within(session.date))out.push({kind:'threshold',ex:line.ex,date:session.date,what:t.what,load:round(load)});}
      if(['pull_up','dip'].includes(set.ex)&&set.kind==='bodyweight'&&strictReps(set)>=8&&!seen.has('徒手')){seen.add('徒手');if(within(session.date)&&facts.sessions.some(s=>s.date<session.date&&s.sets.some(x=>x.ex===line.ex&&x.kind==='assist'&&scoreSet(x,facts.weights,s.date)!=null)))out.push({kind:'first',ex:line.ex,date:session.date,what:'徒手'});}
    }}
  }
  const history=[...facts.sessions].filter(s=>s.date<=today).sort((a,b)=>a.date.localeCompare(b.date)), reached=new Set<string>(), tried=new Set<string>();
  for(const session of history)for(const item of planOn(facts,session.date).find(p=>p.title===session.title)?.items??[]){const key=exerciseKey(item),sets=session.sets.filter(s=>exerciseKey(s)===key&&s.role!=='warmup'&&s.role!=='drop');if(!sets.length)continue;const full=sets.filter(s=>!s.partial&&!s.cheat&&strictReps(s)>=item.min&&s.per===item.per&&s.kind===item.loadKind&&(item.load==null||(s.kind==='assist'?toLb(s.load,s.unit)<=toLb(item.load,item.unit):toLb(s.load,s.unit)>=toLb(item.load,item.unit)))).length>=item.sets;if(full&&!reached.has(key)){if(tried.has(key)&&within(session.date))out.push({kind:'first',ex:item.ex,date:session.date,what:'不借力做满'});reached.add(key);}tried.add(key);}
  for(let date=week;date<today;date=addDays(date,1)){const plan=planOn(facts,date).find(p=>p.weekday===weekday(date));if(plan&&!facts.sessions.some(s=>s.date===date&&s.title===plan.title))out.push({kind:'missed',date,title:plan.title});}
  const streak=completedWeeks(facts,today);if(streak)out.push({kind:'streak',weeks:streak});const rate=weightRate(facts.weights,today),mean=weightMean(facts.weights,today);if(rate!=null)out.push({kind:'weight',status:targetStatus(rate,facts.profile.gain_target),rate14:round(rate,2),mean7:mean.lb==null?null:round(mean.lb)});return out;
}
export function pickData(facts:Facts,pick:Pick){
  const week=monday(pick.date);
  if(pick.kind==='weight'){if(!facts.weights.some(w=>w.date===pick.date))return null;const rows=weeklyWeights(facts.weights),current=rows.find(w=>w.week===week);if(!current)return null;const prev=rows.find(w=>w.week===addDays(week,-7));return {kind:'weight' as const,current,delta:prev?current.mean-prev.mean:null,rate:weightRate(facts.weights,addDays(week,6)),weights:facts.weights.filter(w=>monday(w.date)===week)};}
  if(pick.kind==='rhythm'){if(!facts.sessions.some(s=>s.date===pick.date))return null;const sessions=facts.sessions.filter(s=>monday(s.date)===week);if(!sessions.length)return null;return {kind:'rhythm' as const,sessions,week,streak:completedWeeks(facts,addDays(week,7))};}
  const session=facts.sessions.find(s=>s.date===pick.date),sets=session?.sets.filter(s=>s.ex===pick.ex&&(s.ex!=='custom'||s.name===pick.name)&&s.role!=='warmup'&&s.role!=='drop'&&!s.partial&&strictReps(s)>0)??[];
  if(!sets.length)return null;
  const sorted=[...sets].sort((a,b)=>pick.kind==='assist'?toLb(a.load,a.unit)-toLb(b.load,b.unit)||strictReps(b)-strictReps(a):toLb(b.load,b.unit)-toLb(a.load,a.unit)||strictReps(b)-strictReps(a));
  const top=sorted[0];return {kind:pick.kind,top,bw:bodyweightOn(facts.weights,pick.date)?.lb??null,share:selfShare(top,pick.date,facts.weights),sets:sets.filter(s=>s.load===top.load&&s.unit===top.unit&&strictReps(s)>=strictReps(top)).length};
}
export function getBrief(facts:Facts,generatedAt=new Date().toISOString(),count=6,timezone='America/Chicago'):Brief {
  const today=localToday(new Date(generatedAt),timezone),all=scoredSessions(facts).filter(s=>s.date<=today),latest=[...facts.weights].filter(w=>w.date<=today).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)??null;
  const mean=weightMean(facts.weights,today),rate=weightRate(facts.weights,today),next=upcoming(facts,today)[0];
  const point=(p:StrengthSeries['best'])=>p?{date:p.date,e1rm:round(p.e1rm)}:null;
  const unique=new Map<string,TrainingSet>();for(const s of all)for(const x of s.sets)unique.set(exerciseKey(x),x);
  return {generated_at:generatedAt,today:{date:today,weekday:weekday(today)},next:next?{date:next.date,rel:next.rel,title:next.plan.title}:null,plans:facts.plans,profile:facts.profile,theme_state:themeState(facts,today),
    weight:{latest:latest?{date:latest.date,lb:latest.lb}:null,mean7:mean.lb==null?null:{...mean,lb:round(mean.lb)},rate14:rate==null?null:round(rate,2),status:targetStatus(rate,facts.profile.gain_target)},
    strength:strengthSeries({...facts,sessions:all}).map(s=>{const h=heaviest({...facts,sessions:all},s.ex),share=h?selfShare(h.set,h.date,facts.weights):null;return {ex:s.ex,best:point(s.best),latest:point(s.latest),first:point(s.first),rel_bw:s.best&&latest&&!perHand(s.ex)?round(s.best.e1rm/latest.lb,2):null,assistance:s.ex==='pull_up'&&h?{date:h.date,kg:round((h.set.kind==='assist'?1:-1)*toLb(h.set.load,h.set.unit)/LB_PER_KG),reps:strictReps(h.set),self_percent:share==null?null:Math.floor(share*100)}:null};}),
    exercises:[...unique.values()].map(x=>{const rows=lastExercise(all,x),entry=(r:typeof rows[number])=>({date:r.date,compact:compactSets(r.sets,true)});return {ex:x.ex,name:exerciseName(x),last:entry(rows[0]),prev:rows[1]?entry(rows[1]):null};}).sort((a,b)=>b.last.date.localeCompare(a.last.date)),
    sessions:all.slice().reverse().slice(0,count).map(s=>({date:s.date,title:s.title,...(s.note?{note:s.note}:{}),compact_by_ex:Object.fromEntries(groupSets(s.sets).map(g=>[exerciseKey(g[0]),compactSets(g,true)])),prs:s.prs.filter(ex=>STRENGTH_EXERCISES.includes(ex as typeof STRENGTH_EXERCISES[number]))})),week_facts:weekFacts(facts,today),
    curation:{current:currentCuration(facts,today),history:facts.curations.filter(c=>c.week<=monday(today)&&c.week>=addDays(monday(today),-21)).sort((a,b)=>b.week.localeCompare(a.week)).map(c=>({week:c.week,title:c.recap?.title??null,theme:c.theme?.id??null}))},
  };
}
/** Where the user is in the current Monday-based week: index since the first session, done vs planned days. */
export function weekStatus(facts:Facts,today:string):WeekStatus {
  const start=monday(today);
  const zero=facts.sessions.map(s=>s.date).sort()[0];
  const index=zero?Math.max(1,Math.floor(diffDays(start,monday(zero))/7)+1):1;
  const done=facts.sessions.filter(s=>s.date>=start&&s.date<=today).length;
  const planned=new Set(facts.plans.filter(p=>p.items.length).map(p=>p.weekday)).size;
  return {start,index,done,planned};
}

/**
 * The keeper's to-do list. Everything here is derived from saved facts and granted
 * permissions, so an AI that only skims its instructions still receives a concrete
 * "what this archive is missing" with every brief.
 */
export function briefGuide(facts:Facts,today:string,permissions:string[],setup:{entry:'start'|'existing'|null}):BriefGuide {
  const week=weekStatus(facts,today);
  const hasContext=!!facts.profile.training_context,hasPlan=facts.plans.some(p=>p.items.length);
  const hasSession=facts.sessions.length>0,hasWeight=facts.weights.length>0;
  const stage=hasSession?'active':hasContext||hasPlan||hasWeight?'setup':'empty';
  const missing:GuideMissing[]=[];
  if(!hasContext)missing.push('training_context');
  if(!hasPlan)missing.push('plan');
  if(hasPlan&&upcoming(facts,today).length&&!datedCuration(facts,'next',today))missing.push('next_note');
  if(!hasSession)missing.push('session');
  if(!hasWeight)missing.push('weight');
  const letterDue=week.planned>0&&(week.done>=week.planned||[0,6].includes(weekday(today)));
  if(hasSession&&letterDue&&!currentCuration(facts,today)?.recap?.letter?.length)missing.push('week_letter');
  if(weightRate(facts.weights,today)!=null&&!datedCuration(facts,'body',today))missing.push('body_note');
  const canWrite=permissions.includes('write');
  let next_step:string;
  if(!canWrite)next_step=permissions.includes('notes:write')
    ?'当前只读，训练档案不能保存；可按明确要求写随手记。需要保存训练时请用户重新授权 write。'
    :'当前只读。可以分析和建议，但不能保存；说明如何重新授权写入。';
  else if(stage==='empty')next_step=setup.entry==='existing'
    ?'请用户发来已有的计划或记录，澄清关键歧义后用 set_plan 或 log_session 保存；同时把了解到的背景写入 set_profile.training_context。'
    :'用一句自然的问题了解用户想开始训练还是整理已有资料；然后一次问一个必要问题，了解目标、经验、每周时间与器械，保存 training_context，共同确定第一周计划并 set_plan，再用 curate.next 写一句下次提示。';
  else if(stage==='setup')next_step=missing.includes('plan')
    ?'背景已有，还没有计划：共同确定第一周可执行的安排后 set_plan，再用 curate.next 写一句下次提示。'
    :'计划已就位。告诉用户训练完把内容发过来即可，由你整理保存；用户发来就 log_session。';
  else {
    const first=missing[0];
    next_step=first==='week_letter'?'本周训练已完成或接近周末，还没有周信：用 curate.recap 写一封，引用本周真实记录选 1–2 个 picks，并指定 focus。'
      :first==='next_note'?'为下一次训练用 curate.next 写一句具体提示。'
      :first==='body_note'?'体重已有趋势但没有批注：用 curate.body 写一句，引用 get_brief.weight 的速度与状态。'
      :first==='training_context'?'尚未保存训练背景：把用户明确表达的目标、时间、器械写入 set_profile.training_context。'
      :'接续已有事实。用户发来训练就整理保存；修改旧训练前用 session_date 读取该日完整组。';
  }
  return {stage,next_step,missing,week};
}
export function mergeCuration(previous:Curation|undefined,input:CurationInput,revision:number,stamp:string):Curation {
  const out={...previous,...input,revision,updated_at:stamp};
  if(input.recap&&previous?.recap)out.recap={...previous.recap,...input.recap};
  const log={...(previous?.log??{})};for(const [date,note] of Object.entries(input.log??{})){if(note===null)delete log[date];else log[date]=note;}out.log=log;return out;
}
export function planSummary(item:PlanItem){return (SHORT[item.ex]??exerciseName(item).replace(/^(杠铃|坐姿|绳索|蝴蝶机)/,''))+(item.load!=null?' '+fmt(item.load):'');}
