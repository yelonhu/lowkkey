import { Program as ProgramSchema } from '@lowkkey/protocol';
import { mergePatch, openSession } from '@lowkkey/core';
import type { Program } from '@lowkkey/protocol';
import type { V1State } from '../server/v1-store.ts';

export type SheetState =
  | { kind:'program'; showCycle?:boolean }
  | { kind:'decision';id:string;type:'proposal'|'trigger';revision:number }
  | { kind:'day';selectedDayId:string|null }
  | { kind:'exercises';exerciseId:string|null };

const days=['周日','周一','周二','周三','周四','周五','周六'];
const text=(element:Element|undefined|null,value:string)=>{if(element)element.textContent=value;};
export function clientName(state:V1State,id:string){return state.clients.find(client=>client.id===id)?.name??'AI 客户端';}

function describeProgram(program:Program,key:string):string {
  if(key==='cycleStart')return program.cycleStart??'不启用';
  if(key==='ramp')return program.ramp.map(week=>`第 ${week.week} 周 · ${week.label}：组数 × ${week.setMultiplier}，保留 ${week.targetRir} 次`).join('\n')||'按基础计划训练';
  if(key==='constraints')return program.constraints.map(c=>`${c.label}：每周最多 ${c.perWeek} 次`).join('；')||'未设置';
  const t=program.targets,goal=t.goal?.mode;
  return [goal?({gain:'增肌',lose:'减脂',maintain:'维持',record:'先只记录'}[goal]):'未设置目标',t.bodyweightKg==null?null:`目标体重 ${t.bodyweightKg} kg`,t.goal?.maintenanceKg?`维持 ${t.goal.maintenanceKg.min}–${t.goal.maintenanceKg.max} kg`:null,t.rateKgPerWeek?`每周变化 ${t.rateKgPerWeek.min}–${t.rateKgPerWeek.max} kg`:null,t.weeklySets?`每周参考 ${t.weeklySets.min}–${t.weeklySets.max} 组`:null,t.calorieTrigger?`观察 ${t.calorieTrigger.everyDays} 天，变化${t.calorieTrigger.comparison==='below'?'低于':'高于'} ${t.calorieTrigger.thresholdKgPerWeek} kg/周时，提出每天 ${t.calorieTrigger.kcalDelta>0?'+':''}${t.calorieTrigger.kcalDelta} kcal 的待审建议`:null].filter(Boolean).join('；');
}

export function bindDecisionSheet(root:HTMLElement,state:V1State,sheet:SheetState){
  const dialog=root.querySelector<HTMLElement>('[role="dialog"]');if(!dialog)return;
  const [,header,title,detail,options,footer]=Array.from(dialog.children) as HTMLElement[];
  const heading=(label:string,status:string)=>{text(header.children[0],label);const value=header.children[1],icon=value.firstElementChild;value.replaceChildren(...(icon?[icon]:[]),document.createTextNode(status));};
  const template=options.querySelector('button')!.cloneNode(true) as HTMLButtonElement;options.replaceChildren();
  const row=(label:string,hint:string,key:string,action?:string,id?:string)=>{
    const element=action?template.cloneNode(true) as HTMLElement:document.createElement('div');
    if(!action){element.style.cssText=template.style.cssText;element.append(...Array.from(template.childNodes).map(node=>node.cloneNode(true)));}
    element.classList.add('plan-detail-row');element.dataset.rowKey=key;
    text(element.children[0],label);text(element.children[1],hint);
    if(action){element.dataset.action=action;if(id)element.dataset.id=id;}
    options.append(element);return element;
  };
  const proposedExercises=sheet.kind==='decision'&&sheet.type==='proposal'?state.proposals.find(p=>p.id===sheet.id)?.exercises??[]:[];
  const showDays=(program:Program,prefix:string)=>{
    if(!program.days.length)row(prefix,'没有训练安排',`${prefix}:empty`);
    for(const day of program.days){
      row(`${prefix}${prefix?' · ':''}${day.name}`,day.weekday==null?'按需训练':days[day.weekday],`${prefix}:${day.id}`);
      for(const [index,item] of day.items.entries()){
        const ex=[...state.exercises,...proposedExercises].find(ex=>ex.id===item.exerciseId);
        row(ex?.name??item.exerciseId,`${item.sets} 组 × ${item.repMin}–${item.repMax} 次${item.startLoad==null?'':` · 起始 ${item.startLoad} ${ex?.unit??''}`}${item.note?` · ${item.note}`:''}`,`${prefix}:${day.id}:${index}`);
      }
    }
  };
  const [left,right]=Array.from(footer.children) as [HTMLAnchorElement,HTMLButtonElement];left.removeAttribute('href');right.disabled=false;
  text(right,'关闭');right.dataset.action='sheet-cancel';
  if(sheet.kind==='decision'){
    dialog.setAttribute('aria-label','查看建议');
    const proposal=sheet.type==='proposal'?state.proposals.find(p=>p.id===sheet.id):null,trigger=sheet.type==='trigger'?state.triggers.find(t=>t.id===sheet.id):null;
    heading(proposal?`${proposal.author.actor==='model'?'AI 已提交':'已提交'}${proposal.author.client?` · ${clientName(state,proposal.author.client)}`:''}`:'由你决定','等待确认');
    title.textContent=proposal?.title??'调整每日饮食';detail.textContent=proposal?.rationale??'确认采用后才会生效。';
    const parsed=proposal?.kind==='program_change'?ProgramSchema.safeParse(mergePatch(state.program,proposal.patch)):null;
    if(proposal&&parsed?.success){
      for(const ex of proposedExercises)row(`新增动作 · ${ex.name}`,`${ex.type} · ${ex.unit}${ex.perHand?' · 单只重量':''}${ex.type==='assisted'?' · 辅助配重':''}`,'exercise:'+ex.id);
      if(proposal.baseProgram&&JSON.stringify(proposal.baseProgram)!==JSON.stringify(state.program))detail.textContent+=' 原计划已有更新，以下比较使用当前计划，请重新核对。';
      for(const key of Object.keys(proposal.patch)){
        if(key==='days'){
          const ids=[...new Set([...state.program.days,...parsed.data.days].map(day=>day.id))];
          const changed=ids.filter(id=>JSON.stringify(state.program.days.find(day=>day.id===id))!==JSON.stringify(parsed.data.days.find(day=>day.id===id)));
          if(!changed.length)row('训练安排','与当前计划一致','unchanged');
          for(const id of changed){showDays({...state.program,days:state.program.days.filter(day=>day.id===id)},'当前');showDays({...parsed.data,days:parsed.data.days.filter(day=>day.id===id)},'采用后');}
          continue;
        }
        row(({targets:'体征目标',cycleStart:'周期起点',ramp:'周期安排',constraints:'训练约束'} as Record<string,string>)[key]??'说明',`当前：${describeProgram(state.program,key)}\n采用后：${describeProgram(parsed.data,key)}`,key);
      }
      detail.textContent+=' 采用后立即更新计划，已有记录保留。';
    }
    if(trigger){const delta=`${trigger.action.kcal>=0?'增加':'减少'} ${Math.abs(trigger.action.kcal)} kcal`;title.textContent=`每天${delta}`;detail.textContent=`体重变化 ${trigger.current==null?'尚待观察':`${trigger.current.toFixed(2)} kg/周`}，达到你设置的阈值 ${trigger.threshold} kg/周。采用后从 ${trigger.dueDate>state.today?trigger.dueDate:state.today} 生效。`;row('修改前后',`当前摄入 → 每天${delta}。未记录总热量，不推算摄入总量。`,'trigger');}
    text(left,'采用');text(right,'以后');left.dataset.action='decision-accept';right.dataset.action='decision-later';left.dataset.id=right.dataset.id=sheet.id;
    const unavailable=(!proposal&&!trigger)||proposal&&proposal.status!=='open'||trigger&&trigger.status!=='will_fire'||parsed&&!parsed.success;
    if(unavailable){if(proposal&&proposal.status!=='open'){heading('处理结果',proposal.status==='accepted'?'已采用':'未采用');}left.setAttribute('aria-disabled','true');left.tabIndex=-1;detail.textContent=proposal?.status==='accepted'?'这项计划已由你确认。当前生效安排可在今日查看。':proposal?.status==='rejected'?'这项提案未采用，没有修改计划。':'这项建议当前无法采用，请查看最新状态，必要时在对话中重新提交。';right.textContent='关闭';right.dataset.action='sheet-cancel';}
    else if(sheet.revision!==state.revision){left.setAttribute('aria-disabled','true');left.tabIndex=-1;detail.textContent+=' 状态已变化，请核对更新后的内容，再重新确认。';right.textContent='已核对，重新确认';right.dataset.action='decision-refresh';}
    return;
  }
  if(sheet.kind==='program'){
    dialog.setAttribute('aria-label','完整训练计划');heading('训练安排','已保存');title.textContent='训练计划';
    detail.textContent=state.program.days.length?'训练日和动作来自当前已确认计划。':'计划确认后，会显示在这里。';showDays(state.program,'');
    if(state.program.targets.goal||state.program.targets.bodyweightKg!=null)row('已确认目标',describeProgram(state.program,'targets'),'targets');
    if(state.program.constraints.length)row('训练约束',describeProgram(state.program,'constraints'),'constraints');
    if(state.program.cycleStart&&state.program.ramp.length){
      const week=state.derived['cycle.week']?.value,phase=state.program.ramp.find(item=>item.week===week);
      row('周期安排',sheet.showCycle?'收起详情':'查看已确认的阶段安排','cycle','cycle-details');
      if(sheet.showCycle){row('当前阶段',phase?`第 ${phase.week} 周 · ${phase.label}`:'当前不在已安排的周期阶段内','phase');row(`开始于 ${state.program.cycleStart}`,describeProgram(state.program,'ramp'),'ramp');}
    }
    text(left,'知道了');left.dataset.action='sheet-cancel';right.remove();return;
  }
  const session=openSession(state.entries);
  if(sheet.kind==='exercises'){
    dialog.setAttribute('aria-label','动作清单');heading('本次训练','动作清单');title.textContent='选择动作';detail.textContent='查看已完成组数，选择要继续的动作。';
    for(const item of state.program.days.find(day=>day.id===session?.dayId)?.items??[]){
      const count=session?.sets.filter(set=>set.exerciseId===item.exerciseId&&set.setRole==='work').length??0,planned=session?.prescription?.find(rx=>rx.exerciseId===item.exerciseId)?.sets??item.sets;
      const button=row(state.exercises.find(ex=>ex.id===item.exerciseId)?.name??item.exerciseId,`正式组 ${count} / ${planned} · ${item.repMin}–${item.repMax} 次`,item.exerciseId,'select-exercise',item.exerciseId);
      button.setAttribute('aria-pressed',String(item.exerciseId===sheet.exerciseId));
    }
    text(left,'继续当前动作');left.dataset.action='sheet-cancel';return;
  }
  dialog.setAttribute('aria-label','选择训练日');heading('训练安排','已保存');title.textContent='选择本次训练日';detail.textContent='本次选择不会改变每周安排。';
  for(const day of state.program.days){const button=row(day.name,`${day.weekday==null?'按需':days[day.weekday]} · ${day.items.map(item=>state.exercises.find(ex=>ex.id===item.exerciseId)?.name??item.exerciseId).join('、')}`,day.id,'sheet-day',day.id);button.setAttribute('aria-pressed',String(day.id===sheet.selectedDayId));}
  text(left,'开始训练');left.dataset.action='day-start';
  if(!sheet.selectedDayId){left.setAttribute('aria-disabled','true');left.tabIndex=-1;}
}
