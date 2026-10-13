import { useCallback,useEffect,useRef,useState } from 'react';
import { OnboardingState, type OnboardingState as Setup } from '@lowkkey/protocol';
import { Welcome,ProviderMark } from './Welcome.tsx';
import { call,type Account } from './customer-api.ts';

export const aiHosts={claude:{name:'Claude',connect:'https://claude.ai/customize/connectors',chat:'https://claude.ai/new',steps:['打开 Customize → Connectors，选择添加自定义连接器。','名称填写 lowkkey，服务器地址粘贴下方地址。','选择 OAuth 登录，使用你的 lowkkey 账户完成授权。','在对话的连接器菜单中启用 lowkkey。'],help:'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'},chatgpt:{name:'ChatGPT',connect:'https://chatgpt.com/plugins',chat:'https://chatgpt.com/',steps:['打开 Plugins，点击加号 → Add custom MCP server。','名称填写 lowkkey，Server URL 粘贴下方地址。','选择 OAuth，创建插件并使用你的 lowkkey 账户授权。','安装插件，在对话中用 @ 选择 lowkkey。'],help:'https://developers.openai.com/api/docs/guides/custom-mcp-server'}};
export const starter='请先看看我的 lowkkey，带我开始。训练安排也请考虑我的日常生活。';
export function useProduct(owner:string|undefined,onRefresh:()=>Promise<void>,waiting:boolean){
  const [setup,setSetup]=useState<Setup|null>(null),[loadedOwner,setLoadedOwner]=useState<string>(),[error,setError]=useState(''),[timedOut,setTimedOut]=useState(false),generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!owner)return;
    const epoch=generation.current;
    try{const next=OnboardingState.parse(await call('/v1/onboarding'));if(epoch===generation.current){setSetup(next);setLoadedOwner(owner);setError('');}}
    catch{if(epoch===generation.current)setError('开始进度暂时无法读取，请重试。');}
  },[owner]);
  useEffect(()=>{
    generation.current++;const epoch=generation.current;setSetup(null);setError('');
    if(!owner)return;
    void (async()=>{try{
      const account:Account=await call('/v1/account');if(epoch!==generation.current)return;
      if(!account.timezoneInitialized){await call('/v1/account/preferences',{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,initialize:true},owner);if(epoch!==generation.current)return;await onRefresh();}
      await refresh();
    }catch{if(epoch===generation.current)setError('开始进度暂时无法读取，请重试。');}})();
    return()=>{generation.current++;};
  },[owner,refresh,onRefresh]);
  useEffect(()=>{
    if(!owner)return;
    const resume=()=>{if(document.visibilityState!=='hidden'){void refresh();void call('/v1/onboarding/events',{event:'returned'},owner).catch(()=>{});}};
    window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
    return()=>{window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume);};
  },[owner,refresh]);
  useEffect(()=>{
    if(!owner||!waiting)return;
    let elapsed=0,pending=false;setTimedOut(false);
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='hidden'||pending)return;
      elapsed+=3000;
      if(elapsed>120000){setTimedOut(true);clearInterval(timer);void call('/v1/onboarding/events',{event:'connection_timeout'},owner).catch(()=>{});return;}
      pending=true;void refresh().finally(()=>{pending=false;});
    },3000);
    return()=>clearInterval(timer);
  },[owner,waiting,setup?.connectionStartedAt,refresh]);
  async function update(value:unknown){if(!owner)return;const epoch=generation.current;const next=OnboardingState.parse(await call('/v1/onboarding',value,owner));if(epoch===generation.current)setSetup(next);}
  const report=(name:'copy_failed'|'connection_help')=>{if(owner)void call('/v1/onboarding/events',{event:name},owner).catch(()=>{});};
  return {setup:loadedOwner===owner?setup:null,error,timedOut,refresh,update,report};
}
export function Onboarding({product,onClose,onNotes}:{product:ReturnType<typeof useProduct>;onClose:()=>void;onNotes:()=>void}){
  const {setup,update}=product,[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[prompt,setPrompt]=useState(starter),[opened,setOpened]=useState(false),[fallback,setFallback]=useState(false);
  const active=setup?.clients.filter(c=>c.status==='active')??[];
  const recent=active.find(c=>setup?.connectionStartedAt&&c.createdAt>=setup.connectionStartedAt);
  const current=recent??active[0],readOnly=!!current&&!current.scopes.includes('write');
  useEffect(()=>{const heading=document.querySelector<HTMLElement>('.journey h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}window.scrollTo({top:0});setMessage('');setFallback(false);setOpened(false);},[setup?.step]);
  useEffect(()=>{if(recent&&setup?.step==='guide')void update({step:'chat'}).catch(()=>{});},[recent?.id,setup?.step]);
  async function run(task:()=>Promise<unknown>){if(busy)return;setBusy(true);setMessage('');try{await task();}catch{setMessage('暂时未能保存，请重试。');}finally{setBusy(false);}}
  async function copyAndOpen(text:string,url:string){
    if(busy)return;setBusy(true);setMessage('');setFallback(false);
    // Open inside the gesture so mobile Safari does not lose the user activation while copying.
    const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
    try{await navigator.clipboard.writeText(text);if(tab)tab.location.replace(url);else setFallback(true);setOpened(true);setMessage(tab?'已复制。完成后，随时回来。':'已复制。请使用下方链接打开。');}
    catch{tab?.close();setFallback(true);product.report('copy_failed');setMessage('复制没有完成。可以长按下方文字复制，再打开 AI。');}
    finally{setBusy(false);}
  }
  const exit=()=>void run(async()=>{await update({skipped:true});onClose();});
  if(!setup)return <Welcome><h1>正在打开你的档案。</h1>{product.error&&<><p role="alert">{product.error}</p><button className="journey-quiet" onClick={()=>void product.refresh()}>重试</button></>}</Welcome>;
  const host=aiHosts[setup.ai??'claude'],step=setup.ai?setup.step:'choose',chat=step==='chat'&&active.length>0;
  return <Welcome action={<div className="onboarding-exits"><button className="journey-quiet" onClick={onNotes}>先随手记</button><button className="journey-quiet" disabled={busy} onClick={exit}>稍后连接</button></div>} back={step==='choose'?undefined:()=>void run(async()=>{await update({step:'choose'});setOpened(false);setFallback(false);})}>
    {step==='choose'?<><p className="meta">让对话接上你的档案</p><h1>你习惯和谁聊？</h1><p className="journey-copy">连接一次，以后就在那里聊训练。<br/>整理好的内容，会留在这里。</p><div className="ai-options">{(['chatgpt','claude'] as const).map(ai=><button key={ai} disabled={busy} onClick={()=>void run(()=>update({ai,step:'guide',skipped:false}))}><ProviderMark ai={ai}/><span>{aiHosts[ai].name}</span></button>)}</div><p className="journey-hint">之后也可以连接另一个 AI，接着同一份档案聊。</p>{active.length>0&&setup.ai&&<button className="journey-quiet" onClick={()=>void run(()=>update({step:'chat'}))}>使用已有连接继续聊天</button>}</>:chat?<><p className="meta">已经准备好</p><h1>接下来，和你的 AI 聊聊。</h1><p className="journey-copy">从这一句开始，或换成你自己的话。</p><label className="starter-label" htmlFor="starter">你的第一句话</label><textarea id="starter" className="starter-input" value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4} maxLength={2000}/><button className="journey-primary" disabled={busy||!prompt.trim()} onClick={()=>void copyAndOpen(prompt,host.chat)}>复制开场白并打开 {host.name}</button><p className="journey-hint">已有计划或训练截图，也可以直接发给它。<br/>发送前，记得在对话中启用 lowkkey。</p><p className="connection-receipt">已授权：{active.map(c=>c.name+(c.scopes.includes('write')?'':'（只读）')).join('、')}{readOnly&&' · 当前只读，保存前需要重新授权写入。'}</p>{readOnly&&<button className="journey-quiet" onClick={()=>void run(()=>update({ai:setup.ai??'claude',step:'guide'}))}>重新连接并允许保存</button>}{opened&&<p className="journey-copy">聊好后，第一份内容就会出现在这里。</p>}</>:<><div className="connection-host"><ProviderMark ai={setup.ai??'claude'}/><span>{host.name}</span></div>
      <h1>{opened?'回到 '+host.name+'，完成连接。':'让 '+host.name+' 接上你的档案。'}</h1>
      <p className="journey-copy">{opened?'地址已经复制。粘贴到连接设置后，用你的 lowkkey 账户确认。':'我们会复制好地址并打开连接入口。只需完成下面两步。'}</p>
      <ol className="connection-guide" aria-label="连接步骤">
        <li><span className="guide-number" aria-hidden="true">1</span><div><h2>添加一个连接</h2><p>{setup.ai==='chatgpt'?'Plugins → 加号 → Add custom MCP server':'Customize → Connectors → 添加自定义连接器'}</p></div></li>
        <li><span className="guide-number" aria-hidden="true">2</span><div><h2>粘贴地址，确认连接</h2><p>名称填 lowkkey，地址粘贴我们复制的内容。<br/>随后用你的 lowkkey 账户确认。</p></div></li>
      </ol>
      <button className="journey-primary" disabled={busy} onClick={()=>void copyAndOpen(location.origin+'/mcp',host.connect)}>{opened?'再次复制地址并打开 '+host.name:'复制地址并打开 '+host.name}</button>
      <p className="journey-hint connection-footnote">{opened?'连接完成后，回来就可以开始第一段对话。':'连接完成后，随时可以在设置中撤销。'}</p>
      {active.length>0&&<button className="journey-quiet" onClick={()=>void run(()=>update({step:'chat'}))}>使用已有连接去聊天</button>}</>}
    {fallback&&<div className="copy-fallback">{!chat&&<code>{location.origin}/mcp</code>}<a href={chat?host.chat:host.connect} target="_blank" rel="noreferrer">打开 {host.name} ↗</a></div>}
    {step!=='choose'&&<details className="journey-help" onToggle={e=>{if(e.currentTarget.open)product.report('connection_help');}}><summary>遇到问题</summary><p>请在网页版添加连接；组织账户可能需要管理员允许。授权时使用与你的档案相同的账户。</p><ol>{host.steps.map(s=><li key={s}>{s}</li>)}</ol><code className="connection-address">{location.origin}/mcp</code><a href={host.help} target="_blank" rel="noreferrer">查看 {host.name} 官方说明 ↗</a><button className="journey-quiet" onClick={()=>void product.refresh()}>重新检查连接</button><a href="#settings">账户与连接设置</a></details>}
    <p className="journey-status" role="status">{message||product.error||(product.timedOut?'你可以继续在 AI 中操作，回来时我们会再检查。':'')}</p>
  </Welcome>;
}
