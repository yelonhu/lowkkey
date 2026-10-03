export type Screen = 'Main' | 'Capture' | 'Session' | 'Body' | 'Progress' | 'Ledger' | 'Connect' | 'Transition' | 'Debrief' | 'Icon';
export const screens: Screen[] = ['Main','Capture','Session','Body','Progress','Ledger','Connect','Transition','Debrief','Icon'];
export function screenFromHash(): Screen { const hash=window.location.hash.slice(1).split('?')[0];return screens.includes(hash as Screen)?hash as Screen:'Main'; }
export function navigate(screen:Screen, replace=false) {
  if(screenFromHash()===screen&&!replace)return;
  const state={lowkkeyFrom:screenFromHash()};
  if(replace)history.replaceState(state,'',`#${screen}`);else history.pushState(state,'',`#${screen}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export type ReviewTarget={kind:'submission'|'held'|'proposal'|'trigger';id:string};
export function reviewFromHash():ReviewTarget|null {
  const query=new URLSearchParams(location.hash.split('?')[1]??'');
  const kind=query.get('review'),id=query.get('id');
  return id&&['submission','held','proposal','trigger'].includes(kind??'')?{kind:kind as ReviewTarget['kind'],id}:null;
}
export function navigateReview(target:ReviewTarget){
  const capture=target.kind==='submission'||target.kind==='held';
  const screen=capture?'Capture':screenFromHash()==='Capture'?'Main':screenFromHash();
  history.pushState({lowkkeyFrom:screenFromHash(),lowkkeyOverlay:!capture},'',`#${screen}?${new URLSearchParams({review:target.kind,id:target.id})}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
