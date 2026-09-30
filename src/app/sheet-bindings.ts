import {bindGoalSheet,type GoalDraft} from './goal-sheet.ts';
import { DEFAULT_RAMP, PROGRAM_TEMPLATES, Program as ProgramSchema } from '@lowkkey/protocol';
import { mergePatch } from '@lowkkey/core';
import type { Program } from '@lowkkey/protocol';
import type { V1State } from '../server/v1-store.ts';

export type SheetState =
  | { kind:'program'; templateId:string|null;cycle?:boolean }
  | {kind:'goal';draft:GoalDraft}
  | {kind:'decision';id:string;type:'proposal'|'trigger';revision:number}
  | { kind:'day'; selectedDayId:string|null }
  | { kind:'add'; exerciseId:string; selectedDayId:string|null };

const days=['周日','周一','周二','周三','周四','周五','周六'];
const text=(element:Element|undefined|null,value:string)=>{if(element)element.textContent=value;};

function describeProgram(program:Program,key:string,state:V1State):string {
  if(key==='days')return program.days.map(day=>`${day.name}（${day.weekday==null?'按需':days[day.weekday]}）：${day.items.map(item=>`${state.exercises.find(ex=>ex.id===item.exerciseId)?.name??item.exerciseId} ${item.sets} 组 × ${item.repMin}–${item.repMax} 次${item.startLoad==null?'':`，起始 ${item.startLoad} ${state.exercises.find(ex=>ex.id===item.exerciseId)?.unit??''}`}`).join('；')}`).join('\n')||'尚未安排';
  if(key==='cycleStart')return program.cycleStart??'不启用';
  if(key==='ramp')return program.ramp.map(week=>`第 ${week.week} 周 · ${week.label}：组数 × ${week.setMultiplier}，保留 ${week.targetRir} 次`).join('\n')||'按基础计划训练';
  if(key==='constraints')return program.constraints.map(c=>`${c.label}：每周最多 ${c.perWeek} 次`).join('；')||'未设置';
  const t=program.targets,goal=t.goal?.mode;
  return [goal?({gain:'增肌',lose:'减脂',maintain:'维持',record:'先只记录'}[goal]):'未设置目标',t.bodyweightKg==null?null:`目标体重 ${t.bodyweightKg} kg`,t.goal?.maintenanceKg?`维持 ${t.goal.maintenanceKg.min}–${t.goal.maintenanceKg.max} kg`:null,t.rateKgPerWeek?`每周变化 ${t.rateKgPerWeek.min}–${t.rateKgPerWeek.max} kg`:null,t.weeklySets?`每周参考 ${t.weeklySets.min}–${t.weeklySets.max} 组`:null,t.calorieTrigger?`观察 ${t.calorieTrigger.everyDays} 天，变化${t.calorieTrigger.comparison==='below'?'低于':'高于'} ${t.calorieTrigger.thresholdKgPerWeek} kg/周时，提出每天 ${t.calorieTrigger.kcalDelta>0?'+':''}${t.calorieTrigger.kcalDelta} kcal 的待审建议`:null].filter(Boolean).join('；');
}

export function bindDecisionSheet(root:HTMLElement,state:V1State,sheet:SheetState){
  const dialog=root.querySelector<HTMLElement>('[role="dialog"]');
  if(!dialog)return;
  if(sheet.kind==='goal'){bindGoalSheet(dialog,sheet.draft);return;}
  if(sheet.kind==='decision'){
    dialog.setAttribute('aria-label','查看建议');const [,header,title,detail,options,footer]=Array.from(dialog.children) as HTMLElement[];
    const proposal=sheet.type==='proposal'?state.proposals.find(p=>p.id===sheet.id):null,trigger=sheet.type==='trigger'?state.triggers.find(t=>t.id===sheet.id):null;
    header.textContent='由你决定';title.textContent=proposal?.title??'调整每日饮食';detail.textContent=proposal?.rationale??(trigger?`从 ${trigger.dueDate>state.today?trigger.dueDate:state.today} 起，每天调整 ${trigger.action.kcal} kcal。只有采用才生效。`:'建议已处理');
    const template=options.querySelector('button')!.cloneNode(true) as HTMLButtonElement;options.replaceChildren();
    const parsed=proposal?.kind==='program_change'?ProgramSchema.safeParse(mergePatch(state.program,proposal.patch)):null;
    if(proposal&&parsed?.success){const after=parsed.data;for(const key of Object.keys(proposal.patch)){const row=template.cloneNode(true) as HTMLButtonElement;row.disabled=true;row.style.whiteSpace='pre-wrap';row.style.overflowWrap='anywhere';row.children[0].textContent=({days:'训练日与动作',targets:'体征目标',cycleStart:'周期起点',ramp:'周期安排',constraints:'训练约束'} as Record<string,string>)[key]??'说明';row.children[1].textContent=`当前：${describeProgram(state.program,key,state)}\n采用后：${describeProgram(after,key,state)}`;options.append(row);}detail.textContent+=' 采用后立即更新计划，已有记录保留。';}
    if(trigger){const delta=`${trigger.action.kcal>=0?'增加':'减少'} ${Math.abs(trigger.action.kcal)} kcal`;title.textContent=`每天${delta}`;detail.textContent=`体重变化 ${trigger.current==null?'尚待观察':`${trigger.current.toFixed(2)} kg/周`}，达到你设置的阈值 ${trigger.threshold} kg/周。采用后从 ${trigger.dueDate>state.today?trigger.dueDate:state.today} 生效。`;const row=template.cloneNode(true) as HTMLButtonElement;row.disabled=true;row.style.whiteSpace='normal';row.children[0].textContent='修改前后';row.children[1].textContent=`当前摄入 → 每天${delta}。未记录总热量，不推算摄入总量。`;options.append(row);}
    const [yes,later]=Array.from(footer.children) as HTMLElement[];yes.textContent='采用';yes.removeAttribute('href');later.textContent='以后';for(const [button,action] of [[yes,'accept'],[later,'later']] as const){button.dataset.action=`decision-${action}`;button.dataset.id=sheet.id;}
    if(parsed&&!parsed.success){yes.setAttribute('aria-disabled','true');yes.tabIndex=-1;detail.textContent='计划已变化，这条建议无法完整应用。请让客户端重新提交。';}
    if(trigger&&trigger.status!=='will_fire'){yes.setAttribute('aria-disabled','true');yes.tabIndex=-1;detail.textContent='当前尚未达到你设置的观察条件。继续记录，达到条件后再决定。';}
    return;
  }
  dialog.setAttribute('aria-label',sheet.kind==='program'?'选择训练模板':sheet.kind==='day'?'选择训练日':'加入训练计划');
  const header=dialog.children[1],title=dialog.children[2],detail=dialog.children[3],options=dialog.children[4],footer=dialog.children[5];
  text(header.children[0],sheet.kind==='program'?'训练计划':'训练日');
  const status=header.children[1],statusIcon=status.firstElementChild;
  if(statusIcon)status.replaceChildren(statusIcon,document.createTextNode(sheet.kind==='program'?'由你确认后保存':'每周安排保持原样'));
  else text(status,sheet.kind==='program'?'由你确认后保存':'每周安排保持原样');
  const template=options.querySelector('button')?.cloneNode(true) as HTMLButtonElement|undefined;
  options.replaceChildren();
  const row=(label:string,hint:string,action?:string,id?:string,selected=false)=>{
    if(!template)return;
    const button=template.cloneNode(true) as HTMLButtonElement;
    text(button.children[0],label);text(button.children[1],hint);
    button.dataset.rowKey=id??label;
    if(action){button.dataset.action=action;button.dataset.id=id;button.setAttribute('aria-pressed',String(selected));if(selected)button.style.borderColor='#141415';}
    else button.disabled=true;
    options.append(button);
  };
  const left=footer.children[0] as HTMLAnchorElement,right=footer.children[1] as HTMLButtonElement;
  left.removeAttribute('href');right.removeAttribute('aria-disabled');right.disabled=false;
  if(sheet.kind==='program'){
    const selected=PROGRAM_TEMPLATES.find(item=>item.id===sheet.templateId);
    if(!selected){
      text(title,'选择训练模板');text(detail,'先看训练日与动作，再由你确认保存。');
      for(const item of PROGRAM_TEMPLATES)row(item.name,`每周 ${item.program.days.filter(day=>day.weekday!==null).length} 练`,'program-template',item.id);
      text(left,'取消');left.dataset.action='sheet-cancel';text(right,'');right.disabled=true;
    }else{
      text(title,selected.name);text(detail,`每周 ${selected.program.days.filter(day=>day.weekday!==null).length} 练。首次重量在训练时填写。`);
      for(const day of selected.program.days)row(day.name,`${day.weekday==null?'按需':days[day.weekday]} · ${day.items.length} 个动作`);
      row('八周周期',sheet.cycle?'已启用 · 查看下方安排':'不启用，按基础计划训练','program-cycle','cycle');if(sheet.cycle)for(const week of DEFAULT_RAMP)row(`第 ${week.week} 周 · ${week.label}`,`组数 × ${week.setMultiplier} · 保留 ${week.targetRir} 次`);
      text(left,'确认并保存');left.dataset.action='program-save';text(right,'返回模板');right.dataset.action='program-back';
    }
    return;
  }
  const exercise=sheet.kind==='add'?state.exercises.find(item=>item.id===sheet.exerciseId):null;
  text(title,sheet.kind==='add'?`将${exercise?.name??sheet.exerciseId}加入哪天？`:'选择本次训练日');
  text(detail,sheet.kind==='add'?'只修改你确认的训练日。':'可从计划中选任一天开始本次训练；每周安排不变。');
  for(const day of state.program.days)row(day.name,`${day.weekday==null?'按需':days[day.weekday]} · ${day.items.length} 个动作`,'sheet-day',day.id,day.id===sheet.selectedDayId);
  if(!state.program.days.length)text(detail,'尚无训练计划。请先选择模板。');
  text(left,sheet.kind==='add'?'确认加入':'开始训练');left.dataset.action=sheet.kind==='add'?'progress-confirm-add':'day-start';
  if(!sheet.selectedDayId){left.setAttribute('aria-disabled','true');left.tabIndex=-1;}else{left.removeAttribute('aria-disabled');left.tabIndex=0;}
  text(right,'取消');right.dataset.action='sheet-cancel';
}
