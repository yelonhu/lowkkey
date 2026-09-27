import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EntryDraft } from '@lowkkey/protocol';
import { openSession } from '@lowkkey/core';
import { capturedClock } from '../client/offline.ts';
import { bindHandoff, prepareHandoff } from './handoff-bindings.ts';
import { installPrototypeStyle, prototypeScreen } from './prototype-template.ts';
import type { Screen } from './navigation.ts';
import { navigate } from './navigation.ts';
import type { useHandoff } from './useHandoff.ts';

type Chamber=ReturnType<typeof useHandoff>;
export function HandoffView({screen,chamber}:{screen:Screen;chamber:Chamber}){
  const shell=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),draft=useRef('');
  const [filter,setFilter]=useState<'all'|'you'|'model'|'rule'>('all'),[answers,setAnswers]=useState<Record<string,string>>({}),[reps,setReps]=useState(8),[rir,setRir]=useState<number|null>(null),[exerciseId,setExerciseId]=useState<string|null>(null),[formula,setFormula]=useState<string|null>(null);
  const [review,setReview]=useState<{id:string;questions:NonNullable<Chamber['state']>['submissions'][number]['questions']}|null>(null);
  const [reviewLoading,setReviewLoading]=useState(false);
  const state=chamber.state;
  const submissionId=state?.submissions[0]?.id;
  useEffect(()=>{setAnswers({});setReview(null);setReviewLoading(false);},[submissionId]);
  useLayoutEffect(()=>{
    if(!state)return;
    installPrototypeStyle();
    const previous=host.current?.querySelector<HTMLInputElement>('input[data-action="capture-input"]'),focused=previous===document.activeElement,selection=focused&&previous?[previous.selectionStart,previous.selectionEnd]:null;
    const node=prototypeScreen(screen);
    prepareHandoff(node,screen,state.today);
    bindHandoff(node,{state,screen,toast:chamber.toast,queueCount:chamber.queueCount,busy:chamber.busy,error:chamber.error,filter,answers,reviewQuestions:review?.id===submissionId?review?.questions:undefined,reviewLoading,reps,rir,exerciseId});
    host.current!.replaceChildren(node);
    const input=node.querySelector<HTMLInputElement>('input[data-action="capture-input"]');if(input){input.value=draft.current;if(focused&&selection){input.focus();if(selection[0]!==null&&selection[1]!==null)input.setSelectionRange(selection[0],selection[1]);}}
    const width=screen==='Transition'?1160:screen==='Icon'?512:390,height=screen==='Transition'?840:screen==='Icon'?512:844;
    host.current!.className=`prototype-host${width===390?' phone':''}`;host.current!.style.width=`${width}px`;host.current!.style.height=`${height}px`;
    const resize=()=>{const scale=Math.min(1,window.innerWidth/width);host.current!.style.transform=`scale(${scale})`;shell.current!.style.height=`${height*scale}px`;};resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[screen,state,filter,answers,review,reviewLoading,reps,rir,exerciseId,chamber.busy,chamber.error,chamber.queueCount,chamber.toast]);
  async function submit(){const input=host.current?.querySelector<HTMLInputElement>('input[data-action="capture-input"]'),value=input?.value.trim();if(!value)return;const seen=new Set(state?.held.map(item=>item.id)??[]);draft.current='';if(input)input.value='';if(!await chamber.submit(value)){draft.current=value;if(input)input.value=value;}else if(navigator.onLine){const current=await chamber.refresh();if(current.held.some(item=>!seen.has(item.id)&&!item.deferUntilSessionEnd))navigate('Capture');}}
  async function writeSession(event:'start'|'end'){
    if(!state)return;const today=state.today,source={actor:'user' as const,channel:'ui' as const,client:'web'},clock=capturedClock();
    const current=openSession(state.entries),day=state.program.days.find(d=>d.weekday===new Date(`${today}T12:00:00Z`).getUTCDay());
    if(event==='start'&&!day)return;
    const sessionId=event==='start'?crypto.randomUUID():current?.id;if(!sessionId)return;
    const entry:EntryDraft={kind:'session',event,sessionId,dayId:event==='start'?day!.id:null,date:clock.capturedLocalDate,dateOrigin:'device',source};
    await chamber.writeEntries([entry]);navigate(event==='start'?'Session':'Debrief');
  }
  async function completeSet(exercise:string,load:number,unit:'kg'|'lb'){
    if(!state)return;const session=openSession(state.entries),ex=state.exercises.find(e=>e.id===exercise);if(!session||!ex)return;
    const clock=capturedClock(),entry:EntryDraft={kind:'set',sessionId:session.id,exerciseId:exercise,setIndex:session.sets.filter(e=>e.exerciseId===exercise).length+1,load,unit,loadKind:ex.type==='assisted'?'assist':'external',reps,rir,date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'}};
    await chamber.writeEntries([entry],true);setRir(null);
  }
  const click=(event:React.MouseEvent<HTMLDivElement>)=>{
    const target=event.target as Element,button=target.closest<HTMLElement>('[data-action],[data-answer-gate],[data-held-option],[data-derived-key],[data-filter]');if(!button||!state)return;
    if(button.dataset.filter){setFilter(button.dataset.filter as typeof filter);return;}
    if(button.dataset.derivedKey){setFormula(button.dataset.derivedKey);return;}
    if(button.dataset.answerGate&&button.dataset.answerOption&&submissionId){const next={...answers,[button.dataset.answerGate]:button.dataset.answerOption};setAnswers(next);setReviewLoading(true);void chamber.reviewSubmission(submissionId,next).then(value=>setReview({id:submissionId,questions:value.questions})).catch(cause=>chamber.setError(cause instanceof Error?cause.message:'审阅失败')).finally(()=>setReviewLoading(false));return;}
    if(button.dataset.heldOption){const held=state.held.find(h=>h.id===button.dataset.id);if(held)void chamber.resolve(held,{optionId:button.dataset.heldOption}).then(()=>navigate('Main'));return;}
    const id=button.dataset.id,action=button.dataset.action;
    if(action==='capture-submit'){event.preventDefault();void submit();}
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
    else if(action==='next-exercise'){const session=openSession(state.entries),day=state.program.days.find(d=>d.id===session?.dayId),items=day?.items??[];const index=items.findIndex(item=>item.exerciseId===exerciseId);if(items.length)setExerciseId(items[(index+1)%items.length].exerciseId);}
    else if(action==='reps-minus')setReps(n=>Math.max(0,n-1));else if(action==='reps-plus')setReps(n=>Math.min(100,n+1));
    else if(action==='rir')setRir(Number(button.dataset.value));
    else if(action==='trigger-accept'&&id)void chamber.decideTrigger(id,'accept');else if(action==='trigger-later'&&id)void chamber.decideTrigger(id,'later');
    else if(action==='proposal-accept'&&id)void chamber.decideProposal(id,'accept');else if(action==='proposal-reject'&&id)void chamber.decideProposal(id,'reject');
    else if(action==='copy-endpoint')void navigator.clipboard.writeText(`${location.origin}/mcp`);
    else if(action==='external-photo'||action==='external-voice')chamber.setError(`请在已连接的外部客户端发送${action==='external-photo'?'照片':'语音'}，可从「接入」页查看连接地址。`);
    else if(action==='client-revoke'&&id)void chamber.revokeClient(id);
  };
  const keydown=(event:React.KeyboardEvent<HTMLDivElement>)=>{if(event.key==='Enter'&&(event.target as Element).matches('input[data-action="capture-input"]')){event.preventDefault();void submit();}};
  const onInput=(event:React.FormEvent<HTMLDivElement>)=>{const target=event.target;if(target instanceof HTMLInputElement&&target.matches('input[data-action="capture-input"]'))draft.current=target.value;};
  const derived=formula?state?.derived[formula]:null;
  return <div className="prototype-shell" ref={shell} onClick={click} onKeyDown={keydown} onInput={onInput}><div ref={host}/>{derived&&<div className="formula-scrim" role="presentation" onClick={()=>setFormula(null)}><div className="formula-drawer" role="dialog" aria-label="计算方式" onClick={event=>event.stopPropagation()}><button type="button" onClick={()=>setFormula(null)} aria-label="关闭">完成</button><h2>{derived.label}</h2><p>{derived.formula}</p><p>{derived.rule} · v{derived.ruleVersion}</p><p>输入记录：{derived.inputs.length?derived.inputs.join('、'):'计划设置'}</p></div></div>}</div>;
}
