import { PROGRAM_TEMPLATES } from '@lowkkey/protocol';
import type { V1State } from '../server/v1-store.ts';

export type SheetState =
  | { kind:'program'; templateId:string|null }
  | { kind:'day'; selectedDayId:string|null }
  | { kind:'add'; exerciseId:string; selectedDayId:string|null };

const days=['周日','周一','周二','周三','周四','周五','周六'];
const text=(element:Element|undefined|null,value:string)=>{if(element)element.textContent=value;};

export function bindDecisionSheet(root:HTMLElement,state:V1State,sheet:SheetState){
  const dialog=root.querySelector<HTMLElement>('[role="dialog"]');
  if(!dialog)return;
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
      for(const item of PROGRAM_TEMPLATES)row(item.name,item.summary,'program-template',item.id);
      text(left,'取消');left.dataset.action='sheet-cancel';text(right,'');right.disabled=true;
    }else{
      text(title,selected.name);text(detail,`${selected.summary}。训练日如下；首次重量在训练中由你填写。`);
      for(const day of selected.program.days)row(day.name,`${day.weekday==null?'按需':days[day.weekday]} · ${day.items.length} 个动作`);
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
