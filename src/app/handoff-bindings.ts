import type { Entry, EntryDraft, SetEntry, WeightEntry } from '@lowkkey/protocol';
import { active, openSession, plates, sessions } from '@lowkkey/core';
import type { V1State } from '../server/v1-store.ts';
import { prototypeScreen } from './prototype-template.ts';
import type { Screen } from './navigation.ts';

export type HandoffContext={state:V1State;screen:Screen;toast:Entry|null;queueCount:number;busy:boolean;error:string;filter:'all'|'you'|'model'|'rule';answers:Record<string,string>;reviewQuestions?:V1State['submissions'][number]['questions'];reviewLoading?:boolean;reps:number;rir:number|null;exerciseId:string|null};
const one=<T extends Element=HTMLElement>(root:ParentNode,selector:string)=>root.querySelector<T>(selector);
const kids=(element:Element)=>Array.from(element.children) as HTMLElement[];
const text=(element:Element|null|undefined,value:string)=>{if(element)element.textContent=value;};
const legendText=(element:HTMLElement|undefined,value:string)=>{if(!element)return;const icon=element.firstElementChild;if(icon)element.replaceChildren(icon,document.createTextNode(value));else text(element,value);};
const fmt=(value:number|null|undefined,digits=1)=>value==null?'—':value.toFixed(digits);
const dateLabel=(date:string)=>`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
const weekday=(date:string)=>new Date(`${date}T12:00:00Z`).getUTCDay();
export function prepareHandoff(root:HTMLElement,screen:Screen,today:string){
  text(one(root,'[data-bind="header-date"]'),`${Number(today.slice(5,7))}.${Number(today.slice(8,10))} ${['周日','周一','周二','周三','周四','周五','周六'][weekday(today)]}`);
  if(screen==='Body'){
    const chart=one(root,'[data-bind="body-chart"]');
    for(const key of ['body-goal-grid','body-goal-label','body-goal-trend','body-goal-speed','body-forecast-trend','body-forecast-point','body-forecast-date','body-middle-date','body-end-date','body-observed-trend','body-today-grid'])one(chart??root,`[data-bind="${key}"]`)?.setAttribute('visibility','hidden');
    for(const key of ['body-goal-label','body-goal-speed','body-forecast-date','body-middle-date','body-end-date'])text(one(chart??root,`[data-bind="${key}"]`),'');
    if(chart)for(const label of chart.querySelectorAll('text:not([data-bind])'))text(label,'');
  }
  if(screen==='Transition'){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(walker.currentNode.textContent?.trim()==='125')walker.currentNode.textContent='—';
  }
}
const activeEntries=(state:V1State)=>active(state.entries);
const weights=(state:V1State)=>activeEntries(state).filter((e):e is WeightEntry=>e.kind==='weight').sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
const latestWeight=(state:V1State)=>weights(state).at(-1);
const exName=(state:V1State,id:string)=>state.exercises.find(x=>x.id===id)?.name??id;
const entryLabel=(state:V1State,entry:Entry):string=>{
  if(entry.kind==='weight')return `体重 ${entry.raw.value} ${entry.raw.unit}`;
  if(entry.kind==='set')return `${exName(state,entry.exerciseId)} ${entry.load} ${entry.unit} × ${entry.reps}${entry.rir===null?'':` · RIR ${entry.rir}`}`;
  if(entry.kind==='waist')return `腰围 ${entry.cm} cm`;
  if(entry.kind==='session')return entry.event==='start'?'开始训练':'训练完成';
  if(entry.kind==='note')return entry.text;
  if(entry.kind==='directive')return `每天 ${entry.kcal>0?'+':''}${entry.kcal} kcal`;
  return '撤销记录';
};
const draftLabel=(state:V1State,draft:EntryDraft):string=>{
  if(draft.kind==='weight')return `体重 ${draft.raw.value} ${draft.raw.unit}`;
  if(draft.kind==='set')return `${exName(state,draft.exerciseId)} ${draft.load} ${draft.unit} × ${draft.reps}`;
  if(draft.kind==='waist')return `腰围 ${draft.cm} cm`;
  if(draft.kind==='note')return draft.text.slice(0,36);
  return draft.kind;
};
function dayFor(state:V1State){return state.program.days.find(day=>day.weekday===weekday(state.today))??null;}
function setHeading(element:Element|null,first:string,second:string){if(element)element.replaceChildren(document.createTextNode(first),document.createElement('br'),document.createTextNode(second));}
function enable(element:HTMLElement|null){if(!element)return;element.removeAttribute('aria-disabled');if(element instanceof HTMLButtonElement)element.disabled=false;}
function bindMain(root:HTMLElement,c:HandoffContext){
  const s=c.state,day=dayFor(s),weight=latestWeight(s),slope=s.derived['bw.slope7d'],week=s.derived['cycle.week'];
  setHeading(one(root,'[data-bind="main-title"]'),'今天，',day?`${day.name}。`:'从一条记录开始。');
  const metrics=one(root,'[data-bind="main-title"]')?.nextElementSibling;if(metrics){const [first,second,third]=kids(metrics);
    text(one(first,'span'),weight?fmt(weight.kg,2):'—');text(first.lastChild as unknown as Element,weight?`kg · ${weight.date===s.today?'今晨':dateLabel(weight.date)}`:'kg · 尚未记录');
    text(one(second,'span'),slope?.value==null?'—':`${slope.value>=0?'+':''}${fmt(slope.value)}`);text(one(third,'span'),week?.value==null?'—':String(week.value));
    const suffix=third?.lastChild;if(suffix?.nodeType===Node.TEXT_NODE)suffix.textContent=week?.value==null?' / 周期未设置':' / 周期';
    second.dataset.derivedKey='bw.slope7d';
  }
  const advice=one(root,'[data-bind="main-advice"]');const trigger=s.triggers.find(t=>t.status==='will_fire'||t.status==='pending'),proposal=s.proposals.find(p=>p.status==='open'),pending=s.submissions[0]??s.held.find(h=>!h.deferUntilSessionEnd);
  if(advice){const [label,title,detail,buttons]=kids(advice);text(label,pending?'需要确认':trigger?'建议':proposal?'提议':'状态');text(title,pending?'有一项等待你确认。':trigger?`每天 ${trigger.action.kcal} kcal。`:proposal?.title??'今天没有待决定的建议。');text(detail,pending?'其他待审事项留在日志收件箱。':trigger?`来自 ${trigger.rule}，判决日 ${dateLabel(trigger.dueDate)}。`:proposal?.rationale??'新的记录会让规则逐步形成结论。');
    const [accept,later]=kids(buttons);if(pending){text(accept,'查看');accept.dataset.action='view-pending';enable(accept);later.remove();}else if(trigger){text(accept,'采用');text(later,'以后');accept.dataset.action='trigger-accept';later.dataset.action='trigger-later';accept.dataset.id=trigger.id;later.dataset.id=trigger.id;enable(accept);enable(later);}else if(proposal){text(accept,'采用');text(later,'以后');accept.dataset.action='proposal-accept';later.dataset.action='proposal-reject';accept.dataset.id=proposal.id;later.dataset.id=proposal.id;enable(accept);enable(later);}else buttons.remove();}
  const plan=one(root,'[data-bind="main-plan"]');if(plan){const heading=kids(plan)[0],source=prototypeScreen('Main').querySelector('[data-bind="main-plan"]');const template=source?.children[1];
    for(const row of kids(plan).slice(1,-1))row.remove();
    const items=day?.items??[];text(kids(heading)[0],day?'训练计划':'训练计划');text(kids(heading)[1],day?`${items.length} 个动作 · ${items.reduce((n,i)=>n+i.sets,0)} 组`:'尚未设置');
    if(items.length&&template)for(const item of items){const row=template.cloneNode(true) as HTMLElement;const [name,,load]=kids(row);const rx=s.derived[`rx.${day!.id}.${item.exerciseId}`];text(name,exName(s,item.exerciseId));text(load,rx?.value==null?'首次重量待设置':`${rx.value} ${rx.unit??''}`);plan.insertBefore(row,plan.lastElementChild);}
    else if(template){const row=template.cloneNode(true) as HTMLElement;text(kids(row)[0],'尚无训练计划');text(kids(row)[2],'待设置');plan.insertBefore(row,plan.lastElementChild);}
    const start=plan.lastElementChild as HTMLElement;if(day){text(start,'开始训练');start.dataset.action='start-session';enable(start);start.setAttribute('href','#Session');}else{text(start,'训练计划待设置');start.removeAttribute('href');}
  }
  const input=one<HTMLInputElement>(root,'input[data-action="capture-input"]');if(input){input.disabled=false;input.placeholder='记录体重、训练，按回车提交';}
  if(input)input.setAttribute('aria-label','今天发生了什么？');
  const status=one<HTMLElement>(root,'[data-bind="capture-status"]');if(status){if(c.toast){status.hidden=false;text(one(status,'span'),`✓ 已记录 ${entryLabel(s,c.toast)}`);const undo=one<HTMLButtonElement>(status,'button');if(undo){text(undo,'撤销');undo.dataset.action='toast-revert';enable(undo);}}
    else if(c.error||c.queueCount){status.hidden=false;text(one(status,'span'),c.error||`${c.queueCount} 条待发送 · 联网后提交`);}
    else status.hidden=true;}
  const camera=one<HTMLButtonElement>(root,'button[aria-label="拍照或截图"]')??one<HTMLButtonElement>(root,'button[aria-label="相机尚未接入"]');if(camera){camera.setAttribute('aria-label','照片使用说明');camera.dataset.action='external-photo';enable(camera);}
  const voice=one<HTMLAnchorElement>(root,'a[aria-label="语音"]')??one<HTMLAnchorElement>(root,'a[aria-label="提交记录"]');if(voice){voice.setAttribute('aria-label','语音使用说明');voice.dataset.action='capture-or-voice';voice.removeAttribute('href');voice.setAttribute('role','button');voice.tabIndex=0;enable(voice);}
}
function bindCapture(root:HTMLElement,c:HandoffContext){
  const dialog=one<HTMLElement>(root,'[role="dialog"]');if(!dialog)return;const parts=kids(dialog),heading=parts[1],title=parts[2],explanation=parts[3],options=parts[4],footer=parts[5];
  const sub=c.state.submissions[0],held=c.state.held.find(h=>!h.deferUntilSessionEnd);
  const rowTemplate=prototypeScreen('Capture').querySelector<HTMLElement>('[role="dialog"] > div:nth-child(5) > button');
  if(!sub&&!held){text(title,'没有待确认项目。');text(explanation,'新的模型提案和规则疑问会出现在这里。');options.replaceChildren();text(kids(heading)[1],'待确认 0 项');text(kids(footer)[0],'返回今日');(kids(footer)[0] as HTMLAnchorElement).href='#Main';text(kids(footer)[1],'');return;}
  const left=kids(footer)[0] as HTMLAnchorElement,right=kids(footer)[1] as HTMLButtonElement;
  options.replaceChildren();
  if(sub){
    const question=(c.reviewQuestions??sub.questions).find(q=>!c.answers[q.id]);
    text(kids(heading)[0],`来自 ${sub.clientId}`);text(kids(heading)[1],`待写入 ${sub.drafts.length} 项`);
    text(title,question?.question??`确认写入 ${sub.drafts.length} 条记录？`);
    explanation.replaceChildren(document.createTextNode(question?.context??'模型理解的原话：'),document.createElement('mark'));
    const mark=one(explanation,'mark')!;text(mark,sub.rawText);mark.setAttribute('style','background:#F0E9F2;color:#141415;padding:2px 4px;border-radius:4px;font-weight:600');
    if(rowTemplate){for(const item of question?.options??sub.drafts.map((draft,index)=>({id:String(index),label:draftLabel(c.state,draft)}))){const row=rowTemplate.cloneNode(true) as HTMLButtonElement;const children=kids(row);text(children[0],item.label);text(children[1],question?'选择此项':`第 ${Number(item.id)+1} 条`);if(question){row.dataset.answerGate=question.id;row.dataset.answerOption=item.id;}else row.disabled=true;options.append(row);}}
    text(left,question?'请先选择':c.reviewLoading?'正在确认问题':'写入 '+sub.drafts.length+' 条');left.removeAttribute('href');left.dataset.action='submission-accept';left.dataset.id=sub.id;if(question||c.reviewLoading)left.setAttribute('aria-disabled','true');else enable(left);
    text(right,'跳过');right.dataset.action='submission-skip';right.dataset.id=sub.id;enable(right);
  }else if(held){
    text(kids(heading)[0],'需要确认');text(kids(heading)[1],`待确认 ${c.state.held.length} 项`);text(title,held.question);
    explanation.replaceChildren(document.createTextNode(held.context??''),document.createElement('mark'));const mark=one(explanation,'mark')!;text(mark,held.highlight??'');mark.setAttribute('style','background:#F0E9F2;color:#141415;padding:2px 4px;border-radius:4px;font-weight:600');
    if(rowTemplate)for(const option of held.options){const row=rowTemplate.cloneNode(true) as HTMLButtonElement;text(kids(row)[0],option.label);text(kids(row)[1],option.hint??'');row.dataset.heldOption=option.id;row.dataset.id=held.id;options.append(row);}
    text(left,'查看记录');left.href='#Ledger';text(right,'跳过');right.dataset.action='held-skip';right.dataset.id=held.id;enable(right);
  }
}
function bindSession(root:HTMLElement,c:HandoffContext){
  const s=c.state,session=openSession(s.entries),page=root.firstElementChild as HTMLElement;if(!session){
    const [header,rest,center,controls]=kids(page);text(kids(kids(header)[1])[0],'训练未开始');text(kids(kids(header)[1])[1],'从「今日」选择训练日');
    const end=one<HTMLAnchorElement>(header,'a[href="#Debrief"]');if(end){end.removeAttribute('href');end.setAttribute('aria-disabled','true');}
    text(kids(rest)[2],'未开始');const bar=one<HTMLElement>(rest,'div[style*="width: 68%"]');if(bar)bar.style.width='0';
    text(kids(center)[0],'下一组');text(kids(kids(center)[1])[0],'—');text(kids(kids(center)[1])[1],'');text(kids(center)[2],'选择训练日后显示');
    one(center,'svg[role="img"]')?.remove();text(kids(center).at(-2),'暂无配片');text(kids(center).at(-1),'尚无上一组');
    text(one(controls,'[style*="min-width: 44px"]'),'—');for(const button of controls.querySelectorAll('button'))button.disabled=true;
    return;
  }
  const day=s.program.days.find(d=>d.id===session.dayId),item=day?.items.find(i=>i.exerciseId===c.exerciseId)??day?.items[0];
  if(!item)return;
  const ex=s.exercises.find(e=>e.id===item.exerciseId),previous=session.sets.filter(e=>e.exerciseId===item.exerciseId).at(-1),next=s.derived[`next.${item.exerciseId}`];
  const [header,rest,center,controls]=kids(page),source=prototypeScreen('Session'),name=kids(header)[1];text(kids(name)[0],ex?.name??item.exerciseId);text(kids(name)[1],`第 ${session.sets.filter(e=>e.exerciseId===item.exerciseId).length+1} 组，共 ${item.sets} 组`);name.dataset.action='next-exercise';name.setAttribute('role','button');name.tabIndex=0;name.setAttribute('aria-label','切换动作');
  const sourcePage=source.firstElementChild as HTMLElement,sourceHeader=kids(sourcePage)[0],sourceCenter=kids(sourcePage)[2];
  const sourceEnd=one<HTMLAnchorElement>(sourceHeader,'a[href="#Debrief"]');if(sourceEnd){const end=sourceEnd.cloneNode(true) as HTMLAnchorElement;end.dataset.action='end-session';header.lastElementChild?.replaceWith(end);}
  text(kids(rest)[2],previous?'休息中':'准备开始');const progress=one<HTMLElement>(rest,'div[style*="width: 68%"]');if(progress)progress.style.width='0%';
  const originalHeading=kids(sourceCenter)[0];if(originalHeading)center.firstElementChild?.replaceWith(originalHeading.cloneNode(true));const weight=kids(center)[1],load=next?.value??item.startLoad;text(kids(weight)[0],load==null?'—':String(load));text(kids(weight)[1],ex?.unit??'');
  text(kids(center)[2],`× ${item.repMin}–${item.repMax}`);text(kids(center).at(-1),previous?`上一组 ${previous.load} × ${previous.reps} · RIR ${previous.rir??'未记'}`:'本场尚无上一组');
  const note=kids(center).find(e=>e.textContent?.includes('配片信息待接入'));if(note){if(ex?.type==='barbell'&&load!=null){const result=plates(load,ex.unit,ex.barLoad);text(note,`每侧 ${result.perSide.length?result.perSide.join(' + '):'无杠片'} · 空杆 ${result.bar}`);}else text(note,ex?.type==='barbell'?'起始重量待设置':'按器械读数记录');}
  const display=one<HTMLElement>(controls,'[style*="min-width: 44px"]');text(display,String(c.reps));
  const minus=one<HTMLButtonElement>(controls,'button[aria-label="减一次"]'),plus=one<HTMLButtonElement>(controls,'button[aria-label="加一次"]');if(minus){minus.dataset.action='reps-minus';enable(minus);}if(plus){plus.dataset.action='reps-plus';enable(plus);}
  for(const radio of controls.querySelectorAll<HTMLButtonElement>('[role="radio"]')){const value=radio.textContent==='3+'?3:Number(radio.textContent);radio.dataset.action='rir';radio.dataset.value=String(value);radio.setAttribute('aria-checked',String(c.rir===value));enable(radio);}
  const complete=controls.lastElementChild as HTMLButtonElement;if(complete){text(complete,load==null?'起始重量待设置':'完成本组');if(load!=null){complete.dataset.action='complete-set';complete.dataset.exerciseId=item.exerciseId;complete.dataset.load=String(load);complete.dataset.unit=ex?.unit??'kg';enable(complete);}}
  const formula=one<HTMLButtonElement>(center,'button[aria-label="计算方式"]');if(formula){formula.dataset.derivedKey=`next.${item.exerciseId}`;enable(formula);}
  const svg=one<SVGSVGElement>(center,'svg[role="img"]');if(svg){if(ex?.type==='barbell'&&load!=null){svg.setAttribute('aria-hidden','true');svg.removeAttribute('aria-label');}else svg.remove();}
}
function bindBody(root:HTMLElement,c:HandoffContext){
  const s=c.state,readings=weights(s),latest=readings.at(-1),main=one(root,'main');if(!main)return;
  setHeading(one(root,'[data-bind="body-title"]'),latest?'按当前趋势，':'体征记录，',latest&&s.derived['bw.projection']?.value!=null&&s.program.targets.bodyweightKg!=null?`${dateLabel(new Date(Date.parse(`${s.today}T00:00:00Z`)+s.derived['bw.projection'].value!*86400000).toISOString().slice(0,10))}达到 ${s.program.targets.bodyweightKg} kg。`:latest?`最近 ${fmt(latest.kg,2)} kg。`:'从一次称重开始。');
  const intro=one(main,'p');text(intro,latest?`${dateLabel(readings[0].date)} 至 ${dateLabel(latest.date)} · ${readings.length} 次称重。${s.program.targets.bodyweightKg==null?'目标尚未设置。':''}`:'尚无体重记录。目标尚未设置。');
  const svg=one<SVGSVGElement>(root,'[data-bind="body-chart"]');if(svg){
    const dots=Array.from(svg.querySelectorAll<SVGCircleElement>('circle:not([data-bind])'));const points=readings.slice(-dots.length);
    dots.forEach(dot=>dot.setAttribute('visibility','hidden'));
    const grid=one<SVGLineElement>(svg,'line[stroke="#E3E3E0"]');if(grid)grid.setAttribute('visibility','hidden');
    for(const label of Array.from(svg.querySelectorAll('text')).filter(node=>!node.dataset.bind))label.setAttribute('visibility','hidden');
    if(points.length){const values=points.map(p=>p.kg),min=Math.min(...values),max=Math.max(...values),spread=Math.max(1,max-min),first=Date.parse(`${points[0].date}T00:00:00Z`),last=Date.parse(`${points.at(-1)!.date}T00:00:00Z`),days=Math.max(1,(last-first)/86400000);
      const x=(date:string)=>10+92*(Date.parse(`${date}T00:00:00Z`)-first)/86400000/days,y=(kg:number)=>165-(kg-min)/spread*105;
      dots.forEach((dot,index)=>{const point=points[index];dot.setAttribute('visibility',point?'visible':'hidden');if(point){dot.setAttribute('cx',String(x(point.date)));dot.setAttribute('cy',String(y(point.kg)));dot.setAttribute('fill',point.condition==='post_bm'?'#F1F1EF':'#141415');dot.setAttribute('stroke',point.condition==='post_bm'?'#141415':'none');}});
      const slope=s.derived['bw.slopeAll'];const line=one<SVGLineElement>(svg,'[data-bind="body-observed-trend"]');if(line&&slope?.value!=null){const firstY=y(points[0].kg),lastY=y(points[0].kg+slope.value*days/7);for(const [key,value] of Object.entries({x1:10,y1:firstY,x2:102,y2:lastY}))line.setAttribute(key,String(value));line.setAttribute('visibility','visible');}
      text(one(svg,'[data-bind="body-start-date"]'),points[0].date.slice(5).replace('-','/'));text(one(svg,'[data-bind="body-current-date"]'),points.at(-1)!.date===s.today?'今天':points.at(-1)!.date.slice(5).replace('-','/'));svg.setAttribute('aria-label',`${points.length} 次真实称重`);
    }else {text(one(svg,'[data-bind="body-start-date"]'),'');text(one(svg,'[data-bind="body-current-date"]'),'');svg.setAttribute('aria-label','暂无体重记录');}
  }
  const legend=svg?.nextElementSibling;if(legend){const rows=kids(legend);legendText(rows[0],'原始称重');legendText(rows[1],`${readings.filter(p=>p.condition==='post_bm').length} 次排便后`);legendText(rows[2],s.derived['bw.slope7d']?.value==null?'趋势待计算':`趋势 ${fmt(s.derived['bw.slope7d'].value)} kg/周`);legendText(rows[3],s.program.targets.bodyweightKg==null?'目标未设置':`目标 ${s.program.targets.bodyweightKg} kg`);}
  const sections=Array.from(main.querySelectorAll('section'));const advice=sections[0];if(advice){const trigger=s.triggers.find(t=>t.status==='pending'||t.status==='will_fire');text(kids(advice)[0],trigger?'建议':'状态');text(kids(advice)[1],trigger?`每天 ${trigger.action.kcal} kcal。`:'暂无体征建议。');const buttons=kids(advice)[2];if(trigger){const [accept,later]=kids(buttons);accept.dataset.action='trigger-accept';later.dataset.action='trigger-later';accept.dataset.id=trigger.id;later.dataset.id=trigger.id;enable(accept);enable(later);}else buttons.remove();}
  const detail=sections[1];if(detail){const rows=Array.from(detail.querySelectorAll('button'));if(rows[0]){text(rows[0],s.derived['bw.slope7d']?'趋势的计算方式 ƒ':'趋势待计算');rows[0].dataset.derivedKey='bw.slope7d';enable(rows[0]);}if(rows[1])text(rows[1],`${readings.filter(p=>p.condition==='post_bm').length} 次排便后称重`);if(rows[2])text(rows[2],`${activeEntries(s).filter(e=>e.kind==='waist').length} 次腰围记录`);}
}
function bindProgress(root:HTMLElement,c:HandoffContext){
  const s=c.state,main=one(root,'main');if(!main)return;
  const milestone=['pull_up','bench_press','lat_pulldown'].find(id=>(s.derived[`rel.${id}`]?.value??0)>=1);
  setHeading(one(root,'[data-bind="progress-title"]'),milestone?`${exName(s,milestone)}，`:'训练进步，',milestone?'已超过自身体重。':'等待更多记录。');
  const intro=main.children[1];if(intro){text(kids(intro)[0],milestone?'根据最近一次有效组计算。':'相对力量需要训练组和体重记录。');const add=kids(intro)[1];if(milestone){text(add,'加入计划');add.dataset.action='progress-add';add.dataset.exerciseId=milestone;enable(add);}else add.remove();}
  const chart=one<SVGSVGElement>(root,'[data-bind="progress-chart"]');if(chart){const labels=Array.from(chart.querySelectorAll('text'));const bars=Array.from(chart.querySelectorAll<SVGRectElement>('rect[fill="#2C4A66"]'));
    ['bench_press','pull_up','lat_pulldown'].forEach((id,index)=>{const d=s.derived[`rel.${id}`],e=s.derived[`e1rm.latest.${id}`];text(labels[index*3],exName(s,id));text(labels[index*3+1],e?.value==null?'待计算':`e1RM ${fmt(e.value,1)} ${e.unit??''}`);text(labels[index*3+2],d?.value==null?'—':`${fmt(d.value,2)}×`);bars[index]?.setAttribute('width',String(d?.value==null?0:Math.min(350,d.value/1.5*350)));});chart.setAttribute('aria-label','根据本人训练组与体重计算的相对力量');}
  const groups=main.querySelectorAll('section')[1];if(groups){const header=groups.firstElementChild;if(header){text(kids(header)[0],'本周训练部位');text(kids(header)[1],`${dateLabel(s.today)} 所在周`);}const spans=Array.from(groups.querySelectorAll<HTMLElement>('div[style*="flex-wrap"] > span'));['chest','back','biceps','shoulders','quads'].forEach((id,index)=>{const d=s.derived[`volume.${id}`];text(spans[index],`${['胸','背','手臂','肩','腿'][index]} · ${d?.value==null?'—':fmt(d.value,0)} 组`);});for(const button of groups.querySelectorAll<HTMLButtonElement>('button')){button.dataset.derivedKey='volume.chest';enable(button);}for(const node of Array.from(groups.querySelectorAll<HTMLElement>('*'))){if(!node.children.length&&node.textContent?.includes('待接入'))text(node,'来自本人训练记录');}}
}
function bindLedger(root:HTMLElement,c:HandoffContext){
  const filters=one(root,'[data-bind="ledger-filters"]');
  if(filters)for(const [index,button] of Array.from(filters.querySelectorAll('button')).entries()){
    const id=(['all','you','model','rule'] as const)[index];
    if(!id)continue;
    button.dataset.filter=id;button.setAttribute('aria-pressed',String(id===c.filter));
    button.style.fontWeight=id===c.filter?'600':'400';button.style.textDecoration=id===c.filter?'underline':'none';
  }
  const s=c.state,timeline=one<HTMLElement>(root,'[data-bind="ledger-timeline"]');if(!timeline)return;
  const original=prototypeScreen('Ledger'),reference=one<HTMLElement>(original,'[data-bind="ledger-timeline"]');if(!reference)return;
  const templates={date:one<HTMLElement>(reference,'[data-row="date"]'),user:one<HTMLElement>(reference,'[data-row="user"]'),model:one<HTMLElement>(reference,'[data-row="model"]'),rule:one<HTMLElement>(reference,'[data-row="rule"]'),reverted:one<HTMLElement>(reference,'[data-row="reverted"]')};
  timeline.replaceChildren(reference.children[0].cloneNode(true));timeline.style.overflowY='auto';timeline.style.minHeight='0';
  const reversals=s.entries.filter((e):e is Extract<Entry,{kind:'revert'}>=>e.kind==='revert');
  const reverted=new Set(reversals.map(e=>e.targetId));
  const entries=s.entries.filter(e=>e.kind!=='revert').sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  let shown=0,lastDate='';
  for(const entry of entries){const source=entry.source.actor;if(c.filter!=='all'&&source!==(c.filter==='you'?'user':c.filter))continue;
    if(entry.date!==lastDate&&templates.date){const header=templates.date.cloneNode(true) as HTMLElement;text(header.lastElementChild,`${dateLabel(entry.date)} · ${['周日','周一','周二','周三','周四','周五','周六'][weekday(entry.date)]}`);timeline.append(header);lastDate=entry.date;}
    const template=reverted.has(entry.id)?templates.reverted:templates[source];if(!template)continue;
    const row=template.cloneNode(true) as HTMLElement,body=row.children[1];text(body.children[0],entryLabel(s,entry));text(body.children[1],reverted.has(entry.id)?`已撤销 · ${reversals.find(e=>e.targetId===entry.id)?.reason??''}`:source==='model'?`来自 ${entry.source.client??'模型'} · 用户已确认`:source==='rule'?`由规则 ${entry.source.client??''} 执行`:entry.source.rawText?`你输入「${entry.source.rawText}」`:'你在应用中记录');
    row.dataset.entryId=entry.id;row.classList.add('record-card');if(!reverted.has(entry.id)){const button=document.createElement('button');button.type='button';button.textContent='撤销';button.dataset.action='entry-revert';button.setAttribute('style','align-self:flex-start;min-height:44px;padding:0 12px;border:0;background:transparent;color:#9E4536;font:inherit;font-size:13px');body.append(button);}timeline.append(row);shown++;
  }
  for(const sub of s.submissions){const template=templates.model;if(!template)continue;const row=template.cloneNode(true) as HTMLElement;const body=row.children[1];text(body.children[0],`待确认 · ${sub.drafts.length} 条记录`);text(body.children[1],`来自 ${sub.clientId} · ${sub.rawText.slice(0,60)}`);row.dataset.action='view-submission';row.dataset.id=sub.id;timeline.append(row);shown++;}
  for(const held of s.held){const template=templates.rule;if(!template)continue;const row=template.cloneNode(true) as HTMLElement,body=row.children[1];text(body.children[0],held.question);text(body.children[1],`${held.gate} · ${held.deferUntilSessionEnd?'训练结束后确认':'等待你确认'}`);row.dataset.action='view-submission';row.dataset.id=held.id;timeline.append(row);shown++;}
  if(!shown){const row=templates.user?.cloneNode(true) as HTMLElement|undefined;if(row){text(row.children[1].children[0],'还没有记录');text(row.children[1].children[1],'在「今日」输入体重或训练组。');timeline.append(row);}}
}
function bindConnect(root:HTMLElement,c:HandoffContext){
  const s=c.state;setHeading(one(root,'h1'),'模型可以换，','数据只有一份。');
  const panel=one(root,'div[style*="已接入"]');void panel;
  const candidates=Array.from(root.querySelectorAll<HTMLElement>('div')).filter(e=>e.children.length===0&&e.textContent?.trim()==='已接入');if(candidates[0])text(candidates[0],s.clients.some(client=>client.status==='active')?'已接入':'尚未接入');
  const rows=Array.from(root.querySelectorAll<HTMLElement>('div[style*="min-height: 52px"]')).filter(e=>e.querySelector('span[style*="width: 6px"]'));
  const parent=rows[0]?.parentElement,template=rows[0];if(parent&&template){parent.replaceChildren();for(const [index,client] of (s.clients.length?s.clients:[null]).entries()){
    const row=template.cloneNode(true) as HTMLElement,left=kids(row)[0],status=kids(row)[1],dot=one<HTMLElement>(status,'span');
    row.style.borderTop=index?'1px solid #EDEDEB':'none';text(kids(left)[0],client?.name??'暂无授权客户端');text(kids(left)[1],client?`MCP · ${client.scopes.join(' + ')}`:'连接后显示实际授权与权限');
    if(status.lastChild?.nodeType===Node.TEXT_NODE)status.lastChild.textContent=client?.status==='active'?'撤销接入':client?'已撤销':'未连接';
    if(client?.status!=='active'){status.style.color='#6C6C71';if(dot)dot.style.background='#A1A1A5';}
    if(client?.status==='active'){row.dataset.action='client-revoke';row.dataset.id=client.id;row.setAttribute('role','button');row.tabIndex=0;row.setAttribute('aria-label',`撤销 ${client.name} 的接入`);}
    parent.append(row);
  }}
  const namesInTable=Array.from(root.querySelectorAll<HTMLElement>('span')).find(e=>e.textContent?.trim()==='log_entries');if(namesInTable){text(namesInTable,'propose_entries');text(namesInTable.nextElementSibling,'提交待审 · 由你写入');}
  const propose=Array.from(root.querySelectorAll<HTMLElement>('span')).find(e=>e.textContent?.trim()==='propose_change');if(propose)text(propose.nextElementSibling,'提议 · 进审阅队列');
  for(const node of Array.from(root.querySelectorAll<HTMLElement>('*'))){
    if(node.children.length)continue;
    if(node.textContent?.includes('规划中的 MCP 工具'))text(node,'MCP 工具');
    if(node.textContent?.includes('尚未开放'))text(node,'复制');
  }
  const endpoint=Array.from(root.querySelectorAll<HTMLElement>('div')).find(e=>e.children.length===0&&e.textContent?.trim()==='[YOUR-ENDPOINT]/mcp');if(endpoint)text(endpoint,`${location.origin}/mcp`);
  const copy=Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(e=>e.textContent?.trim()==='复制');if(copy){copy.dataset.action='copy-endpoint';enable(copy);}
}
function bindTransition(root:HTMLElement,c:HandoffContext){
  const session=openSession(c.state.entries),day=c.state.program.days.find(d=>d.id===session?.dayId),id=day?.items[0]?.exerciseId,load=id?c.state.derived[`next.${id}`]?.value:null;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.textContent?.trim()==='—'&&load!=null)node.textContent=String(load);}
  for(const node of Array.from(root.querySelectorAll<HTMLElement>('*'))){if(!node.children.length&&node.textContent?.includes('训练流程待接入'))text(node,'尚未开始训练');}
}
function bindDebrief(root:HTMLElement,c:HandoffContext){
  const s=c.state,page=root.firstElementChild as HTMLElement,session=sessions(s.entries).at(-1);if(!session){
    const [intro,hero,best]=kids(page);text(kids(intro)[0],'尚未完成训练');text(kids(intro)[1],'训练总结');text(kids(hero)[0],'本次训练');text(kids(kids(hero)[1])[0],'—');text(kids(kids(hero)[1])[1],'');text(kids(hero)[2],'完成训练后显示结果');kids(hero)[3]?.remove();for(const row of kids(best).slice(1))row.remove();one(page,'a[href="#Capture"]')?.remove();text(page.lastElementChild,'返回今日');
    return;
  }
  const [intro,hero,best]=kids(page);text(kids(intro)[0],`${dateLabel(session.date)} · ${s.program.days.find(d=>d.id===session.dayId)?.name??'训练'}`);text(kids(intro)[1],'训练完成');
  const byExercise=new Map<string,SetEntry[]>();for(const set of session.sets)(byExercise.get(set.exerciseId)??byExercise.set(set.exerciseId,[]).get(set.exerciseId)!).push(set);
  const first=[...byExercise.keys()][0],value=first?s.derived[`e1rm.latest.${first}`]:null;
  text(kids(hero)[0],first?`${exName(s,first)} e1RM ƒ`:'本次训练');text(kids(kids(hero)[1])[0],value?.value==null?'—':fmt(value.value,1));text(kids(kids(hero)[1])[1],value?.unit??'');text(kids(hero)[2],`${byExercise.size} 个动作 · ${session.sets.length} 组`);
  const badge=kids(hero)[3];if(badge){const bestValue=first?s.derived[`e1rm.best.${first}`]:null;if(value?.value!=null&&bestValue?.value===value.value){text(kids(badge)[0],'新纪录');text(kids(badge)[1],'本次最佳');}else badge.remove();}
  const source=prototypeScreen('Debrief'),template=source.querySelector('div[style*="margin-top: 44px"]')?.children[1];for(const row of kids(best).slice(1))row.remove();
  if(template&&byExercise.size)for(const [id,sets] of byExercise){const row=template.cloneNode(true) as HTMLElement,bestSet=sets.reduce((a,b)=>a.load*b.reps>=b.load*b.reps?a:b);text(kids(row)[0],exName(s,id));text(kids(row)[1],`${bestSet.load} ${bestSet.unit} × ${bestSet.reps}`);best.append(row);}
  else if(template){const row=template.cloneNode(true) as HTMLElement;text(kids(row)[0],'没有完成的组');text(kids(row)[1],'—');best.append(row);}
  const held=s.held.filter(h=>h.deferUntilSessionEnd);let question=one<HTMLAnchorElement>(page,'a[href="#Capture"]');
  if(held.length||s.submissions.length){if(!question){const source=prototypeScreen('Debrief'),template=one<HTMLAnchorElement>(source,'a[href="#Capture"]');if(template){question=template.cloneNode(true) as HTMLAnchorElement;page.insertBefore(question,page.lastElementChild?.previousElementSibling??null);}}
    if(question){text(one(question,'span'),`需要确认 · ${held.length+s.submissions.length}`);text(one(question,'span:nth-child(2)'),held[0]?.question??'模型提案待确认');}}
  else question?.remove();text(page.lastElementChild,'返回今日');
  const formula=one<HTMLButtonElement>(hero,'button[aria-label="计算方式"]');if(formula&&first){formula.dataset.derivedKey=`e1rm.latest.${first}`;enable(formula);}
}
export function bindHandoff(root:HTMLElement,context:HandoffContext){
  switch(context.screen){case 'Main':bindMain(root,context);break;case 'Capture':bindCapture(root,context);break;case 'Session':bindSession(root,context);break;case 'Body':bindBody(root,context);break;case 'Progress':bindProgress(root,context);break;case 'Ledger':bindLedger(root,context);break;case 'Connect':bindConnect(root,context);break;case 'Transition':bindTransition(root,context);break;case 'Debrief':bindDebrief(root,context);break;case 'Icon':break;}
}
