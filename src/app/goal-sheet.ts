import { Targets, type Program } from '@lowkkey/protocol';

export type GoalDraft={mode:'gain'|'lose'|'maintain'|'record';target:string;rateMin:string;rateMax:string;maintainMin:string;maintainMax:string;threshold:string;kcal:string;days:string;comparison:'above'|'below'};
export const goalNames={gain:'增肌',lose:'减脂',maintain:'维持',record:'先只记录'};
export function goalDraft(program:Program):GoalDraft{
  const t=program.targets;return {mode:t.goal?.mode??'record',target:t.bodyweightKg?.toString()??'',rateMin:t.rateKgPerWeek?.min.toString()??'',rateMax:t.rateKgPerWeek?.max.toString()??'',maintainMin:t.goal?.maintenanceKg?.min.toString()??'',maintainMax:t.goal?.maintenanceKg?.max.toString()??'',threshold:t.calorieTrigger?.thresholdKgPerWeek.toString()??'',kcal:t.calorieTrigger?.kcalDelta.toString()??'',days:t.calorieTrigger?.everyDays.toString()??'14',comparison:t.calorieTrigger?.comparison??'above'};
}
export function goalTargets(d:GoalDraft,program:Program):Program['targets']{
  const number=(value:string)=>value.trim()===''?null:Number(value),target=number(d.target);
  const range=(min:string,max:string)=>min.trim()===''&&max.trim()===''?null:{min:number(min)??NaN,max:number(max)??NaN};
  const rate=d.mode==='record'?null:range(d.rateMin,d.rateMax);
  if(rate&&(d.mode==='gain'&&rate.min<0||d.mode==='lose'&&rate.max>0))throw new Error('增肌速度用正数，减脂速度用负数。');
  const calorie=d.mode==='record'||d.kcal.trim()===''&&d.threshold.trim()===''?null:{thresholdKgPerWeek:number(d.threshold)??NaN,kcalDelta:number(d.kcal)??NaN,everyDays:Number(d.days),comparison:d.comparison};
  if(calorie&&(!rate||calorie.everyDays<14))throw new Error('先填写目标速度，观察周期至少 14 天。');
  return Targets.parse({...program.targets,bodyweightKg:d.mode==='record'||d.mode==='maintain'?null:target,rateKgPerWeek:rate,goal:{mode:d.mode,maintenanceKg:d.mode==='maintain'?range(d.maintainMin,d.maintainMax):null},calorieTrigger:calorie});
}
export function bindGoalSheet(dialog:HTMLElement,d:GoalDraft){
  dialog.setAttribute('aria-label','设置目标');
  const [,header,title,detail,options,footer]=Array.from(dialog.children) as HTMLElement[];
  header.children[0].textContent='你的目标';const status=header.children[1],icon=status.firstElementChild;if(icon)status.replaceChildren(icon,document.createTextNode('由你确认'));else status.textContent='由你确认';
  title.textContent='按你的目标记录。';detail.textContent='数值都可留空。体重变化不等于肌肉或脂肪变化；目标由你确认，不从模板自动套用。';
  const template=options.querySelector('button')!.cloneNode(true) as HTMLButtonElement;options.replaceChildren();
  for(const [mode,name] of Object.entries(goalNames)){const row=template.cloneNode(true) as HTMLButtonElement;row.dataset.rowKey=`goal:${mode}`;row.dataset.action='goal-mode';row.dataset.mode=mode;row.setAttribute('aria-pressed',String(d.mode===mode));row.children[0].textContent=name;row.children[1].textContent=d.mode===mode?'已选择':'';options.append(row);}
  const field=(key:keyof GoalDraft,label:string)=>{
    const source=template.cloneNode(true) as HTMLButtonElement,row=document.createElement('label');row.style.cssText=source.style.cssText;row.dataset.rowKey=`goal:${key}`;row.append(...source.childNodes);row.children[0].textContent=label;
    const input=document.createElement('input');input.type='number';input.step='any';input.inputMode=['rateMin','rateMax','kcal','threshold'].includes(key)?'text':'decimal';input.value=d[key];input.placeholder='暂不设置';input.dataset.goalField=key;input.setAttribute('aria-label',label);input.style.cssText='width:130px;text-align:right;border:0;background:transparent;color:inherit;font:inherit;min-height:44px';row.children[1].replaceWith(input);options.append(row);
  };
  if(d.mode!=='record'){
    if(d.mode==='maintain'){field('maintainMin','维持体重下限 kg');field('maintainMax','维持体重上限 kg');}else field('target','目标体重 kg');
    field('rateMin','每周变化下限 kg');field('rateMax','每周变化上限 kg');
    field('threshold','饮食建议触发速度 kg/周');field('kcal','每天热量调整 kcal');field('days','观察周期（天）');
    const comparison=template.cloneNode(true) as HTMLButtonElement;comparison.dataset.action='goal-comparison';comparison.children[0].textContent='触发方向';comparison.children[1].textContent=d.comparison==='above'?'高于阈值':'低于阈值';options.append(comparison);
    detail.textContent+=' 减脂速度填负数。饮食调整需同时设置目标速度、阈值、幅度与至少 14 天观察期；只生成待审建议。增肌参考研究见“依据”，并非个人处方。';
    const source=document.createElement('a');source.href='https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/';source.target='_blank';source.rel='noopener noreferrer';source.textContent='依据：增重研究';options.append(source);
    const loss=source.cloneNode(true) as HTMLAnchorElement;loss.href='https://pubmed.ncbi.nlm.nih.gov/21558571/';loss.textContent='依据：减重研究';options.append(loss);
  }
  const [save,cancel]=Array.from(footer.children) as HTMLElement[];save.textContent='保存目标';save.removeAttribute('href');save.dataset.action='goal-save';cancel.textContent='取消';cancel.dataset.action='sheet-cancel';
}
