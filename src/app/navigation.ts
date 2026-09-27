export type Screen = 'Main' | 'Capture' | 'Session' | 'Body' | 'Progress' | 'Ledger' | 'Connect' | 'Transition' | 'Debrief' | 'Icon';
export const screens: Screen[] = ['Main','Capture','Session','Body','Progress','Ledger','Connect','Transition','Debrief','Icon'];
export function screenFromHash(): Screen { const hash=window.location.hash.slice(1);return screens.includes(hash as Screen)?hash as Screen:'Main'; }
export function navigate(screen:Screen, replace=false) {
  if(screenFromHash()===screen&&!replace)return;
  const state={lowkkeyFrom:screenFromHash()};
  if(replace)history.replaceState(state,'',`#${screen}`);else history.pushState(state,'',`#${screen}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
