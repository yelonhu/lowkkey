import { useEffect, useState } from 'react';
import { screenFromHash } from './navigation.ts';
import type { Screen } from './navigation.ts';
import { HandoffView } from './HandoffView.tsx';
import { useHandoff } from './useHandoff.ts';
import { installPressFeedback } from './press-feedback.ts';

export function App() {
  const chamber=useHandoff();
  useEffect(()=>installPressFeedback(document.getElementById('root')!),[]);
  const [screen,setScreen]=useState<Screen>(screenFromHash);
  useEffect(()=>{const onHash=()=>setScreen(screenFromHash());window.addEventListener('hashchange',onHash);window.addEventListener('popstate',onHash);return()=>{window.removeEventListener('hashchange',onHash);window.removeEventListener('popstate',onHash);};},[]);
  if(chamber.auth!=='ready'||!chamber.state)return <div className="access-gate"><div>lowkkey</div><h1>{chamber.auth==='required'?'请从这里开始。':'正在连接状态舱'}</h1><p>模型翻译，规则过闸，用户随时撤销。</p>{chamber.auth==='required'&&<button disabled={chamber.busy} onClick={()=>void chamber.login()}>进入状态舱 ↗</button>}{chamber.error&&<p role="alert">{chamber.error}</p>}</div>;
  return <HandoffView screen={screen} chamber={chamber}/>;
}
