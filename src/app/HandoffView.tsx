import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PROGRAM_TEMPLATES } from '@lowkkey/protocol';
import type { EntryDraft } from '@lowkkey/protocol';
import { openSession } from '@lowkkey/core';
import { capturedClock } from '../client/offline.ts';
import { bindHandoff, prepareHandoff } from './handoff-bindings.ts';
import { installPrototypeStyle, prototypeScreen } from './prototype-template.ts';
import { navigate, screens } from './navigation.ts';
import type { Screen } from './navigation.ts';
import { bindDecisionSheet } from './sheet-bindings.ts';
import type { SheetState } from './sheet-bindings.ts';
import { RequestError } from './useHandoff.ts';
import type { useHandoff } from './useHandoff.ts';
import { patchNode } from './dom-patch.ts';
import { Motion, reducedMotion } from './motion.ts';
import { observeViewport, prepareViewport } from './viewport.ts';

type Chamber=ReturnType<typeof useHandoff>;
const writes=new Set(['program-save','day-start','progress-confirm-add','capture-submit','toast-revert','entry-revert','submission-accept','submission-skip','held-skip','start-session','end-session','complete-set','trigger-accept','trigger-later','proposal-accept','proposal-reject','client-revoke']);
const focusable='button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]';

export function HandoffView({screen,chamber}:{screen:Screen;chamber:Chamber}){
  const shell=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),draft=useRef(''),composing=useRef(false);
  const failedCapture=useRef('');
  const [filter,setFilter]=useState<'all'|'you'|'model'|'rule'>('all'),[answers,setAnswers]=useState<Record<string,string>>({});
  const [reps,setReps]=useState(8),[rir,setRir]=useState<number|null>(null),[exerciseId,setExerciseId]=useState<string|null>(null);
  const [formula,setFormula]=useState<string|null>(null),[sheet,setSheet]=useState<SheetState|null>(null),[manualLoad,setManualLoad]=useState(''),[manualUnit,setManualUnit]=useState<'kg'|'lb'|null>(null);
  const [review,setReview]=useState<{id:string;questions:NonNullable<Chamber['state']>['submissions'][number]['questions'];revision:number}|null>(null);
  const [reviewLoading,setReviewLoading]=useState(false),[activeAction,setActiveAction]=useState<string|null>(null),[notice,setNotice]=useState(''),[captureRetry,setCaptureRetry]=useState(false);
  const [copyFallback,setCopyFallback]=useState(false);
  const reviewSequence=useRef(0),running=useRef(false),lastBase=useRef<Screen>('Main'),base=useRef<HTMLElement|null>(null),overlay=useRef<HTMLElement|null>(null),overlayType=useRef<string|null>(null);
  const scrollPositions=useRef(new WeakMap<HTMLElement,{node:Element;top:number;left:number}[]>());
  const cache=useRef(new Map<Screen,HTMLElement>()),pageMotion=useRef(new Motion()),sheetMotion=useRef(new Motion()),returnFocus=useRef<HTMLElement|null>(null);
  const press=useRef<{x:number;y:number}|null>(null);
  const drag=useRef<{node:HTMLElement;layer:HTMLElement;grip:HTMLElement;y:number;offset:number;last:number;id:number;samples:{y:number;time:number}[]}|null>(null),dragFrame=useRef(0);
  const state=chamber.state,submissionId=state?.submissions[0]?.id;
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
    if(current.sheet||current.formula){if(history.state?.lowkkeyOverlay)history.back();else{setSheet(null);setFormula(null);}}
    else if(current.screen==='Capture'){if(history.state?.lowkkeyFrom)history.back();else navigate(lastBase.current,true);}
  }
  function go(to:Screen){
    const replace=!!history.state?.lowkkeyOverlay;
    setSheet(null);setFormula(null);navigate(to,replace);
  }
  function decorate(node:HTMLElement){
    for(const control of node.querySelectorAll<HTMLElement>('[data-action],[data-held-option]')){
      const action=control.dataset.action;
      if(control instanceof HTMLAnchorElement&&!control.hasAttribute('href')){control.setAttribute('role','button');control.tabIndex=0;}
      if(activeAction&&(writes.has(action??'')||control.dataset.heldOption||action==='capture-or-voice'||activeAction==='complete-set'&&['rir','reps-plus','reps-minus','load-unit','next-exercise'].includes(action??''))){
        control.setAttribute('aria-disabled','true');if(control instanceof HTMLButtonElement)control.disabled=true;
        if(action===activeAction){control.setAttribute('aria-busy',String(chamber.busy));if(control.childElementCount===0)control.textContent=chamber.retry?'等待重试':'正在保存…';}
      }
    }
  }
  useLayoutEffect(()=>{
    if(!state||!host.current)return;
    installPrototypeStyle();
    const context={state,screen:baseScreen,toast:chamber.error?null:chamber.toast,queueCount:chamber.error?0:chamber.queueCount,busy:chamber.busy,error:'',filter,answers,reviewQuestions:review&&review.id===submissionId?review.questions:undefined,reviewLoading,reps,rir,exerciseId,manualLoad,manualUnit};
    const target=prototypeScreen(baseScreen);prepareHandoff(target,baseScreen,state.today);bindHandoff(target,context);
    prepareViewport(target,baseScreen);
    if(copyFallback&&baseScreen==='Connect'){
      const endpoint=target.querySelector<HTMLElement>('[data-bind="connect-endpoint"]');
      if(endpoint){const copy=document.createElement('input');copy.className='endpoint-copy-input';copy.readOnly=true;copy.value=`${location.origin}/mcp`;copy.setAttribute('aria-label','MCP 连接地址，长按复制');endpoint.replaceChildren(copy);}
    }
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
        returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
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
    if(!copyFallback)return;
    const input=host.current?.querySelector<HTMLInputElement>('.endpoint-copy-input');input?.focus({preventScroll:true});input?.select();
  },[copyFallback]);
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
      if(cause instanceof RequestError&&cause.status===409){setAnswers({});setReview(null);setReviewLoading(false);reviewSequence.current++;}
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
    await chamber.writeEntries([entry]);setExerciseId(null);setManualLoad('');setManualUnit(null);go(event==='start'?'Session':'Debrief');
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
        if(action==='sheet-cancel'||action==='modal-close')dismiss();
        else if(action==='program-template'&&id)setSheet({kind:'program',templateId:id});
        else if(action==='program-back')setSheet({kind:'program',templateId:null});
        else if(action==='program-save'&&sheet?.kind==='program'){
          const template=PROGRAM_TEMPLATES.find(item=>item.id===sheet.templateId);
          if(template)run(action,async()=>{await chamber.writeProgram({...structuredClone(template.program),cycleStart:state.today});dismiss();});
        }else if(action==='sheet-day'&&id&&sheet&&sheet.kind!=='program')setSheet({...sheet,selectedDayId:id});
        else if(action==='day-start'&&sheet?.kind==='day'&&sheet.selectedDayId)run(action,()=>writeSession('start',sheet.selectedDayId!));
        else if(action==='progress-confirm-add'&&sheet?.kind==='add'&&sheet.selectedDayId){
          const day=state.program.days.find(item=>item.id===sheet.selectedDayId),source=PROGRAM_TEMPLATES.flatMap(item=>item.program.days.flatMap(item=>item.items)).find(item=>item.exerciseId===sheet.exerciseId);
          if(day&&source&&!day.items.some(item=>item.exerciseId===sheet.exerciseId))run(action,async()=>{await chamber.writeProgram({...state.program,days:state.program.days.map(item=>item.id===day.id?{...item,items:[...item.items,{...source}]}:item)});dismiss();});
        }else if(action==='plan-setup')openSheet({kind:'program',templateId:null});
        else if(action==='choose-day')openSheet({kind:'day',selectedDayId:null});
        else if(action==='progress-add'&&button.dataset.exerciseId)openSheet(state.program.days.length?{kind:'add',exerciseId:button.dataset.exerciseId,selectedDayId:null}:{kind:'program',templateId:null});
        else if(action==='capture-submit')run(action,submit);
        else if(action==='capture-or-voice'){if(draft.current.trim())run('capture-submit',submit);else chamber.setError('请在已连接的外部客户端发送语音，可从「接入」页查看连接地址。');}
        else if(action==='toast-revert'&&chamber.toast)run(action,()=>chamber.revert(chamber.toast!));
        else if(action==='entry-revert'){const entry=state.entries.find(e=>e.id===target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId);if(entry)run(action,()=>chamber.revert(entry));}
        else if((action==='submission-accept'||action==='submission-skip')&&id)run(action,async()=>{await chamber.decideSubmission(id,action==='submission-accept'?'accept':'skip',action==='submission-accept'?answers:{},review?.id===id?review.revision:state.revision);setAnswers({});dismiss();});
        else if(action==='held-skip'&&id){const held=state.held.find(h=>h.id===id);if(held)run(action,async()=>{await chamber.resolve(held,{skip:true});dismiss();});}
        else if(action==='view-pending'||action==='view-submission')go('Capture');
        else if(action==='start-session')run(action,()=>writeSession('start'));
        else if(action==='end-session')run(action,()=>writeSession('end'));
        else if(action==='complete-set'&&button.dataset.exerciseId&&button.dataset.load&&button.dataset.unit)run(action,()=>completeSet(button.dataset.exerciseId!,Number(button.dataset.load),button.dataset.unit as 'kg'|'lb'));
        else if(action==='next-exercise'){
          const session=openSession(state.entries),items=state.program.days.find(d=>d.id===session?.dayId)?.items??[],index=items.findIndex(item=>item.exerciseId===(exerciseId??items[0]?.exerciseId));
          if(items.length){setExerciseId(items[(index+1)%items.length].exerciseId);setManualLoad('');setManualUnit(null);}
        }else if(action==='load-unit')setManualUnit(unit=>unit===null?button.dataset.unitDefault as 'kg'|'lb':unit==='kg'?'lb':'kg');
        else if(action==='reps-minus')setReps(n=>Math.max(1,n-1));
        else if(action==='reps-plus')setReps(n=>Math.min(100,n+1));
        else if(action==='rir')setRir(Number(button.dataset.value));
        else if(action==='trigger-accept'&&id)run(action,()=>chamber.decideTrigger(id,'accept'));
        else if(action==='trigger-later'&&id)run(action,()=>chamber.decideTrigger(id,'later'));
        else if(action==='proposal-accept'&&id)run(action,()=>chamber.decideProposal(id,'accept'));
        else if(action==='proposal-reject'&&id)run(action,()=>chamber.decideProposal(id,'reject'));
        else if(action==='copy-endpoint')void (async()=>{
          try{await navigator.clipboard.writeText(`${location.origin}/mcp`);setCopyFallback(false);setNotice('连接地址已复制');}
          catch{setCopyFallback(true);setNotice('请长按连接地址，选择复制。');}
        })();
        else if(action==='external-photo'||action==='external-voice')chamber.setError(`请在已连接的外部客户端发送${action==='external-photo'?'照片':'语音'}，可从「接入」页查看连接地址。`);
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
    else if((event.key==='Enter'||event.key===' ')&&target.matches('[role="button"][data-action]')){event.preventDefault();(target as HTMLElement).click();}
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
  const onInput=(event:React.FormEvent<HTMLDivElement>)=>{const target=event.target;if(target instanceof HTMLInputElement){if(target.matches('input[data-action="capture-input"]')){draft.current=target.value;const submit=host.current?.querySelector<HTMLElement>('[data-action="capture-or-voice"]');if(submit){submit.textContent=target.value.trim()?'提交':'语音';submit.setAttribute('aria-label',target.value.trim()?'提交记录':'语音使用说明');}}else if(target.matches('input[data-action="load-input"]'))setManualLoad(target.value);}};
  const feedback=chamber.error||notice;
  return <div className="prototype-shell" ref={shell} onClick={click} onKeyDown={keydown} onInput={onInput} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}>
    <div ref={host}/>
    {feedback&&<div className="action-status" role="status" aria-live="polite"><span>{feedback}</span>{chamber.retry?<button type="button" data-action="retry-operation">重试</button>:captureRetry&&chamber.error?<button type="button" data-action="retry-capture">重试</button>:null}</div>}
  </div>;
}
