import { MUSCLE_LABEL, Muscle } from '@lowkkey/protocol';
import type { Entry, EntryDraft, SetEntry, WeightEntry } from '@lowkkey/protocol';
import { active, convert, openSession, plates, sessions } from '@lowkkey/core';
import type { V1State } from '../server/v1-store.ts';
import { prototypeScreen } from './prototype-template.ts';
import { clientName } from './sheet-bindings.ts';
import type { ReviewTarget, Screen } from './navigation.ts';

export type HandoffContext={state:V1State;screen:Screen;toast:Entry|null;queueCount:number;busy:boolean;error:string;filter:'all'|'you'|'model'|'rule';answers:Record<string,string>;reviewOutcome?:string|null;reviewTarget?:ReviewTarget|null;reviewQuestions?:V1State['submissions'][number]['questions'];reviewLoading?:boolean;reps:number;rir:number|null;exerciseId:string|null;manualLoad:string;manualUnit:'kg'|'lb'|null;setRole?:'work'|'warmup';allowExtra?:boolean;suggestion?:{value:number|null;unit:'kg'|'lb';ruleVersion:string;inputs:string[]}|null};
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
    for(const key of ['body-goal-grid','body-goal-label','body-reference-grid','body-reference-label','body-goal-trend','body-goal-speed','body-forecast-trend','body-forecast-point','body-forecast-date','body-middle-date','body-end-date','body-observed-trend','body-today-grid'])one(chart??root,`[data-bind="${key}"]`)?.setAttribute('visibility','hidden');
    for(const key of ['body-goal-label','body-reference-label','body-goal-speed','body-forecast-date','body-middle-date','body-end-date'])text(one(chart??root,`[data-bind="${key}"]`),'');
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
  if(entry.kind==='set_annotation')return '更正训练组类别';
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
  const s=c.state,session=openSession(s.entries),day=session?s.program.days.find(item=>item.id===session.dayId)??null:dayFor(s),weight=latestWeight(s),slope=s.derived['bw.slope7d'],week=s.derived['cycle.week'];
  setHeading(one(root,'[data-bind="main-title"]'),'今天，',day?`${day.name}。`:s.program.days.length?'按你的节奏。':activeEntries(s).length?'继续记录。':'从一条记录开始。');
  const metrics=one(root,'[data-bind="main-title"]')?.nextElementSibling;if(metrics){const [first,second,third]=kids(metrics);
    text(one(first,'span'),weight?fmt(weight.kg,2):'—');text(first.lastChild as unknown as Element,weight?`kg · ${weight.date===s.today?'今日':dateLabel(weight.date)}`:'kg · 尚未记录');
    text(one(second,'span'),slope?.value==null?'—':`${slope.value>=0?'+':''}${fmt(slope.value)}`);text(one(third,'span'),week?.value==null?'—':String(week.value));
    const suffix=third?.lastChild;if(suffix?.nodeType===Node.TEXT_NODE)suffix.textContent=week?.value==null?' / 周期未设置':' / 周期';
    first.hidden=!weight;second.hidden=slope?.value==null;third.hidden=week?.value==null&&!s.program.targets.goal;if(week?.value==null)text(third,s.program.targets.goal?{gain:'增肌',lose:'减脂',maintain:'维持',record:'只记录'}[s.program.targets.goal.mode]:'');
    second.dataset.derivedKey='bw.slope7d';
  }
  const advice=one(root,'[data-bind="main-advice"]');const slot=s.decisionSlots?.[s.today],trigger=!session&&slot&&!slot.closed&&slot.kind==='trigger'?s.triggers.find(t=>t.id===slot.id):undefined,proposal=!session&&slot&&!slot.closed&&slot.kind==='proposal'?s.proposals.find(p=>p.id===slot.id):undefined,pending=session?undefined:s.submissions.at(0)??s.held.find(h=>!h.deferUntilSessionEnd);
  if(advice){const [label,title,detail,buttons]=kids(advice);text(label,pending?'等待确认':trigger?'建议':proposal?`${proposal.author.actor==='model'?'AI 已提交':'已提交'} · 等待确认`:'状态');text(title,pending?('clientId' in pending?`确认 ${pending.drafts.length} 条记录。`:pending.question):trigger?`每天 ${trigger.action.kcal} kcal。`:proposal?.title??(activeEntries(s).length?'最近记下了。':'先记下今天。'));text(detail,pending?('clientId' in pending?`来自 ${clientName(s,pending.clientId)} · 确认后才写入。`:'请核对这次记录中的问题。'):trigger?`从 ${dateLabel(trigger.dueDate>s.today?trigger.dueDate:s.today)} 起调整；由你采用后生效。`:proposal?.rationale??(activeEntries(s).length?entryLabel(s,activeEntries(s).at(-1)!):'体重或训练，记一条就好。'));
    const [accept,later]=kids(buttons);if(pending){text(accept,'查看并确认');accept.dataset.action='view-pending';enable(accept);later.remove();}else if(trigger){text(accept,'查看并确认');text(later,'以后');accept.dataset.action='decision-view';accept.dataset.kind='trigger';later.dataset.action='trigger-later';accept.dataset.id=trigger.id;later.dataset.id=trigger.id;enable(accept);enable(later);}else if(proposal){text(accept,'查看并确认');text(later,'以后');accept.dataset.action='decision-view';accept.dataset.kind='proposal';later.dataset.action='proposal-later';accept.dataset.id=proposal.id;later.dataset.id=proposal.id;enable(accept);enable(later);}else buttons.remove();}
  const plan=one(root,'[data-bind="main-plan"]');if(plan){const heading=kids(plan)[0],source=prototypeScreen('Main').querySelector('[data-bind="main-plan"]');const template=source?.children[1];
    for(const row of kids(plan).slice(1,-1))row.remove();
    const items=day?.items??[];text(kids(heading)[0],s.program.days.length?'今天的安排':'训练安排');text(kids(heading)[1],day?`${items.length} 个动作 · ${items.reduce((n,i)=>n+i.sets,0)} 组`:'');
    if(s.program.days.length){heading.dataset.action='plan-view';heading.setAttribute('role','button');heading.tabIndex=0;heading.setAttribute('aria-label','查看完整训练计划');}if(day){const summary=document.createElement('span');summary.className='plan-summary';summary.textContent=`${day.name} · ${items.slice(0,2).map(item=>exName(s,item.exerciseId)).join('、')}${items.length>2?'等动作':''}`;heading.append(summary);}
    if(items.length&&template)for(const item of items){const row=template.cloneNode(true) as HTMLElement;row.dataset.rowKey=item.exerciseId;const [name,,load]=kids(row);const rx=s.derived[`rx.${day!.id}.${item.exerciseId}`];text(name,exName(s,item.exerciseId));text(load,`${item.sets} × ${item.repMin}–${item.repMax}${rx?.value==null?'':` · ${rx.value} ${rx.unit??''}`}`);plan.insertBefore(row,plan.lastElementChild);}
    else if(template){const row=template.cloneNode(true) as HTMLElement;const [label,line,value]=kids(row);text(label,s.program.days.length?'今天没有预定训练':'计划确认后，训练安排会显示在这里。');line.remove();value.remove();plan.insertBefore(row,plan.lastElementChild);}
    const start=plan.lastElementChild as HTMLElement;if(session){text(start,'继续训练');start.dataset.action='resume-session';enable(start);start.setAttribute('href','#Session');}
    else if(day){text(start,'开始训练');start.dataset.action='start-session';enable(start);start.setAttribute('href','#Session');}
    else if(s.program.days.length){text(start,'查看其他训练日');start.dataset.action='choose-day';enable(start);start.removeAttribute('href');start.setAttribute('role','button');}
    else start.remove();
  }
  const input=one<HTMLInputElement>(root,'input[data-action="capture-input"]');if(input){input.disabled=false;input.placeholder='记下体重或刚完成的训练';}
  if(input)input.setAttribute('aria-label','今天发生了什么？');
  const status=one<HTMLElement>(root,'[data-bind="capture-status"]');if(status){if(c.toast){status.hidden=false;legendText(one<HTMLElement>(status,'span')??undefined,`已记录 ${entryLabel(s,c.toast)}`);const undo=one<HTMLButtonElement>(status,'button');if(undo){text(undo,'撤销');undo.dataset.action='toast-revert';enable(undo);}}
    else if(c.error||c.queueCount){status.hidden=false;text(one(status,'span'),c.error||`${c.queueCount} 条待发送 · 联网后提交`);}
    else status.hidden=true;}
  const camera=one<HTMLButtonElement>(root,'button[aria-label="拍照或截图"]')??one<HTMLButtonElement>(root,'button[aria-label="相机尚未接入"]');if(camera){camera.setAttribute('aria-label','照片使用说明');camera.dataset.action='external-photo';enable(camera);}
  const voice=one<HTMLAnchorElement>(root,'a[aria-label="语音"]')??one<HTMLAnchorElement>(root,'a[aria-label="提交记录"]');if(voice){voice.setAttribute('aria-label','语音使用说明');voice.dataset.action='capture-or-voice';voice.removeAttribute('href');voice.setAttribute('role','button');voice.tabIndex=0;enable(voice);}
}
function bindCapture(root:HTMLElement,c:HandoffContext){
  const dialog=one<HTMLElement>(root,'[role="dialog"]');if(!dialog)return;const parts=kids(dialog),heading=parts[1],title=parts[2],explanation=parts[3],options=parts[4],footer=parts[5];
  const sub=c.reviewTarget?c.state.submissions.find(s=>c.reviewTarget?.kind==='submission'&&s.id===c.reviewTarget.id):c.state.submissions[0],held=c.state.held.find(h=>(!c.reviewTarget||c.reviewTarget.kind==='held'&&h.id===c.reviewTarget.id)&&(!h.deferUntilSessionEnd||!openSession(c.state.entries)));
  const rowTemplate=prototypeScreen('Capture').querySelector<HTMLElement>('[role="dialog"] > div:nth-child(5) > button');
  if(!sub&&!held){text(title,c.reviewOutcome??'没有待确认项目。');text(explanation,c.reviewTarget?'当前事项的处理状态以本人账户为准。':'新的模型提案和规则疑问会出现在这里。');options.replaceChildren();legendText(kids(heading)[1],'待确认 0 项');text(kids(footer)[0],'返回今日');(kids(footer)[0] as HTMLAnchorElement).href='#Main';kids(footer)[1].remove();return;}
  const left=kids(footer)[0] as HTMLAnchorElement,right=kids(footer)[1] as HTMLButtonElement;
  options.replaceChildren();
  if(sub){
    const question=(c.reviewQuestions??sub.questions).find(q=>!c.answers[q.id]);
    text(kids(heading)[0],`来自 ${clientName(c.state,sub.clientId)}`);legendText(kids(heading)[1],`待写入 ${sub.drafts.length} 项`);
    text(title,question?.question??`确认写入 ${sub.drafts.length} 条记录？`);
    explanation.replaceChildren(document.createTextNode(question?.context??'模型理解的原话：'),document.createElement('mark'));
    const mark=one(explanation,'mark')!;text(mark,sub.rawText);mark.setAttribute('style','background:#F0E9F2;color:#141415;padding:2px 4px;border-radius:4px;font-weight:600');
    if(rowTemplate){for(const item of question?.options??sub.drafts.map((draft,index)=>({id:String(index),label:draftLabel(c.state,draft)}))){const row=rowTemplate.cloneNode(true) as HTMLButtonElement;row.dataset.rowKey=`draft:${sub.id}:${item.id}`;const children=kids(row);text(children[0],item.label);text(children[1],question?'选择此项':`第 ${Number(item.id)+1} 条`);if(question){row.dataset.rowKey=`${question.id}:${item.id}`;row.dataset.answerGate=question.id;row.dataset.answerOption=item.id;}else row.disabled=true;options.append(row);}}
    text(left,question?'请先选择':c.reviewLoading?'正在确认问题':'写入 '+sub.drafts.length+' 条');left.removeAttribute('href');left.dataset.action='submission-accept';left.dataset.id=sub.id;if(question||c.reviewLoading)left.setAttribute('aria-disabled','true');else enable(left);
    text(right,'跳过');right.dataset.action='submission-skip';right.dataset.id=sub.id;enable(right);
  }else if(held){
    text(kids(heading)[0],'需要确认');legendText(kids(heading)[1],`待确认 ${c.state.held.length} 项`);text(title,held.question);
    explanation.replaceChildren(document.createTextNode(held.context??''),document.createElement('mark'));const mark=one(explanation,'mark')!;text(mark,held.highlight??'');mark.setAttribute('style','background:#F0E9F2;color:#141415;padding:2px 4px;border-radius:4px;font-weight:600');
    if(rowTemplate)for(const option of held.options){const row=rowTemplate.cloneNode(true) as HTMLButtonElement;text(kids(row)[0],option.label);text(kids(row)[1],option.hint??'');row.dataset.rowKey=`${held.id}:${option.id}`;row.dataset.heldOption=option.id;row.dataset.id=held.id;options.append(row);}
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
    text(one(controls,'[style*="min-width: 44px"]'),'—');for(const button of controls.querySelectorAll('button')){button.disabled=true;button.style.opacity='0.45';}
    return;
  }
  const day=s.program.days.find(d=>d.id===session.dayId),item=day?.items.find(i=>i.exerciseId===c.exerciseId)??day?.items[0];
  if(!item)return;
  const ex=s.exercises.find(e=>e.id===item.exerciseId),previous=session.sets.filter(e=>e.exerciseId===item.exerciseId).at(-1),next=s.derived[`next.${item.exerciseId}`];
  const [header,rest,center,controls]=kids(page),source=prototypeScreen('Session'),name=kids(header)[1];text(kids(name)[0],ex?.name??item.exerciseId);text(kids(name)[1],`第 ${session.sets.filter(e=>e.exerciseId===item.exerciseId&&e.setRole==='work').length+1} 组，共 ${session.prescription?.find(i=>i.exerciseId===item.exerciseId)?.sets??item.sets} 组`);name.dataset.action='exercise-list';name.setAttribute('role','button');name.tabIndex=0;name.setAttribute('aria-label','动作清单');const list=document.createElement('span');list.className='exercise-list-label';list.textContent='动作清单 ›';name.append(list);
  const sourcePage=source.firstElementChild as HTMLElement,sourceHeader=kids(sourcePage)[0],sourceCenter=kids(sourcePage)[2];
  const sourceEnd=one<HTMLAnchorElement>(sourceHeader,'a[href="#Debrief"]');if(sourceEnd){const end=sourceEnd.cloneNode(true) as HTMLAnchorElement;end.dataset.action='end-session';header.lastElementChild?.replaceWith(end);}
  text(kids(rest)[2],previous?'休息中':'准备开始');const progress=one<HTMLElement>(rest,'div[style*="width: 68%"]');if(progress)progress.style.width='0%';
  const originalHeading=kids(sourceCenter)[0];if(originalHeading)center.firstElementChild?.replaceWith(originalHeading.cloneNode(true));const weight=kids(center)[1],suggested=c.suggestion?.value??next?.value??item.startLoad,entered=c.manualLoad.trim()?Number(c.manualLoad):null,load=entered!==null?(Number.isFinite(entered)&&entered>=0&&entered<=1000?entered:null):suggested==null?null:convert(suggested,c.suggestion?.unit??ex?.unit??'kg',c.manualUnit??ex?.unit??'kg');
  {const input=document.createElement('input');input.type='number';input.min='0';input.max='1000';input.step='0.5';input.inputMode='decimal';input.value=c.manualLoad;input.placeholder=load==null?'—':String(load);input.dataset.action='load-input';input.setAttribute('aria-label',suggested==null?'首次重量：输入本组重量':'本组重量（留空采用建议）');input.setAttribute('style',"width: 250px; height: 116px; padding: 0; border: 0; border-bottom: 1px solid #7F7F84; border-radius: 0; outline: none; background: transparent; color: #F2F2F0; text-align: right; font-family: Geist,-apple-system,'SF Pro Display',sans-serif; font-variant-numeric: tabular-nums; font-size: 90px; font-weight: 500");kids(weight)[0].replaceWith(input);
    const unit=document.createElement('button');unit.type='button';unit.dataset.action='load-unit';unit.dataset.unitDefault=ex?.unit??'kg';unit.textContent=`${c.manualUnit??ex?.unit??'kg'}${c.manualUnit?' ✓':''}`;unit.setAttribute('aria-label',c.manualUnit?`重量单位已确认 ${c.manualUnit}，点按切换`:`确认重量单位 ${ex?.unit??'kg'}`);unit.setAttribute('aria-pressed',String(c.manualUnit!==null));unit.setAttribute('style',"padding: 0; border: 0; background: transparent; color: #7F7F84; font: inherit; font-size: 20px");kids(weight)[1].replaceWith(unit);
  }
  const role=kids(rest)[0];text(role,c.setRole==='warmup'?'热身组':'正式组');role.dataset.action='set-role';role.setAttribute('role','button');role.setAttribute('aria-label','切换热身或正式组');role.tabIndex=0;
  text(kids(center)[2],`× ${item.repMin}–${item.repMax}${ex?.perHand?' · 单只哑铃':ex?.type==='assisted'?' · 辅助配重':''}`);text(kids(center).at(-1),previous?`上一组 ${previous.load} × ${previous.reps} ${previous.unit} · RIR ${previous.rir??'未记'}`:'本场尚无上一组');
  const unit=c.manualUnit??ex?.unit??'kg',canPlate=ex?.type==='barbell'&&load!=null&&(suggested!=null||c.manualUnit!==null),plateInfo=canPlate?plates(convert(load!,unit,ex!.unit),ex!.unit,ex!.barLoad):null;
  const note=kids(center).at(-2);if(note){if(plateInfo){const parts=kids(note);text(parts[0],plateInfo.perSide.length?plateInfo.perSide.join(' + '):'无杠片');text(parts[1],String(plateInfo.bar));note.append(document.createTextNode(` ${ex!.unit}${plateInfo.remainder?` · ${plateInfo.remainder} ${ex!.unit} 无法配出`:''}`));}else text(note,ex?.type==='barbell'?'输入本组重量并确认单位后显示配片':'按器械读数记录');}
  const rirLabel=controls.querySelector('[role="radiogroup"]')?.previousElementSibling;if(rirLabel)text(rirLabel,'RIR · 这组结束时，还能再做几次（可不填）');
  const display=one<HTMLElement>(controls,'[style*="min-width: 44px"]');text(display,String(c.reps));
  const minus=one<HTMLButtonElement>(controls,'button[aria-label="减一次"]'),plus=one<HTMLButtonElement>(controls,'button[aria-label="加一次"]');if(minus){minus.dataset.action='reps-minus';enable(minus);}if(plus){plus.dataset.action='reps-plus';enable(plus);}
  for(const radio of controls.querySelectorAll<HTMLButtonElement>('[role="radio"]')){const value=radio.textContent==='3+'?3:Number(radio.textContent);radio.dataset.action='rir';radio.dataset.value=String(value);radio.setAttribute('aria-checked',String(c.rir===value));enable(radio);}
  const complete=controls.lastElementChild as HTMLButtonElement;if(complete){const ready=load!=null&&(suggested!=null||c.manualUnit!==null);text(complete,load==null?'填写重量后完成本组':ready?'完成本组':'确认单位后完成本组');if(ready){complete.dataset.action='complete-set';complete.dataset.exerciseId=item.exerciseId;complete.dataset.load=String(load);complete.dataset.unit=c.manualUnit??ex?.unit??'kg';enable(complete);}else complete.disabled=true;}
  const workCount=session.sets.filter(set=>set.exerciseId===item.exerciseId&&set.setRole==='work').length,planned=session.prescription?.find(rx=>rx.exerciseId===item.exerciseId)?.sets??item.sets;
  if(workCount>=planned&&!c.allowExtra){
    text(kids(name)[1],`已记录 ${workCount} 组正式组 · 计划 ${planned} 组`);
    const remaining=day!.items.find(candidate=>candidate.exerciseId!==item.exerciseId&&session.sets.filter(set=>set.exerciseId===candidate.exerciseId&&set.setRole==='work').length<(session.prescription?.find(rx=>rx.exerciseId===candidate.exerciseId)?.sets??candidate.sets));
    if(complete){
      for(const key of ['exerciseId','load','unit'])delete complete.dataset[key];
      text(complete,remaining?`下一个动作：${exName(s,remaining.exerciseId)}`:'结束本次训练');complete.dataset.action=remaining?'next-exercise':'end-session';if(remaining)complete.dataset.id=remaining.exerciseId;enable(complete);
      const extra=document.createElement('button');extra.type='button';extra.dataset.action='extra-set';extra.className='extra-set-button';extra.textContent='再记一组';controls.insertBefore(extra,complete);
    }
  }
  const formula=one<HTMLButtonElement>(center,'button[aria-label="计算方式"]');if(formula){if(next?.value!=null){formula.dataset.derivedKey=`next.${item.exerciseId}`;enable(formula);}else{formula.disabled=true;formula.setAttribute('aria-label','首次重量由你填写');}}
  const svg=one<SVGSVGElement>(center,'svg[role="img"]');if(svg){if(plateInfo){svg.setAttribute('aria-label',`每侧 ${plateInfo.perSide.join(' + ')||'无杠片'}，空杆 ${plateInfo.bar} ${ex!.unit}`);const original=[...svg.querySelectorAll('rect')].slice(-4);const large=original[0],small=original[1];original.forEach(rect=>rect.remove());let offset=0;for(const [index] of plateInfo.perSide.entries()){const plate=(index===0?large:small);const width=Number(plate.getAttribute('width'));for(const side of ['left','right']){const copy=plate.cloneNode(true) as SVGRectElement;copy.setAttribute('x',String(side==='left'?83-offset-width:243+offset));svg.append(copy);}offset+=width+2;}}else svg.remove();}
}
function bindBody(root:HTMLElement,c:HandoffContext){
  const s=c.state,readings=weights(s),latest=readings.at(-1),main=one(root,'main');if(!main)return;
  const projection=s.derived['bw.projection']?.value;
  setHeading(one(root,'[data-bind="body-title"]'),projection!=null&&s.program.targets.bodyweightKg!=null?'按当前趋势，':'体征记录，',latest&&projection!=null&&s.program.targets.bodyweightKg!=null?`${dateLabel(new Date(Date.parse(`${s.today}T00:00:00Z`)+projection*86400000).toISOString().slice(0,10))}达到 ${s.program.targets.bodyweightKg} kg。`:latest?`最近 ${fmt(latest.kg,2)} kg。`:'从一次称重开始。');
  const intro=one(main,'p');text(intro,latest?`${dateLabel(readings[0].date)} 至 ${dateLabel(latest.date)} · ${readings.length} 次称重。`:'记下一次称重，变化会从这里开始。');
  const svg=one<SVGSVGElement>(root,'[data-bind="body-chart"]');if(svg){svg.toggleAttribute('hidden',!readings.length);
    const dots=Array.from(svg.querySelectorAll<SVGCircleElement>('circle:not([data-bind])'));const points=readings.slice(-dots.length);
    dots.forEach(dot=>dot.setAttribute('visibility','hidden'));
    const grid=one<SVGLineElement>(svg,'line[stroke="#E3E3E0"]');if(grid)grid.setAttribute('visibility','hidden');
    for(const label of Array.from(svg.querySelectorAll('text')).filter(node=>!node.dataset.bind))label.setAttribute('visibility','hidden');
    if(points.length){const target=s.program.targets.bodyweightKg,values=points.map(p=>p.kg),min=Math.min(...values,...(target==null?[]:[target])),max=Math.max(...values,...(target==null?[]:[target])),spread=Math.max(1,max-min),first=Date.parse(`${points[0].date}T00:00:00Z`),last=Date.parse(`${points.at(-1)!.date}T00:00:00Z`),days=Math.max(1,(last-first)/86400000);
      const x=(date:string)=>10+92*(Date.parse(`${date}T00:00:00Z`)-first)/86400000/days,y=(kg:number)=>165-(kg-min)/spread*105;
      dots.forEach((dot,index)=>{const point=points[index];dot.setAttribute('visibility',point?'visible':'hidden');if(point){dot.setAttribute('cx',String(x(point.date)));dot.setAttribute('cy',String(y(point.kg)));dot.setAttribute('fill',point.condition==='post_bm'?'#F1F1EF':'#141415');dot.setAttribute('stroke',point.condition==='post_bm'?'#141415':'none');}});
      const slope=s.derived['bw.slopeAll'];const line=one<SVGLineElement>(svg,'[data-bind="body-observed-trend"]');if(line&&slope?.value!=null){const firstY=y(points[0].kg),lastY=y(points[0].kg+slope.value*days/7);for(const [key,value] of Object.entries({x1:10,y1:firstY,x2:102,y2:lastY}))line.setAttribute(key,String(value));line.setAttribute('visibility','visible');}
      const todayLine=one<SVGLineElement>(svg,'[data-bind="body-today-grid"]');if(todayLine){todayLine.setAttribute('x1','102');todayLine.setAttribute('x2','102');todayLine.setAttribute('visibility','visible');}
      if(target!=null){const goalY=y(target),goalGrid=one<SVGLineElement>(svg,'[data-bind="body-goal-grid"]'),goalLabel=one<SVGTextElement>(svg,'[data-bind="body-goal-label"]');
        if(goalGrid){goalGrid.setAttribute('y1',String(goalY));goalGrid.setAttribute('y2',String(goalY));goalGrid.setAttribute('visibility','visible');}
        if(goalLabel){goalLabel.setAttribute('y',String(Math.max(12,goalY-6)));text(goalLabel,`目标 ${target} kg`);goalLabel.setAttribute('visibility','visible');}
        for(const [derivedKey,lineKey,labelKey] of [['bw.projection','body-forecast-trend','body-forecast-date'],['bw.projectionTarget','body-goal-trend','body-goal-speed']] as const){
          const count=s.derived[derivedKey]?.value;if(count==null||count<0)continue;
          const futureX=Math.min(340,Math.max(120,102+count*92/days));
          const trendLine=one<SVGLineElement>(svg,`[data-bind="${lineKey}"]`);
          if(trendLine){for(const [key,value] of Object.entries({x1:102,y1:y(points.at(-1)!.kg),x2:futureX,y2:goalY}))trendLine.setAttribute(key,String(value));trendLine.setAttribute('visibility','visible');}
          const date=new Date(Date.parse(`${s.today}T00:00:00Z`)+count*86400000).toISOString().slice(0,10),label=one<SVGTextElement>(svg,`[data-bind="${labelKey}"]`);
          if(label){text(label,derivedKey==='bw.projectionTarget'?`目标速度 → ${dateLabel(date)}`:date.slice(5).replace('-','/'));label.setAttribute('x',String(futureX));label.setAttribute('visibility','visible');}
          if(derivedKey==='bw.projection'){const dot=one<SVGCircleElement>(svg,'[data-bind="body-forecast-point"]');if(dot){dot.setAttribute('cx',String(futureX));dot.setAttribute('cy',String(goalY));dot.setAttribute('visibility','visible');}}
        }
      }
      text(one(svg,'[data-bind="body-start-date"]'),points[0].date.slice(5).replace('-','/'));text(one(svg,'[data-bind="body-current-date"]'),points.at(-1)!.date===s.today?'今天':points.at(-1)!.date.slice(5).replace('-','/'));svg.setAttribute('aria-label',`${points.length} 次真实称重`);
    }else {text(one(svg,'[data-bind="body-start-date"]'),'');text(one(svg,'[data-bind="body-current-date"]'),'');svg.setAttribute('aria-label','暂无体重记录');}
  }
  const legend=svg?.nextElementSibling;if(legend){legend.toggleAttribute('hidden',!readings.length);const rows=kids(legend);legendText(rows[0],'原始称重');legendText(rows[1],`${readings.filter(p=>p.condition==='post_bm').length} 次排便后`);legendText(rows[2],s.derived['bw.slope7d']?.value==null?'趋势待计算':`趋势 ${fmt(s.derived['bw.slope7d'].value)} kg/周`);legendText(rows[3],s.program.targets.bodyweightKg==null?'目标未设置':`目标 ${s.program.targets.bodyweightKg} kg`);}
  const sections=Array.from(main.querySelectorAll('section'));const advice=sections[0];if(advice){advice.hidden=!s.program.targets.goal&&s.program.targets.bodyweightKg==null;text(kids(advice)[0],'你的目标');text(kids(advice)[1],s.program.targets.goal?({gain:'增肌',lose:'减脂',maintain:'维持',record:'先只记录'}[s.program.targets.goal.mode]+(s.program.targets.goal.maintenanceKg?` · ${s.program.targets.goal.maintenanceKg.min}–${s.program.targets.goal.maintenanceKg.max} kg`:'')):'按自己的节奏记录。');kids(advice)[2]?.remove();}
  const detail=sections[1];if(detail){detail.toggleAttribute('hidden',!readings.length&&!activeEntries(s).some(e=>e.kind==='waist'));const rows=Array.from(detail.querySelectorAll('button'));if(rows[0]){text(rows[0],s.derived['bw.slope7d']?.value!=null?'趋势的计算方式 ƒ':'趋势待计算');if(s.derived['bw.slope7d']?.value!=null){rows[0].dataset.derivedKey='bw.slope7d';enable(rows[0]);}else rows[0].disabled=true;}if(rows[1]){text(rows[1],`${readings.filter(p=>p.condition==='post_bm').length} 次排便后称重`);rows[1].disabled=true;}if(rows[2]){text(rows[2],`${activeEntries(s).filter(e=>e.kind==='waist').length} 次腰围记录`);rows[2].disabled=true;}}
}
function bindProgress(root:HTMLElement,c:HandoffContext){
  const s=c.state,main=one(root,'main');if(!main)return;
  const recorded=activeEntries(s).filter((entry):entry is SetEntry=>entry.kind==='set').sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||a.exerciseId.localeCompare(b.exerciseId));
  const ids=[...new Set([...s.program.days.flatMap(day=>day.items.map(item=>item.exerciseId)),...recorded.map(entry=>entry.exerciseId)])].filter(id=>s.derived[`e1rm.latest.${id}`]?.value!=null);
  const milestone=ids.find(id=>s.derived[`e1rm.first.${id}`]?.value!=null&&s.derived[`e1rm.latest.${id}`].value!>s.derived[`e1rm.first.${id}`].value!);
  setHeading(one(root,'[data-bind="progress-title"]'),milestone?`${exName(s,milestone)}，`:'训练进步，',milestone?'比初次记录更进一步。':ids.length?'每一组，都留下足迹。':'从完成一组开始。');
  const intro=main.children[1];if(intro){text(kids(intro)[0],ids.length?'来自已确认的训练组。估算只用于同动作、同器械比较。':'记录训练后，在这里回看变化。');kids(intro)[1]?.remove();}
  const chart=one<SVGSVGElement>(root,'[data-bind="progress-chart"]');if(chart){
    chart.parentElement!.hidden=!ids.length;
    const templates=Array.from(chart.children).slice(0,5),axis=chart.querySelector('line')?.cloneNode(true) as SVGLineElement|undefined,axisLabel=chart.lastElementChild?.cloneNode(true) as SVGTextElement|undefined;
    chart.replaceChildren();const hasRatios=ids.some(id=>s.derived[`rel.${id}`]?.value!=null);
    const height=ids.length*62+(hasRatios?20:0);chart.setAttribute('height',String(height));chart.setAttribute('viewBox',`0 0 350 ${height}`);
    for(const [index,id] of ids.entries()){
      const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.dataset.rowKey=id;group.dataset.exerciseId=id;group.dataset.derivedKey=`e1rm.latest.${id}`;group.setAttribute('role','button');group.setAttribute('tabindex','0');group.style.transformBox='fill-box';group.style.transformOrigin='center';group.setAttribute('aria-label',`${exName(s,id)}估算依据`);
      const hit=document.createElementNS('http://www.w3.org/2000/svg','rect');
      for(const [name,value] of Object.entries({x:'0',y:String(index*62),width:'350',height:'56',fill:'transparent'}))hit.setAttribute(name,value);
      group.append(hit);
      const nodes=templates.map(node=>node.cloneNode(true) as SVGElement);
      for(const node of nodes){node.setAttribute('y',String(Number(node.getAttribute('y'))+index*62));group.append(node);}
      const estimate=s.derived[`e1rm.latest.${id}`],ratio=s.derived[`rel.${id}`];
      text(nodes[0],exName(s,id));text(nodes[1],`估算 e1RM ${fmt(estimate.value)} ${estimate.unit??''} · 查看依据`);text(nodes[2],ratio?.value==null?'':`${fmt(ratio.value,2)}×`);
      nodes[3].setAttribute('visibility',ratio?.value==null?'hidden':'visible');nodes[4].setAttribute('width',String(ratio?.value==null?0:Math.min(350,ratio.value/1.5*350)));
      chart.append(group);
    }
    if(hasRatios&&axis&&axisLabel){axis.setAttribute('y2',String(ids.length*62-4));axisLabel.setAttribute('y',String(height-6));chart.append(axis,axisLabel);}
    chart.setAttribute('role','group');chart.setAttribute('aria-label','实际训练动作的估算负荷；比例为估算负荷与体重之比，仅用于同动作比较');
  }
  const groups=main.querySelectorAll('section')[1];if(groups){const header=groups.firstElementChild;if(header){text(kids(header)[0],'本周训练部位');text(kids(header)[1],'本周已做 / 计划 · 按肌群权重计');}const holder=groups.querySelector<HTMLElement>('div[style*="flex-wrap"]'),template=holder?.firstElementChild?.cloneNode(true) as HTMLElement|undefined;
    const muscles=Muscle.options.filter(id=>(s.derived[`volume.${id}`]?.value??0)>0||(s.derived[`volume.planned.${id}`]?.value??0)>0||(s.derived[`volume.unknown.${id}`]?.value??0)>0);
    if(holder&&template){holder.replaceChildren();for(const id of muscles){const chip=template.cloneNode(true) as HTMLElement;chip.dataset.rowKey=id;legendText(chip,`${MUSCLE_LABEL[id]} · ${fmt(s.derived[`volume.${id}`]?.value??0,1)}/${fmt(s.derived[`volume.planned.${id}`]?.value??0,1)} 组${s.derived[`volume.unknown.${id}`]?.value?` · ${fmt(s.derived[`volume.unknown.${id}`].value,1)} 待分类`:''}`);holder.append(chip);}if(!muscles.length)holder.textContent='记录训练后，这里显示实际训练部位。';}
    for(const button of groups.querySelectorAll<HTMLButtonElement>('button')){const key=muscles.length?`volume.${muscles[0]}`:null;if(key){button.dataset.derivedKey=key;enable(button);}else button.disabled=true;}for(const node of Array.from(groups.querySelectorAll<HTMLElement>('*'))){if(!node.children.length&&node.textContent?.includes('待接入'))text(node,'来自本人训练记录');}}
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
  const effective=new Map(activeEntries(s).map(entry=>[entry.id,entry]));
  const entries=s.entries.filter(e=>e.kind!=='revert').map(entry=>effective.get(entry.id)??entry).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  let shown=0,lastDate='';
  for(const entry of entries){const source=entry.source.actor;if(c.filter!=='all'&&source!==(c.filter==='you'?'user':c.filter))continue;
    if(entry.date!==lastDate&&templates.date){const header=templates.date.cloneNode(true) as HTMLElement;header.dataset.rowKey=`date:${entry.date}`;text(header.lastElementChild,`${dateLabel(entry.date)} · ${['周日','周一','周二','周三','周四','周五','周六'][weekday(entry.date)]}`);timeline.append(header);lastDate=entry.date;}
    const template=reverted.has(entry.id)?templates.reverted:templates[source];if(!template)continue;
    const row=template.cloneNode(true) as HTMLElement,body=row.children[1];text(body.children[0],entryLabel(s,entry));text(body.children[1],reverted.has(entry.id)?`已撤销 · ${reversals.find(e=>e.targetId===entry.id)?.reason??''}`:source==='model'?`来自 ${entry.source.client?clientName(s,entry.source.client):'AI'} · 用户已确认`:source==='rule'?`由规则 ${entry.source.client??''} 执行`:entry.source.rawText?`你输入「${entry.source.rawText}」`:'你在应用中记录');
    row.dataset.entryId=entry.id;row.classList.add('record-card');if(!reverted.has(entry.id)){const button=document.createElement('button');button.type='button';button.textContent='撤销';button.dataset.action='entry-revert';button.setAttribute('style','align-self:flex-start;min-height:44px;padding:0 12px;border:0;background:transparent;color:#9E4536;font:inherit;font-size:13px');body.append(button);if(entry.kind==='set'){const classify=button.cloneNode(true) as HTMLButtonElement;classify.textContent=`组别：${entry.setRole==='work'?'正式组':entry.setRole==='warmup'?'热身组':'未分类'}`;classify.dataset.action='set-classify';classify.dataset.id=entry.id;classify.dataset.role=entry.setRole==='work'?'warmup':entry.setRole==='warmup'?'unknown':'work';body.append(classify);}}timeline.append(row);shown++;
  }
  for(const sub of s.submissions){const template=templates.model;if(!template)continue;const row=template.cloneNode(true) as HTMLElement;const body=row.children[1];text(body.children[0],`待确认 · ${sub.drafts.length} 条记录`);text(body.children[1],`来自 ${clientName(s,sub.clientId)} · ${sub.rawText.slice(0,60)}`);row.dataset.rowKey=`submission:${sub.id}`;row.dataset.action='view-submission';row.dataset.id=sub.id;timeline.append(row);shown++;}
  for(const held of s.held){const template=templates.rule;if(!template)continue;const row=template.cloneNode(true) as HTMLElement,body=row.children[1];row.dataset.rowKey=`held:${held.id}`;text(body.children[0],held.question);text(body.children[1],held.deferUntilSessionEnd&&openSession(s.entries)?'训练结束后确认':'等待你确认');if(!held.deferUntilSessionEnd||!openSession(s.entries)){row.dataset.action='view-submission';row.dataset.id=held.id;}else row.setAttribute('aria-disabled','true');timeline.append(row);shown++;}
  for(const [kind,items] of [['proposal',s.proposals.filter(p=>p.status==='open')],['trigger',s.triggers.filter(t=>t.status==='will_fire'||t.status==='pending')]] as const)for(const item of items){const row=templates.rule?.cloneNode(true) as HTMLElement|undefined;if(!row)continue;row.dataset.rowKey=`${kind}:${item.id}`;row.dataset.action='decision-view';row.dataset.kind=kind;row.dataset.id=item.id;row.setAttribute('role','button');row.tabIndex=0;text(row.children[1].children[0],'title' in item?item.title:'饮食调整建议');text(row.children[1].children[1],item.snoozedUntil?`已延期至 ${item.snoozedUntil}`:'查看修改前后，再决定');timeline.append(row);shown++;}
  if(!shown){const row=templates.user?.cloneNode(true) as HTMLElement|undefined;if(row){text(row.children[1].children[0],'还没有记录');text(row.children[1].children[1],'记下的体重和训练，会按时间留在这里。');timeline.append(row);}}
}
function bindConnect(root:HTMLElement,c:HandoffContext){
  const s=c.state;setHeading(one(root,'h1'),'你的连接，','由你掌握。');
  const content=root.firstElementChild!.children[1],sections=kids(content);
  // Reuse the original account list; architecture, tool names and endpoint are
  // developer documentation and do not belong in the customer interface.
  const accounts=sections[2];sections[1].remove();sections[3].remove();sections[4].remove();
  text(accounts.firstElementChild,'授权管理');const settings=document.createElement('button');settings.textContent='我的账户';settings.dataset.action='account-settings';settings.className='account-button';
  const parent=accounts.children[1],template=parent.children[0];parent.replaceChildren();accounts.append(settings);
  const permissions:Record<string,string>={read:'读取状态与记录',submit:'提交待审记录',propose:'提出计划调整'};
  for(const [index,client] of (s.clients.length?s.clients:[null]).entries()){
    const row=template.cloneNode(true) as HTMLElement,left=kids(row)[0],status=kids(row)[1],dot=one<HTMLElement>(status,'span');
    row.dataset.rowKey=client?.id??'empty-client';row.classList.add('connection-row');row.style.borderTop=index?'1px solid #EDEDEB':'none';
    text(kids(left)[0],client?.name??'尚未连接');
    text(kids(left)[1],client?`${client.status==='active'?'已授权':'授权已撤销'} · ${client.scopes.map(scope=>permissions[scope]).filter(Boolean).join('、')}${client.lastUsedAt?` · 最近使用 ${new Intl.DateTimeFormat('zh-CN',{timeZone:s.timezone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(client.lastUsedAt))}`:''}`:'连接功能准备中。你仍可以记录和查看训练。');
    if(status.lastChild?.nodeType===Node.TEXT_NODE)status.lastChild.textContent=client?.status==='active'?'撤销授权':client?'已撤销':'';
    if(client?.status!=='active'){status.style.color='#6C6C71';if(dot)dot.style.background='#A1A1A5';}
    if(client?.status==='active'){row.dataset.action='client-revoke';row.dataset.id=client.id;row.setAttribute('role','button');row.tabIndex=0;row.setAttribute('aria-label',`撤销 ${client.name} 的授权`);}
    parent.append(row);
  }
}
function bindTransition(root:HTMLElement,c:HandoffContext){
  const session=openSession(c.state.entries),day=c.state.program.days.find(d=>d.id===session?.dayId),id=day?.items[0]?.exerciseId,load=id?c.state.derived[`next.${id}`]?.value:null;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.textContent?.trim()==='—'&&load!=null)node.textContent=String(load);}
  for(const node of Array.from(root.querySelectorAll<HTMLElement>('*'))){if(!node.children.length&&node.textContent?.includes('训练流程待接入'))text(node,'尚未开始训练');}
}
function bindDebrief(root:HTMLElement,c:HandoffContext){
  const s=c.state,page=root.firstElementChild as HTMLElement,session=sessions(s.entries).filter(session=>session.endedAt).sort((a,b)=>a.endedAt!.localeCompare(b.endedAt!)).at(-1);if(!session){
    const [intro,hero,best]=kids(page);text(kids(intro)[0],'尚未完成训练');text(kids(intro)[1],'训练总结');text(kids(hero)[0],'本次训练');text(kids(kids(hero)[1])[0],'—');text(kids(kids(hero)[1])[1],'');text(kids(hero)[2],'完成训练后显示结果');kids(hero)[3]?.remove();for(const row of kids(best).slice(1))row.remove();one(page,'a[href="#Capture"]')?.remove();text(page.lastElementChild,'返回今日');
    return;
  }
  const [intro,hero,best]=kids(page);text(kids(intro)[0],`${dateLabel(session.date)} · ${s.program.days.find(d=>d.id===session.dayId)?.name??'训练'}`);text(kids(intro)[1],'本次已记录');
  const byExercise=new Map<string,SetEntry[]>();for(const set of session.sets)(byExercise.get(set.exerciseId)??byExercise.set(set.exerciseId,[]).get(set.exerciseId)!).push(set);
  const first=[...byExercise.keys()][0],value=first?s.derived[`session.e1rm.${session.id}.${first}`]:null;
  text(kids(hero)[0],first?`${exName(s,first)} 估算 e1RM ƒ`:'本次训练');text(kids(kids(hero)[1])[0],value?.value==null?'—':fmt(value.value,1));text(kids(kids(hero)[1])[1],value?.unit??'');text(kids(hero)[2],`${byExercise.size} 个动作 · ${session.sets.length} 组`);
  const badge=kids(hero)[3];if(badge){const pr=first?s.derived[`session.pr.${session.id}.${first}`]:null;if(pr?.value===1){legendText(kids(badge)[0],'新纪录');text(kids(badge)[1],'同动作估算');}else if(value&&pr?.value==null){legendText(kids(badge)[0],'起点已记录');text(kids(badge)[1],'从这里开始');}else badge.remove();}
  const source=prototypeScreen('Debrief'),template=source.querySelector('div[style*="margin-top: 44px"]')?.children[1];for(const row of kids(best).slice(1))row.remove();
  if(template&&byExercise.size)for(const [id,sets] of byExercise){const row=template.cloneNode(true) as HTMLElement,bestSet=sets.find(set=>s.derived[`session.e1rm.${session.id}.${id}`]?.inputs.includes(set.id))??sets.at(-1)!;text(kids(row)[0],exName(s,id));text(kids(row)[1],`${bestSet.load} ${bestSet.unit} × ${bestSet.reps}`);best.append(row);}
  else if(template){const row=template.cloneNode(true) as HTMLElement;text(kids(row)[0],'没有完成的组');text(kids(row)[1],'—');best.append(row);}
  const held=s.held.filter(h=>h.deferUntilSessionEnd);let question=one<HTMLAnchorElement>(page,'a[href="#Capture"]');
  if(held.length||s.submissions.length){if(!question){const source=prototypeScreen('Debrief'),template=one<HTMLAnchorElement>(source,'a[href="#Capture"]');if(template){question=template.cloneNode(true) as HTMLAnchorElement;page.insertBefore(question,page.lastElementChild?.previousElementSibling??null);}}
    if(question){text(one(question,'span'),`需要确认 · ${held.length+s.submissions.length}`);text(one(question,'span:nth-child(2)'),held[0]?.question??'模型提案待确认');}}
  else question?.remove();text(page.lastElementChild,'返回今日');
  const formula=one<HTMLButtonElement>(hero,'button[aria-label="计算方式"]');if(formula&&first){formula.dataset.derivedKey=`session.e1rm.${session.id}.${first}`;enable(formula);}
}
export function bindHandoff(root:HTMLElement,context:HandoffContext){
  switch(context.screen){case 'Main':bindMain(root,context);break;case 'Capture':bindCapture(root,context);break;case 'Session':bindSession(root,context);break;case 'Body':bindBody(root,context);break;case 'Progress':bindProgress(root,context);break;case 'Ledger':bindLedger(root,context);break;case 'Connect':bindConnect(root,context);break;case 'Transition':bindTransition(root,context);break;case 'Debrief':bindDebrief(root,context);break;case 'Icon':break;}
}
