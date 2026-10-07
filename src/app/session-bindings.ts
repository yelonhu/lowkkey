import {DEFAULT_EQUIPMENT,type Exercise} from '@lowkkey/protocol';
import {convert,openSession,plates} from '@lowkkey/core';
import type {HandoffContext} from './handoff-bindings.ts';
import {trainingItems} from './training-state.ts';

const part=(root:HTMLElement,name:string)=>root.querySelector<HTMLElement>(`[data-session-part="${name}"]`)!;
const fmt=(n:number)=>String(Number(n.toFixed(2)));
const button=(label:string,action:string,key:string)=>{
  const node=document.createElement('button');node.type='button';node.textContent=label;node.dataset.action=action;node.dataset.nodeKey=key;return node;
};
const plateLabel=(values:number[])=>[...new Set(values)].map(value=>{const n=values.filter(p=>p===value).length;return n>1?`${value} × ${n}`:String(value);}).join(' + ')||'空杆';

function bindBarbell(center:HTMLElement,note:HTMLElement,ex:Exercise,load:number|null,unit:'kg'|'lb',c:HandoffContext){
  const equipment=c.equipment??c.state.equipment??DEFAULT_EQUIPMENT,physical=equipment.activeBarbellUnit,profile=equipment[physical];
  const svg=center.querySelector<SVGSVGElement>('svg[role="img"]')!;
  if(ex.type!=='barbell'){
    svg.remove();note.textContent=ex.perHand?'单只哑铃重量':ex.type==='assisted'?'辅助配重':ex.type==='bodyweight'?'附加重量':'器械读数';return;
  }
  center.prepend(svg);svg.dataset.nodeKey='session-barbell';
  note.dataset.action='equipment-open';note.setAttribute('role','button');note.tabIndex=0;note.setAttribute('aria-label','杠铃与配片设置');
  const info=load==null?null:plates(convert(load,unit,physical),physical,profile.barLoad,profile.plateLoads);
  note.textContent=info?`${physical} 杠铃 · 每侧 ${plateLabel(info.perSide)}${info.remainder<0?' · 低于空杆':info.remainder?` · 尚差 ${info.remainder} ${physical}，无法精确配出`:''} ›`:`${physical} 杠铃 · 配片设置 ›`;
  const originals=[...svg.querySelectorAll('rect')].slice(-4),[large,small]=originals;originals.forEach(rect=>rect.remove());
  svg.setAttribute('aria-label',info?`每侧 ${plateLabel(info.perSide)}，空杆 ${info.bar} ${physical}`:'杠铃示意，输入重量后显示配片');
  if(!info)return;
  let offset=0;
  for(const [index,value] of info.perSide.slice(0,8).entries()){
    const template=index===0?large:small,width=Math.min(Number(template.getAttribute('width')),60/Math.max(1,Math.min(8,info.perSide.length))-2);
    for(const side of ['left','right']){
      const plate=template.cloneNode(true) as SVGRectElement;plate.setAttribute('width',String(width));plate.setAttribute('x',String(side==='left'?83-offset-width:243+offset));plate.dataset.nodeKey=`plate:${side}:${index}:${value}`;plate.classList.add('session-plate');svg.append(plate);
    }
    offset+=width+2;
  }
}

export function bindSession(root:HTMLElement,c:HandoffContext){
  const s=c.state,session=openSession(s.entries),items=trainingItems(s,session,c.exerciseId),item=items.find(i=>i.exerciseId===c.exerciseId)??items[0],ex=s.exercises.find(ex=>ex.id===item?.exerciseId);
  const header=part(root,'header'),name=part(root,'name'),title=part(root,'title'),count=part(root,'count'),center=part(root,'center'),controls=part(root,'controls'),weight=part(root,'weight'),note=part(root,'plates'),previous=part(root,'previous'),complete=part(root,'submit') as HTMLButtonElement;
  header.dataset.sessionHeader='';part(root,'progress').remove();part(root,'caption').remove();part(root,'range').remove();
  const end=header.querySelector<HTMLAnchorElement>('a[href="#Debrief"]')!;
  if(!session||!item||!ex){
    title.textContent=session?'选择一个动作':'记录训练';count.textContent='按实际完成记录';center.replaceChildren();controls.replaceChildren(complete);complete.textContent='选择动作';complete.dataset.action=session?'exercise-list':'free-session';
    if(session)end.dataset.action='end-session';else{end.removeAttribute('href');end.setAttribute('aria-disabled','true');}
    return;
  }
  end.dataset.action='end-session';title.textContent=`${ex.name} ›`;
  const role=c.setRole??'work',recorded=session.sets.filter(set=>set.exerciseId===item.exerciseId&&set.setRole===role).length;
  count.textContent=role==='warmup'?`热身 · 第 ${recorded+1} 组`:`第 ${recorded+1} 组${item.sets==null?'':` / ${item.sets}`}`;
  name.dataset.action='exercise-list';name.setAttribute('role','button');name.tabIndex=0;name.setAttribute('aria-label','动作清单');
  const reference=c.reference,unit=c.manualUnit??reference?.unit??ex.unit;
  const text=c.manualLoad??(reference?.load==null?'':fmt(convert(reference.load,reference.unit,unit)));
  const number=text.trim()&&text!=='invalid'?Number(text):NaN,load=Number.isFinite(number)&&number>=0&&number<=1000?number:null;

  weight.dataset.sessionWeight='';
  const label=document.createElement('label');label.htmlFor='session-load';label.className='session-load-label';label.textContent='重量';label.dataset.nodeKey='session-load-label';
  const input=document.createElement('input');input.id='session-load';input.type='number';input.min='0';input.max='1000';input.step='any';input.inputMode='decimal';input.value=text==='invalid'?'':text;input.placeholder='—';input.dataset.action='load-input';input.dataset.nodeKey='session-load';input.setAttribute('enterkeyhint','done');input.setAttribute('aria-label',reference?.load==null?'首次重量：输入本组重量':'本组重量');input.style.setProperty('--load-length',String(Math.max(3,text.length)));
  const unitButton=button(`${unit} ▾`,'load-unit','session-unit');unitButton.dataset.unitDefault=unit;unitButton.setAttribute('aria-label',`重量单位 ${unit}，点按切换`);
  const hint=document.createElement('label');hint.htmlFor=input.id;hint.dataset.nodeKey='load-hint';hint.className='session-load-hint';hint.textContent=text?'点按修改':'点按输入';
  weight.replaceChildren(label,input,unitButton,hint);
  const details=button('本组详情 ›','set-details','set-details');details.className='session-details';details.setAttribute('aria-label','本组详情与组别');
  previous.className='session-reference';previous.removeAttribute('style');previous.dataset.sessionReference='';
  previous.textContent=reference?.source==='session'?`沿用上组 ${reference.load} ${reference.unit} × ${reference.reps??'—'}`:reference?.source==='history'?`上次 ${reference.date?.slice(5).replace('-','月')}日 · ${reference.load} ${reference.unit} × ${reference.reps??'—'}`:reference?.source==='arrangement'?'来自已确认安排':reference?.source==='legacy_snapshot'?'来自本场快照，来源未标注':'';
  const arrangement=reference?.arrangement;
  if(arrangement&&load!=null&&Math.abs(convert(arrangement.load,arrangement.unit,unit)-load)>.01){
    const adopt=button(`安排 ${arrangement.load} ${arrangement.unit} · 采用`,'adopt-load','adopt-load');adopt.className='session-adopt';center.append(adopt);
  }
  bindBarbell(center,note,ex,load,unit,c);
  // Existing handoff SVG and controls, rearranged into stable semantic groups.
  center.insertBefore(note,weight);
  const referenceRow=document.createElement('div');referenceRow.className='session-reference-row';referenceRow.dataset.nodeKey='session-reference-row';referenceRow.append(previous,details);center.append(referenceRow);
  const rir=part(root,'rir'),rirLabel=rir.firstElementChild!;
  const help=button('余力 RIR · 选填 ⓘ','rir-help','rir-help');help.className='rir-help';help.setAttribute('aria-label','了解余力 RIR');rirLabel.replaceWith(help);
  const display=part(root,'repValue');
  const reps=document.createElement('input');reps.type='number';reps.inputMode='numeric';reps.min='1';reps.max='100';reps.step='1';reps.dataset.action='reps-input';reps.dataset.nodeKey='reps-input';reps.className='reps-input';reps.setAttribute('aria-label','本组次数');reps.placeholder='次数';reps.value=c.reps==null||!Number.isFinite(c.reps)?'':String(c.reps);reps.style.cssText=display.style.cssText;display.replaceWith(reps);
  controls.querySelector<HTMLElement>('[aria-label="减一次"]')!.dataset.action='reps-minus';controls.querySelector<HTMLElement>('[aria-label="加一次"]')!.dataset.action='reps-plus';
  for(const radio of controls.querySelectorAll<HTMLButtonElement>('[role="radio"]')){const value=radio.textContent==='3+'?3:Number(radio.textContent);radio.dataset.action='rir';radio.dataset.value=String(value);radio.setAttribute('aria-checked',String(c.rir===value));}
  const validReps=c.reps!=null&&Number.isInteger(c.reps)&&c.reps>=1&&c.reps<=100,ready=load!=null&&validReps;
  const reason=load!=null&&!validReps?'请填写 1–100 的整数次数':text?'请填写 0–1000 的有效重量':'填写重量后完成本组';
  complete.textContent=ready?`记录 ${load} ${unit} × ${c.reps}`:reason;complete.title=ready?'按显示的重量、单位和次数保存本组':reason;complete.disabled=!ready;
  if(ready){complete.dataset.action='complete-set';complete.dataset.exerciseId=ex.id;complete.dataset.load=String(load);complete.dataset.unit=unit;}
  const awaiting=s.held.some(held=>held.drafts.some(d=>d.kind==='set'&&d.sessionId===session.id&&d.exerciseId===ex.id&&d.setIndex===session.sets.filter(set=>set.exerciseId===ex.id).length+1));
  if(awaiting){complete.disabled=true;complete.removeAttribute('data-action');complete.textContent='本组待核对，训练后确认';}
  const planned=session.prescription?.find(rx=>rx.exerciseId===ex.id)?.sets??item.sets;
  if(role==='work'&&planned!=null&&recorded>=planned&&!c.allowExtra){
    count.textContent=`已记录 ${recorded} 组 · 安排 ${planned} 组`;
    const remaining=items.find(candidate=>candidate.exerciseId!==ex.id&&session.sets.filter(set=>set.exerciseId===candidate.exerciseId&&set.setRole==='work').length<(candidate.sets??Infinity));
    for(const key of ['exerciseId','load','unit'])delete complete.dataset[key];
    complete.textContent=remaining?`下一个动作：${s.exercises.find(ex=>ex.id===remaining.exerciseId)?.name??remaining.exerciseId}`:'结束本次训练';complete.dataset.action=remaining?'next-exercise':'end-session';complete.disabled=false;if(remaining)complete.dataset.id=remaining.exerciseId;
    const extra=button('再记一组','extra-set','extra-set');extra.className='extra-set-button';controls.insertBefore(extra,complete);
  }
}
