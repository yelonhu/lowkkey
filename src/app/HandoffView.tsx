import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EntryDraft } from '@lowkkey/protocol';
import { openSession } from '@lowkkey/core';
import { capturedClock } from '../client/offline.ts';
import { bindHandoff, prepareHandoff } from './handoff-bindings.ts';
import { installPrototypeStyle, prototypeScreen } from './prototype-template.ts';
import { navigate, screens, reviewFromHash, navigateReview } from './navigation.ts';
import type { Screen } from './navigation.ts';
import { bindDecisionSheet } from './sheet-bindings.ts';
import type { SheetState } from './sheet-bindings.ts';
import { RequestError } from './useHandoff.ts';
import type { useHandoff } from './useHandoff.ts';
import { patchNode } from './dom-patch.ts';
import { Motion, reducedMotion } from './motion.ts';
import { observeViewport, prepareViewport } from './viewport.ts';

type Chamber=ReturnType<typeof useHandoff>;
const writes=new Set(['decision-accept','decision-later','set-classify','day-start','capture-submit','toast-revert','entry-revert','submission-accept','submission-skip','held-skip','start-session','end-session','complete-set','trigger-accept','trigger-later','proposal-accept','proposal-later','proposal-reject','client-revoke']);
const focusable='button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]';

export function HandoffView({screen,chamber}:{screen:Screen;chamber:Chamber}){
  const shell=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),draft=useRef(''),composing=useRef(false);
  const failedCapture=useRef('');
  const [filter,setFilter]=useState<'all'|'you'|'model'|'rule'>('all'),[answers,setAnswers]=useState<Record<string,string>>({});
  const [reps,setReps]=useState<number|null>(null),[rir,setRir]=useState<number|null>(null),[exerciseId,setExerciseId]=useState<string|null>(null);
  const [formula,setFormula]=useState<string|null>(null),[sheet,setSheet]=useState<SheetState|null>(null),[manualLoad,setManualLoad]=useState(''),[manualUnit,setManualUnit]=useState<'kg'|'lb'|null>(null);
  const [review,setReview]=useState<{id:string;questions:NonNullable<Chamber['state']>['submissions'][number]['questions'];revision:number}|null>(null);
  const [reviewLoading,setReviewLoading]=useState(false),[activeAction,setActiveAction]=useState<string|null>(null),[notice,setNotice]=useState(''),[captureRetry,setCaptureRetry]=useState(false);
  const shownReview=useRef<{id:string;revision:number}|null>(null);
  const [reviewOutcome,setReviewOutcome]=useState<string|null>(null);
  const reviewSequence=useRef(0),running=useRef(false),lastBase=useRef<Screen>('Main'),base=useRef<HTMLElement|null>(null),overlay=useRef<HTMLElement|null>(null),overlayType=useRef<string|null>(null);
  const scrollPositions=useRef(new WeakMap<HTMLElement,{node:Element;top:number;left:number}[]>());
  const cache=useRef(new Map<Screen,HTMLElement>()),pageMotion=useRef(new Motion()),sheetMotion=useRef(new Motion()),returnFocus=useRef<HTMLElement|SVGElement|null>(null);
  const press=useRef<{x:number;y:number}|null>(null);
  const drag=useRef<{node:HTMLElement;layer:HTMLElement;grip:HTMLElement;y:number;offset:number;last:number;id:number;samples:{y:number;time:number}[]}|null>(null),dragFrame=useRef(0);
  const [reviewTarget,setReviewTarget]=useState(reviewFromHash);
  useEffect(()=>{const update=()=>setReviewTarget(reviewFromHash());window.addEventListener('hashchange',update);window.addEventListener('popstate',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('popstate',update);};},[]);
  const state=chamber.state,submissionId=reviewTarget?(reviewTarget.kind==='submission'?reviewTarget.id:undefined):state?.submissions[0]?.id;
  useEffect(()=>{if(state&&reviewTarget&&(reviewTarget.kind==='proposal'||reviewTarget.kind==='trigger'))setSheet({kind:'decision',id:reviewTarget.id,type:reviewTarget.kind,revision:state.revision});},[reviewTarget]);
  useEffect(()=>{setReviewOutcome(null);if(!reviewTarget||!state)return;const controller=new AbortController();void fetch(`/v1/reviews/${reviewTarget.kind}/${encodeURIComponent(reviewTarget.id)}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();return response.json();}).then(value=>{const labels:Record<string,string>={accepted:'已确认入账',skipped:'已跳过',rejected:'未采用',applied:'已采用',dismissed:'已处理',resolved:'此事项已处理'};setReviewOutcome(labels[value.status]??null);}).catch(()=>{if(!controller.signal.aborted)setReviewOutcome('此事项暂时无法读取，请刷新后重试。');});return()=>controller.abort();},[reviewTarget,state?.revision]);
  const [extraSetKey,setExtraSetKey]=useState<string|null>(null);
  const [setRole,setSetRole]=useState<'work'|'warmup'>('work');
  const suggestion=useRef<{key:string;value:number|null;unit:'kg'|'lb';ruleVersion:string;inputs:string[]}|null>(null),claiming=useRef(false),lastClaim=useRef(-1);
  const currentSession=state?openSession(state.entries):null,currentItem=state?.program.days.find(day=>day.id===currentSession?.dayId)?.items.find(item=>item.exerciseId===exerciseId)??state?.program.days.find(day=>day.id===currentSession?.dayId)?.items[0];
  const setKey=`${currentSession?.id}:${currentItem?.exerciseId}:${currentSession?.sets.length}`;
  const previousReps=state?.entries.filter(entry=>entry.kind==='set'&&entry.exerciseId===currentItem?.exerciseId&&!state.entries.some(r=>r.kind==='revert'&&r.targetId===entry.id)).at(-1);
  const actualReps=reps??(previousReps?.kind==='set'?previousReps.reps:currentItem?.repMin??1);
  if(state&&currentItem){const ex=state.exercises.find(ex=>ex.id===currentItem.exerciseId)!,derived=state.derived[`next.${ex.id}`],key=`${currentSession?.id}:${ex.id}:${currentSession?.sets.filter(set=>set.exerciseId===ex.id).length}`;
    if(!suggestion.current||suggestion.current.key!==key&&!manualLoad&&!host.current?.querySelector('[data-action="load-input"]:focus'))suggestion.current={key,value:derived?.value??currentItem.startLoad,unit:ex.unit,ruleVersion:derived?.ruleVersion??'1.1.0',inputs:derived?.inputs??[]};
  }
  useEffect(()=>{
    if(!state||screen!=='Main'||currentSession||state.decisionSlots?.[state.today]||claiming.current||lastClaim.current===state.revision||chamber.busy)return;
    if(!state.proposals.some(p=>p.status==='open'&&(!p.snoozedUntil||p.snoozedUntil<=state.today))&&!state.triggers.some(t=>t.status==='will_fire'&&(!t.snoozedUntil||t.snoozedUntil<=state.today)))return;
    claiming.current=true;lastClaim.current=state.revision;void chamber.claimDecision().catch(()=>{}).finally(()=>{claiming.current=false;});
  },[state,screen,currentSession,chamber]);
  const live=useRef({sheet,formula,screen});live.current={sheet,formula,screen};
  const baseScreen=screen==='Capture'?lastBase.current:screen;
  const modalType=sheet?'decision':formula?'formula':screen==='Capture'?'capture':null;
  useEffect(()=>{setAnswers({});setReview(null);setReviewLoading(false);reviewSequence.current++;},[submissionId]);
  useEffect(()=>{const onBack=()=>{setSheet(null);setFormula(null);};window.addEventListener('popstate',onBack);return()=>window.removeEventListener('popstate',onBack);},[]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),2500);return()=>window.clearTimeout(timer);},[notice]);
  useEffect(()=>{
    if(!chamber.confirmedCapture||chamber.confirmedCapture.rawText!==failedCapture.current)return;
    if(draft.current.trim()===failedCapture.current){draft.current='';const input=host.current?.querySelector<HTMLInputElement>('[data-action="capture-input"]');if(input)input.value='';}
    failedCapture.current='';setCaptureRetry(false);
  },[chamber.confirmedCapture]);
  useEffect(()=>{
    return()=>{cancelAnimationFrame(dragFrame.current);pageMotion.current.settle();sheetMotion.current.settle();};
  },[]);

  function openSheet(value:SheetState){
    if(!sheet&&!formula)history.pushState({...history.state,lowkkeyOverlay:true},'',location.href);
    setSheet(value);setFormula(null);
  }
  function dismiss(){
    const current=live.current;
    if(current.sheet||current.formula){if(history.state?.lowkkeyOverlay)history.back();else{setSheet(null);setFormula(null);if(reviewFromHash())navigate(current.screen,true);}}
    else if(current.screen==='Capture'){if(history.state?.lowkkeyFrom)history.back();else navigate(lastBase.current,true);}
  }
  function go(to:Screen){
    const replace=!!history.state?.lowkkeyOverlay;
    setSheet(null);setFormula(null);navigate(to,replace);
  }
  function decorate(node:HTMLElement){
    for(const control of node.querySelectorAll<HTMLElement>('[data-action],[data-held-option]')){
      const action=control.dataset.action;
      if(control instanceof HTMLInputElement&&action==='load-input')control.readOnly=activeAction==='complete-set';
      if(control instanceof HTMLAnchorElement&&!control.hasAttribute('href')){control.setAttribute('role','button');control.tabIndex=0;}
      if(activeAction&&(writes.has(action??'')||control.dataset.heldOption||action==='capture-or-voice'||activeAction==='complete-set'&&['set-role','rir','reps-plus','reps-minus','load-unit','next-exercise','exercise-list','select-exercise','extra-set'].includes(action??''))){
        control.setAttribute('aria-disabled','true');if(control instanceof HTMLButtonElement)control.disabled=true;
        if(action===activeAction){control.setAttribute('aria-busy',String(chamber.busy));if(control.childElementCount===0)control.textContent=chamber.retry?'等待重试':'正在保存…';}
      }
    }
  }
  useLayoutEffect(()=>{
    if(!state||!host.current)return;
    installPrototypeStyle();
    if(screen!=='Capture')shownReview.current=null;
    if(screen==='Capture'&&submissionId&&shownReview.current?.id!==submissionId)shownReview.current={id:submissionId,revision:state.revision};
    const context={state,reviewOutcome,screen:baseScreen,toast:chamber.error?null:chamber.toast,queueCount:chamber.error?0:chamber.queueCount,busy:chamber.busy,error:'',filter,answers,reviewTarget,reviewQuestions:review&&review.id===submissionId?review.questions:undefined,reviewLoading,reps:actualReps,rir,exerciseId,manualLoad,manualUnit,setRole,allowExtra:extraSetKey===setKey,suggestion:suggestion.current};
    const target=prototypeScreen(baseScreen);prepareHandoff(target,baseScreen,state.today);bindHandoff(target,context);
    prepareViewport(target,baseScreen);
    const input=target.querySelector<HTMLInputElement>('input[data-action="capture-input"]');if(input){input.value=draft.current;const submit=target.querySelector<HTMLElement>('[data-action="capture-or-voice"]');if(submit&&draft.current.trim()){submit.textContent='提交';submit.setAttribute('aria-label','提交记录');}}
    decorate(target);
    const from=base.current?.dataset.screen as Screen|undefined;
    if(from===baseScreen&&base.current)patchNode(base.current,target);
    else {
      pageMotion.current.settle();sheetMotion.current.settle();cancelAnimationFrame(dragFrame.current);drag.current=null;const old=base.current;
      if(old){scrollPositions.current.set(old,[...old.querySelectorAll('[data-scroll-region]')].filter(node=>node.scrollTop||node.scrollLeft).map(node=>({node,top:node.scrollTop,left:node.scrollLeft})));cache.current.set(from!,old);}
      const retained=cache.current.get(baseScreen);if(retained)patchNode(retained,target);
      const next=retained??target;host.current.replaceChildren(next);base.current=next;
      for(const position of scrollPositions.current.get(next)??[]){position.node.scrollTop=position.top;position.node.scrollLeft=position.left;}
      overlay.current=null;overlayType.current=null;
      pageMotion.current.screen(host.current,old,next,from??null,baseScreen,press.current);
    }
    lastBase.current=baseScreen;
    let layer:HTMLElement|null=null;
    if(sheet||screen==='Capture'){
      layer=prototypeScreen('Capture');
      if(sheet)bindDecisionSheet(layer,state,sheet);else{prepareHandoff(layer,'Capture',state.today);bindHandoff(layer,{...context,screen:'Capture'});}
      // Keep the original sheet and scrim; replace the storyboard backdrop with
      // the live, retained page already beneath the overlay.
      layer.firstElementChild!.firstElementChild!.remove();
      layer.firstElementChild!.firstElementChild!.setAttribute('data-scrim','');
      layer.classList.add('sheet-layer');
      const dialog=layer.querySelector<HTMLElement>('[role="dialog"]')!;dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1;
      dialog.firstElementChild?.setAttribute('data-sheet-handle','');decorate(layer);
    }else if(formula&&state.derived[formula]){
      const derived=state.derived[formula];layer=document.createElement('div');layer.className='formula-scrim';
      const dialog=document.createElement('div');dialog.className='formula-drawer';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','计算方式');dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1;
      const done=document.createElement('button');done.type='button';done.textContent='完成';done.dataset.action='modal-close';done.setAttribute('aria-label','关闭');dialog.append(done);
      const title=document.createElement('h2');title.textContent=derived.label;title.setAttribute('data-sheet-handle','');dialog.append(title);
      for(const value of [derived.formula,`${derived.rule} · v${derived.ruleVersion}`,`输入记录：${derived.inputs.length?derived.inputs.join('、'):'计划设置'}`]){const p=document.createElement('p');p.textContent=value;dialog.append(p);}
      const scrim=document.createElement('div');scrim.dataset.scrim='';layer.append(scrim,dialog);
    }
    if(layer){
      if(!overlay.current||overlayType.current!==modalType){
        sheetMotion.current.settle();overlay.current?.remove();
        returnFocus.current=document.activeElement instanceof HTMLElement||document.activeElement instanceof SVGElement?document.activeElement:null;
        host.current.append(layer);overlay.current=layer;overlayType.current=modalType;
        layer.querySelector<HTMLElement>('[role="dialog"]')?.focus({preventScroll:true});sheetMotion.current.sheet(layer,true,undefined,base.current);
      }else if(!drag.current)patchNode(overlay.current,layer);
      base.current!.inert=true;base.current!.setAttribute('aria-hidden','true');
    }else{
      base.current!.inert=false;base.current!.removeAttribute('aria-hidden');
      if(overlay.current){
        const outgoing=overlay.current;overlay.current=null;overlayType.current=null;
        outgoing.inert=true;outgoing.setAttribute('aria-hidden','true');outgoing.removeAttribute('data-screen');
        sheetMotion.current.sheet(outgoing,false,()=>outgoing.remove(),base.current);outgoing.querySelector('[role="dialog"]')?.removeAttribute('role');
        const previous=returnFocus.current;if(previous?.isConnected)previous.focus({preventScroll:true});returnFocus.current=null;
      }
    }
  });
  useLayoutEffect(()=>{
    if(!host.current||!shell.current)return;
    const width=baseScreen==='Transition'?1160:baseScreen==='Icon'?512:390,height=baseScreen==='Transition'?840:baseScreen==='Icon'?512:844;
    shell.current.dataset.theme=['Session','Debrief'].includes(baseScreen)?'dark':'light';
    host.current.className=`prototype-host${width===390?' phone':''}`;
    return observeViewport(shell.current,host.current,width,height);
  },[baseScreen]);
  useEffect(()=>{
    if(!modalType)return;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=overflow;};
  },[modalType]);

  function run(action:string,task:()=>Promise<unknown>){
    if(running.current)return;running.current=true;setActiveAction(action);setNotice('');if(action!=='capture-submit')setCaptureRetry(false);
    void task().catch(cause=>{
      if(cause instanceof RequestError&&cause.status===409){setAnswers({});setReview(null);shownReview.current=null;setReviewLoading(false);reviewSequence.current++;}
    }).finally(()=>{running.current=false;setActiveAction(null);});
  }
  async function submit(retry=false){
    if(composing.current)return;
    const input=host.current?.querySelector<HTMLInputElement>('input[data-action="capture-input"]'),value=retry?failedCapture.current:input?.value.trim();if(!value)return;
    const seen=new Set(state?.held.map(item=>item.id)??[]);
    failedCapture.current=value;
    const saved=await (retry?chamber.retryCapture():chamber.submit(value));setCaptureRetry(!saved);
    if(saved){
      failedCapture.current='';
      if(draft.current.trim()===value){draft.current='';if(input)input.value='';}
      if(navigator.onLine){const current=await chamber.refresh();if(current.held.some(item=>!seen.has(item.id)&&!item.deferUntilSessionEnd))go('Capture');}
    }
  }
  async function writeSession(event:'start'|'end',dayId?:string){
    if(!state)return;
    const clock=capturedClock(),current=openSession(state.entries),day=dayId?state.program.days.find(d=>d.id===dayId):state.program.days.find(d=>d.weekday===new Date(`${state.today}T12:00:00Z`).getUTCDay());
    if(event==='start'&&!day)return;
    const sessionId=event==='start'?crypto.randomUUID():current?.id;if(!sessionId)return;
    const entry:EntryDraft={kind:'session',event,sessionId,dayId:event==='start'?day!.id:null,date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'}};
    await chamber.writeEntries([entry]);setReps(null);setExtraSetKey(null);setSetRole('work');suggestion.current=null;setExerciseId(null);setManualLoad('');setManualUnit(null);go(event==='start'?'Session':'Debrief');
  }
  async function completeSet(exercise:string,load:number,unit:'kg'|'lb'){
    if(!state)return;const session=openSession(state.entries),ex=state.exercises.find(e=>e.id===exercise);if(!session||!ex)return;
    const clock=capturedClock(),entry:EntryDraft={kind:'set',sessionId:session.id,exerciseId:exercise,setIndex:session.sets.filter(e=>e.exerciseId===exercise).length+1,load,unit,loadKind:ex.type==='assisted'?'assist':'external',reps:actualReps,rir,setRole,recommendation:suggestion.current?{load:suggestion.current.value,unit:suggestion.current.unit,ruleVersion:suggestion.current.ruleVersion,inputs:suggestion.current.inputs}:undefined,date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'}};
    const result=await chamber.writeEntries([entry],true);
    const unitQuestion=result.held.find(item=>item.gate==='G4'&&item.drafts[0]?.kind==='set'&&item.drafts[0].unit===unit&&item.options.some(option=>option.id==='as_is'));
    if(unitQuestion&&manualUnit!==null)await chamber.resolve(unitQuestion,{optionId:'as_is'});
    setExtraSetKey(null);setRir(null);setReps(null);suggestion.current=null;setManualLoad('');setManualUnit(null);
  }
  const click=(event:React.MouseEvent<HTMLDivElement>)=>{
    const target=event.target as Element;if(!state)return;
    if(target.hasAttribute('data-scrim')||target===overlay.current&&formula){dismiss();return;}
    const button=target.closest<HTMLElement>('[data-action],[data-answer-gate],[data-held-option],[data-derived-key],[data-filter]');
    if(button){
      if(button.getAttribute('aria-disabled')==='true'||button instanceof HTMLButtonElement&&button.disabled){event.preventDefault();return;}
      const action=button.dataset.action,id=button.dataset.id;
      if(action==='retry-operation'){chamber.retry?.();return;}
      if(action==='retry-capture'){run('capture-submit',()=>submit(true));return;}
      if(button.dataset.filter){setFilter(button.dataset.filter as typeof filter);return;}
      if(button.dataset.derivedKey){if(!formula)history.pushState({...history.state,lowkkeyOverlay:true},'',location.href);setFormula(button.dataset.derivedKey);return;}
      if(button.dataset.answerGate&&button.dataset.answerOption&&submissionId){
        if(reviewLoading)return;
        const next={...answers,[button.dataset.answerGate]:button.dataset.answerOption},serial=++reviewSequence.current;
        setAnswers(next);setReviewLoading(true);
        void chamber.reviewSubmission(submissionId,next).then(value=>{if(serial===reviewSequence.current)setReview({id:submissionId,questions:value.questions,revision:value.revision});}).catch(()=>{if(serial===reviewSequence.current){setAnswers(answers);chamber.setError('审阅暂未完成，请重新选择。');}}).finally(()=>{if(serial===reviewSequence.current)setReviewLoading(false);});return;
      }
      if(button.dataset.heldOption){const held=state.held.find(h=>h.id===id);if(held)run('held-resolve',async()=>{await chamber.resolve(held,{optionId:button.dataset.heldOption!});dismiss();});return;}
      if(action){event.preventDefault();
        if(action==='account-settings')window.dispatchEvent(new Event('lowkkey-account'));
        else if(action==='sheet-cancel'||action==='modal-close')dismiss();
        else if(action==='cycle-details'&&sheet?.kind==='program')setSheet({...sheet,showCycle:!sheet.showCycle});
        else if(action==='set-role')setSetRole(value=>value==='work'?'warmup':'work');
        else if(action==='decision-view'&&id)navigateReview({kind:button.dataset.kind as 'proposal'|'trigger',id});
        else if((action==='decision-accept'||action==='decision-later')&&sheet?.kind==='decision')run(action,async()=>{const decision=action==='decision-accept'?'accept':'later';try{if(sheet.type==='proposal')await chamber.decideProposal(sheet.id,decision,sheet.revision);else await chamber.decideTrigger(sheet.id,decision,sheet.revision);setNotice(decision==='accept'?'已保存':'已延期');dismiss();}catch(error){if(!(error instanceof RequestError&&error.status===409))chamber.setError('暂未确认，请重试。');throw error;}});
        else if(action==='decision-refresh'&&sheet?.kind==='decision')setSheet({...sheet,revision:state.revision});
        else if(action==='set-classify'&&id)run(action,async()=>{const clock=capturedClock();await chamber.writeEntries([{kind:'set_annotation',targetId:id,setRole:button.dataset.role as 'work'|'warmup'|'unknown',date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'}}]);});
        else if(action==='sheet-day'&&id&&sheet?.kind==='day')setSheet({...sheet,selectedDayId:id});
        else if(action==='day-start'&&sheet?.kind==='day'&&sheet.selectedDayId)run(action,()=>writeSession('start',sheet.selectedDayId!));
        else if(action==='plan-view')openSheet({kind:'program'});
        else if(action==='choose-day')openSheet({kind:'day',selectedDayId:null});
        else if(action==='capture-submit')run(action,submit);
        else if(action==='capture-or-voice'){if(draft.current.trim())run('capture-submit',submit);else chamber.setError('这里暂不支持语音输入，可以先用文字记下。');}
        else if(action==='toast-revert'&&chamber.toast)run(action,()=>chamber.revert(chamber.toast!));
        else if(action==='entry-revert'){const entry=state.entries.find(e=>e.id===target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId);if(entry)run(action,()=>chamber.revert(entry));}
        else if((action==='submission-accept'||action==='submission-skip')&&id)run(action,async()=>{await chamber.decideSubmission(id,action==='submission-accept'?'accept':'skip',action==='submission-accept'?answers:{},review?.id===id?review.revision:shownReview.current?.id===id?shownReview.current.revision:state.revision);setAnswers({});dismiss();});
        else if(action==='held-skip'&&id){const held=state.held.find(h=>h.id===id);if(held)run(action,async()=>{await chamber.resolve(held,{skip:true});dismiss();});}
        else if(action==='view-pending'||action==='view-submission'){const selected=id??state.submissions[0]?.id??state.held[0]?.id;if(selected)navigateReview({kind:state.submissions.some(s=>s.id===selected)?'submission':'held',id:selected});else go('Capture');}
        else if(action==='start-session')run(action,()=>writeSession('start'));
        else if(action==='end-session')run(action,()=>writeSession('end'));
        else if(action==='complete-set'&&button.dataset.exerciseId&&button.dataset.load&&button.dataset.unit)run(action,()=>completeSet(button.dataset.exerciseId!,Number(button.dataset.load),button.dataset.unit as 'kg'|'lb'));
        else if(action==='exercise-list')openSheet({kind:'exercises',exerciseId:currentItem?.exerciseId??null});
        else if(action==='extra-set'){setExtraSetKey(setKey);setSetRole('work');}
        else if((action==='next-exercise'||action==='select-exercise')&&id){
          setExerciseId(id);setReps(null);setRir(null);setExtraSetKey(null);setSetRole('work');suggestion.current=null;setManualLoad('');setManualUnit(null);
          if(sheet?.kind==='exercises')dismiss();
        }else if(action==='load-unit')setManualUnit(unit=>unit===null?button.dataset.unitDefault as 'kg'|'lb':unit==='kg'?'lb':'kg');
        else if(action==='reps-minus')setReps(n=>Math.max(1,(n??actualReps)-1));
        else if(action==='reps-plus')setReps(n=>Math.min(100,(n??actualReps)+1));
        else if(action==='rir')setRir(Number(button.dataset.value));
        else if(action==='trigger-accept'&&id)run(action,()=>chamber.decideTrigger(id,'accept'));
        else if(action==='trigger-later'&&id)run(action,()=>chamber.decideTrigger(id,'later'));
        else if(action==='proposal-accept'&&id)run(action,()=>chamber.decideProposal(id,'accept'));
        else if(action==='proposal-later'&&id)run(action,()=>chamber.decideProposal(id,'later'));
        else if(action==='proposal-reject'&&id)run(action,()=>chamber.decideProposal(id,'reject'));
        else if(action==='external-photo'||action==='external-voice')chamber.setError(`这里暂不支持${action==='external-photo'?'照片':'语音'}输入，可以先用文字记下。`);
        else if(action==='client-revoke'&&id)run(action,()=>chamber.revokeClient(id));
        else if(action==='resume-session')go('Session');
        return;
      }
    }
    const link=target.closest<HTMLAnchorElement>('a[href^="#"]');
    if(link){const next=link.hash.slice(1) as Screen;if(screens.includes(next)){event.preventDefault();if(screen==='Capture')navigate(next,true);else go(next);}}
  };
  const keydown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    const target=event.target as Element;
    if(event.key==='Escape'&&modalType){event.preventDefault();dismiss();return;}
    if(event.key==='Tab'&&modalType){
      const dialog=overlay.current?.querySelector<HTMLElement>('[role="dialog"]'),items=dialog?[...dialog.querySelectorAll<HTMLElement>(focusable)].filter(item=>item.getClientRects().length&&item.getAttribute('aria-disabled')!=='true'):[];
      if(!items.length){event.preventDefault();dialog?.focus();}
      else if(event.shiftKey&&(target===items[0]||target===dialog)){event.preventDefault();items.at(-1)!.focus();}
      else if(!event.shiftKey&&(target===items.at(-1)||target===dialog)){event.preventDefault();items[0].focus();}
    }
    if(event.key==='Enter'&&target.matches('input[data-action="capture-input"]')){if(event.nativeEvent.isComposing||composing.current||event.keyCode===229)return;event.preventDefault();run('capture-submit',submit);}
    else if((event.key==='Enter'||event.key===' ')&&target.matches('[role="button"][data-action],[role="button"][data-derived-key]')){event.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
  };
  const pointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!event.isPrimary||event.button!==0)return;
    press.current={x:event.clientX,y:event.clientY};
    const grip=(event.target as Element).closest<HTMLElement>('[data-sheet-handle]'),dialog=grip?.closest<HTMLElement>('[role="dialog"]');
    if(dialog&&grip&&overlay.current){
      const offset=sheetMotion.current.holdSheet(overlay.current,base.current);grip.setPointerCapture(event.pointerId);
      drag.current={node:dialog,layer:overlay.current,grip,y:event.clientY,offset,last:event.clientY,id:event.pointerId,samples:[{y:event.clientY,time:performance.now()}]};
    }
  };
  const paintDrag=()=>{
    dragFrame.current=0;const active=drag.current;if(!active||reducedMotion())return;
    const scale=host.current!.getBoundingClientRect().width/host.current!.offsetWidth;
    const distance=Math.max(0,active.offset+(active.last-active.y)/scale);
    active.node.style.setProperty('--sheet-y',`${distance}px`);
    base.current?.style.setProperty('--sheet-depth',String(1-.04*Math.max(0,1-distance/active.node.offsetHeight)));
    active.layer.querySelector<HTMLElement>('[data-scrim]')?.style.setProperty('--sheet-scrim-opacity',String(Math.max(0,1-distance/active.node.offsetHeight)));
  };
  const pointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    const active=drag.current;if(!active||active.id!==event.pointerId)return;
    active.last=event.clientY;const time=performance.now();active.samples=active.samples.filter(sample=>time-sample.time<100);active.samples.push({y:event.clientY,time});
    if(!dragFrame.current)dragFrame.current=requestAnimationFrame(paintDrag);
  };
  const pointerEnd=(event:React.PointerEvent<HTMLDivElement>)=>{
    const active=drag.current;if(!active||active.id!==event.pointerId)return;
    cancelAnimationFrame(dragFrame.current);paintDrag();drag.current=null;
    if(active.grip.hasPointerCapture(event.pointerId))active.grip.releasePointerCapture(event.pointerId);
    const distance=active.last-active.y,sample=active.samples[0],velocity=(active.last-sample.y)/Math.max(1,performance.now()-sample.time);
    const close=event.type==='pointerup'&&(distance>80||distance>24&&velocity>.5);
    if(close)dismiss();else sheetMotion.current.sheet(active.layer,true,undefined,base.current);
  };
  const onInput=(event:React.FormEvent<HTMLDivElement>)=>{const target=event.target;if(target instanceof HTMLInputElement){if(target.matches('input[data-action="capture-input"]')){draft.current=target.value;const submit=host.current?.querySelector<HTMLElement>('[data-action="capture-or-voice"]');if(submit){if(target.value.trim())submit.textContent='提交';else {const original=prototypeScreen('Main').querySelector('[aria-label="语音"]');if(original)submit.replaceChildren(...Array.from(original.childNodes));}submit.setAttribute('aria-label',target.value.trim()?'提交记录':'语音使用说明');}}else if(target.matches('input[data-action="load-input"]'))setManualLoad(target.value);}};
  const feedback=chamber.error||notice;
  return <div className="prototype-shell" ref={shell} onClick={click} onKeyDown={keydown} onInput={onInput} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}>
    <div ref={host}/>
    {feedback&&<div className="action-status" role="status" aria-live="polite"><span>{feedback}</span>{chamber.retry?<button type="button" data-action="retry-operation">重试</button>:captureRetry&&chamber.error?<button type="button" data-action="retry-capture">重试</button>:null}</div>}
  </div>;
}
