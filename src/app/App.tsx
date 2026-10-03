import { useEffect, useState } from 'react';
import { screenFromHash } from './navigation.ts';
import type { Screen } from './navigation.ts';
import { HandoffView } from './HandoffView.tsx';
import { useHandoff } from './useHandoff.ts';
import { LoginGate, CustomerAccount } from './CustomerAccount.tsx';
import { installPressFeedback } from './press-feedback.ts';

export function App() {
  const chamber=useHandoff();
  useEffect(()=>installPressFeedback(document.getElementById('root')!),[]);
  const [screen,setScreen]=useState<Screen>(screenFromHash);
  useEffect(()=>{const onHash=()=>setScreen(screenFromHash());window.addEventListener('hashchange',onHash);window.addEventListener('popstate',onHash);return()=>{window.removeEventListener('hashchange',onHash);window.removeEventListener('popstate',onHash);};},[]);
  const [accountOpen,setAccountOpen]=useState(false);
  useEffect(()=>{const open=()=>setAccountOpen(true);window.addEventListener('lowkkey-account',open);return()=>window.removeEventListener('lowkkey-account',open);},[]);
  if(chamber.auth!=='ready'||!chamber.state)return <LoginGate chamber={chamber}/>;
  return <><HandoffView key={chamber.state.accountId} screen={screen} chamber={chamber}/>{accountOpen&&<CustomerAccount chamber={chamber} onClose={()=>setAccountOpen(false)}/>}</>;
}
