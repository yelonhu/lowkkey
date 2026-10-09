export const screens = ['next','recap','body','log'] as const;
export type Screen = typeof screens[number];
export function screenFromHash():Screen {
  const key=location.hash.slice(1).split('?')[0];
  const aliases:Record<string,Screen>={Plan:'next',Gallery:'log',Weight:'body',Body:'body',Progress:'recap',Ledger:'log'};
  return aliases[key]??(screens.includes(key as Screen)?key as Screen:'next');
}
export function targetFromHash():string|null {const q=new URLSearchParams(location.hash.split('?')[1]??''),screen=screenFromHash(),value=screen==='next'?(q.get('title')??q.get('day')):screen==='recap'?q.get('week'):q.get('date');return value?screen+'-'+value:null;}
