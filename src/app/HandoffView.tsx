import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PROGRAM_TEMPLATES } from '@lowkkey/protocol';
import type { EntryDraft } from '@lowkkey/protocol';
import { openSession } from '@lowkkey/core';
import { capturedClock } from '../client/offline.ts';
import { bindHandoff, prepareHandoff } from './handoff-bindings.ts';
import { installPrototypeStyle, prototypeScreen } from './prototype-template.ts';
import type { Screen } from './navigation.ts';
import { navigate } from './navigation.ts';
import { bindDecisionSheet } from './sheet-bindings.ts';
import type { SheetState } from './sheet-bindings.ts';
import type { useHandoff } from './useHandoff.ts';

type Chamber=ReturnType<typeof useHandoff>;
export function HandoffView({screen,chamber}:{screen:Screen;chamber:Chamber}){
  const shell=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),draft=useRef('');
  const [filter,setFilter]=useState<'all'|'you'|'model'|'rule'>('all'),[answers,setAnswers]=useState<Record<string,string>>({}),[reps,setReps]=useState(8),[rir,setRir]=useState<number|null>(null),[exerciseId,setExerciseId]=useState<string|null>(null),[formula,setFormula]=useState<string|null>(null),[sheet,setSheet]=useState<SheetState|null>(null),[manualLoad,setManualLoad]=useState(''),[manualUnit,setManualUnit]=useState<'kg'|'lb'|null>(null);
  const [review,setReview]=useState<{id:string;questions:NonNullable<Chamber['state']>['submissions'][number]['questions']}|null>(null);
  const [reviewLoading,setReviewLoading]=useState(false);
  const state=chamber.state;
  const submissionId=state?.submissions[0]?.id;
  useEffect(()=>{setAnswers({});setReview(null);setReviewLoading(false);},[submissionId]);
  useEffect(()=>{setSheet(null);},[screen]);
  useLayoutEffect(()=>{
    if(!state)return;
    installPrototypeStyle();
    const focusedInput=host.current?.querySelector<HTMLInputElement>('input:focus'),focusedAction=focusedInput?.dataset.action;
    const selection=focusedAction==='capture-input'&&focusedInput?[focusedInput.selectionStart,focusedInput.selectionEnd]:null;
    const node=prototypeScreen(sheet?'Capture':screen);
    if(sheet)bindDecisionSheet(node,state,sheet);
    else {prepareHandoff(node,screen,state.today);bindHandoff(node,{state,screen,toast:chamber.toast,queueCount:chamber.queueCount,busy:chamber.busy,error:chamber.error,filter,answers,reviewQuestions:review?.id===submissionId?review?.questions:undefined,reviewLoading,reps,rir,exerciseId,manualLoad,manualUnit});}
    host.current!.replaceChildren(node);
    const input=node.querySelector<HTMLInputElement>('input[data-action="capture-input"]');if(input)input.value=draft.current;
    const focus=focusedAction?node.querySelector<HTMLInputElement>(`input[data-action="${focusedAction}"]`):null;
    if(focus){focus.focus();if(selection&&selection[0]!==null&&selection[1]!==null)focus.setSelectionRange(selection[0],selection[1]);}
    const width=sheet?390:screen==='Transition'?1160:screen==='Icon'?512:390,height=sheet?844:screen==='Transition'?840:screen==='Icon'?512:844;
    host.current!.className=`prototype-host${width===390?' phone':''}`;host.current!.style.width=`${width}px`;host.current!.style.height=`${height}px`;
    const resize=()=>{const scale=Math.min(1,window.innerWidth/width);host.current!.style.transform=`scale(${scale})`;shell.current!.style.height=`${height*scale}px`;};resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[screen,state,filter,answers,review,reviewLoading,reps,rir,exerciseId,manualLoad,manualUnit,sheet,chamber.busy,chamber.error,chamber.queueCount,chamber.toast]);
  async function submit(){const input=host.current?.querySelector<HTMLInputElement>('input[data-action="capture-input"]'),value=input?.value.trim();if(!value)return;const seen=new Set(state?.held.map(item=>item.id)??[]);draft.current='';if(input)input.value='';if(!await chamber.submit(value)){draft.current=value;if(input)input.value=value;}else if(navigator.onLine){const current=await chamber.refresh();if(current.held.some(item=>!seen.has(item.id)&&!item.deferUntilSessionEnd))navigate('Capture');}}
  async function writeSession(event:'start'|'end',dayId?:string){
    if(!state)return;const today=state.today,source={actor:'user' as const,channel:'ui' as const,client:'web'},clock=capturedClock();
    const current=openSession(state.entries),day=dayId?state.program.days.find(d=>d.id===dayId):state.program.days.find(d=>d.weekday===new Date(`${today}T12:00:00Z`).getUTCDay());
    if(event==='start'&&!day)return;
    const sessionId=event==='start'?crypto.randomUUID():current?.id;if(!sessionId)return;
    const entry:EntryDraft={kind:'session',event,sessionId,dayId:event==='start'?day!.id:null,date:clock.capturedLocalDate,dateOrigin:'device',source};
    await chamber.writeEntries([entry]);setSheet(null);setExerciseId(null);setManualLoad('');setManualUnit(null);navigate(event==='start'?'Session':'Debrief');
  }
  async function completeSet(exercise:string,load:number,unit:'kg'|'lb'){
    if(!state)return;const session=openSession(state.entries),ex=state.exercises.find(e=>e.id===exercise);if(!session||!ex)return;
    const clock=capturedClock(),entry:EntryDraft={kind:'set',sessionId:session.id,exerciseId:exercise,setIndex:session.sets.filter(e=>e.exerciseId===exercise).length+1,load,unit,loadKind:ex.type==='assisted'?'assist':'external',reps,rir,date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'}};
    const result=await chamber.writeEntries([entry],true);
    const unitQuestion=result.held.find(item=>item.gate==='G4'&&item.drafts[0]?.kind==='set'&&item.drafts[0].unit===unit&&item.options.some(option=>option.id==='as_is'));
    if(unitQuestion&&manualUnit!==null)await chamber.resolve(unitQuestion,{optionId:'as_is'});
    setRir(null);setManualLoad('');setManualUnit(null);
  }
  const click=(event:React.MouseEvent<HTMLDivElement>)=>{
    const target=event.target as Element,button=target.closest<HTMLElement>('[data-action],[data-answer-gate],[data-held-option],[data-derived-key],[data-filter]');if(!button||!state)return;
    if(button.getAttribute('aria-disabled')==='true'||button instanceof HTMLButtonElement&&button.disabled)return;
    if(button.dataset.filter){setFilter(button.dataset.filter as typeof filter);return;}
    if(button.dataset.derivedKey){setFormula(button.dataset.derivedKey);return;}
    if(button.dataset.answerGate&&button.dataset.answerOption&&submissionId){const next={...answers,[button.dataset.answerGate]:button.dataset.answerOption};setAnswers(next);setReviewLoading(true);void chamber.reviewSubmission(submissionId,next).then(value=>setReview({id:submissionId,questions:value.questions})).catch(cause=>chamber.setError(cause instanceof Error?cause.message:'审阅失败')).finally(()=>setReviewLoading(false));return;}
    if(button.dataset.heldOption){const held=state.held.find(h=>h.id===button.dataset.id);if(held)void chamber.resolve(held,{optionId:button.dataset.heldOption}).then(()=>navigate('Main'));return;}
    const id=button.dataset.id,action=button.dataset.action;
    if(action==='sheet-cancel'){event.preventDefault();setSheet(null);}
    else if(action==='program-template'&&id)setSheet({kind:'program',templateId:id});
    else if(action==='program-back')setSheet({kind:'program',templateId:null});
    else if(action==='program-save'&&sheet?.kind==='program'){
      event.preventDefault();const template=PROGRAM_TEMPLATES.find(item=>item.id===sheet.templateId);
      if(template)void chamber.writeProgram({...structuredClone(template.program),cycleStart:state.today}).then(()=>setSheet(null)).catch(()=>{});
    }
    else if(action==='sheet-day'&&id&&sheet&&sheet.kind!=='program')setSheet({...sheet,selectedDayId:id});
    else if(action==='day-start'&&sheet?.kind==='day'&&sheet.selectedDayId){event.preventDefault();void writeSession('start',sheet.selectedDayId).catch(()=>{});}
    else if(action==='progress-confirm-add'&&sheet?.kind==='add'&&sheet.selectedDayId){
      event.preventDefault();const day=state.program.days.find(item=>item.id===sheet.selectedDayId);
      if(!day)return;
      if(day.items.some(item=>item.exerciseId===sheet.exerciseId)){chamber.setError('这个动作已在所选训练日。');return;}
      const source=PROGRAM_TEMPLATES.flatMap(item=>item.program.days.flatMap(item=>item.items)).find(item=>item.exerciseId===sheet.exerciseId);
      if(!source)return;
      const program={...state.program,days:state.program.days.map(item=>item.id===day.id?{...item,items:[...item.items,{...source}]}:item)};
      void chamber.writeProgram(program).then(()=>setSheet(null)).catch(()=>{});
    }
    else if(action==='plan-setup'){event.preventDefault();setSheet({kind:'program',templateId:null});}
    else if(action==='choose-day'){event.preventDefault();setSheet({kind:'day',selectedDayId:null});}
    else if(action==='progress-add'&&button.dataset.exerciseId){setSheet(state.program.days.length?{kind:'add',exerciseId:button.dataset.exerciseId,selectedDayId:null}:{kind:'program',templateId:null});}
    else if(action==='capture-submit'){event.preventDefault();void submit();}
    else if(action==='capture-or-voice'){event.preventDefault();if(host.current?.querySelector<HTMLInputElement>('input[data-action="capture-input"]')?.value.trim())void submit();else chamber.setError('请在已连接的外部客户端发送语音，可从「接入」页查看连接地址。');}
    else if(action==='toast-revert'&&chamber.toast)void chamber.revert(chamber.toast);
    else if(action==='entry-revert'){const entry=state.entries.find(e=>e.id===target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId);if(entry)void chamber.revert(entry);}
    else if(action==='submission-accept'&&id&&button.getAttribute('aria-disabled')!=='true'){void chamber.decideSubmission(id,'accept',answers).then(()=>{setAnswers({});navigate('Main');});}
    else if(action==='submission-skip'&&id){void chamber.decideSubmission(id,'skip',{}).then(()=>{setAnswers({});navigate('Main');});}
    else if(action==='held-skip'&&id){const held=state.held.find(h=>h.id===id);if(held)void chamber.resolve(held,{skip:true}).then(()=>navigate('Main'));}
    else if(action==='view-pending')navigate('Capture');
    else if(action==='view-submission')navigate('Capture');
    else if(action==='start-session')void writeSession('start');
    else if(action==='end-session'){event.preventDefault();void writeSession('end');}
    else if(action==='complete-set'&&button.dataset.exerciseId&&button.dataset.load&&button.dataset.unit)void completeSet(button.dataset.exerciseId,Number(button.dataset.load),button.dataset.unit as 'kg'|'lb');
    else if(action==='next-exercise'){const session=openSession(state.entries),day=state.program.days.find(d=>d.id===session?.dayId),items=day?.items??[];const index=items.findIndex(item=>item.exerciseId===exerciseId);if(items.length){setExerciseId(items[(index+1)%items.length].exerciseId);setManualLoad('');setManualUnit(null);}}
    else if(action==='load-unit'&&button.dataset.unitDefault){setManualUnit(unit=>unit===null?button.dataset.unitDefault as 'kg'|'lb':unit==='kg'?'lb':'kg');}
    else if(action==='reps-minus')setReps(n=>Math.max(1,n-1));else if(action==='reps-plus')setReps(n=>Math.min(100,n+1));
    else if(action==='rir')setRir(Number(button.dataset.value));
    else if(action==='trigger-accept'&&id)void chamber.decideTrigger(id,'accept');else if(action==='trigger-later'&&id)void chamber.decideTrigger(id,'later');
    else if(action==='proposal-accept'&&id)void chamber.decideProposal(id,'accept');else if(action==='proposal-reject'&&id)void chamber.decideProposal(id,'reject');
    else if(action==='copy-endpoint')void navigator.clipboard.writeText(`${location.origin}/mcp`);
    else if(action==='external-photo'||action==='external-voice')chamber.setError(`请在已连接的外部客户端发送${action==='external-photo'?'照片':'语音'}，可从「接入」页查看连接地址。`);
    else if(action==='client-revoke'&&id)void chamber.revokeClient(id);
  };
  const keydown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    const target=event.target as Element;
    if(event.key==='Enter'&&target.matches('input[data-action="capture-input"]')){event.preventDefault();void submit();}
    else if((event.key==='Enter'||event.key===' ')&&target.matches('[role="button"][data-action]')){event.preventDefault();(target as HTMLElement).click();}
  };
  const onInput=(event:React.FormEvent<HTMLDivElement>)=>{const target=event.target;if(target instanceof HTMLInputElement){if(target.matches('input[data-action="capture-input"]'))draft.current=target.value;else if(target.matches('input[data-action="load-input"]'))setManualLoad(target.value);}};
  const derived=formula?state?.derived[formula]:null;
  return <div className="prototype-shell" ref={shell} onClick={click} onKeyDown={keydown} onInput={onInput}><div ref={host}/>{derived&&<div className="formula-scrim" role="presentation" onClick={()=>setFormula(null)}><div className="formula-drawer" role="dialog" aria-label="计算方式" onClick={event=>event.stopPropagation()}><button type="button" onClick={()=>setFormula(null)} aria-label="关闭">完成</button><h2>{derived.label}</h2><p>{derived.formula}</p><p>{derived.rule} · v{derived.ruleVersion}</p><p>输入记录：{derived.inputs.length?derived.inputs.join('、'):'计划设置'}</p></div></div>}</div>;
}
