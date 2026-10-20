import { useCallback,useEffect,useRef,useState } from 'react';
import { OnboardingState, type OnboardingState as Setup } from '@lowkkey/protocol';
import { Welcome,ProviderMark } from './Welcome.tsx';
import { call,type Account } from './customer-api.ts';

const chatgptIntro='手机 App 中可能没有添加自定义连接的入口。请在电脑浏览器打开 ChatGPT，登录手机上同一个账号。';
export const aiHosts={
  claude:{name:'Claude',connect:'https://claude.ai/customize/connectors',chat:'https://claude.ai/new',steps:[
    {title:'添加一个连接',text:'打开 Customize → Connectors，选择添加自定义连接器。'},
    {title:'粘贴地址，确认连接',text:'名称填写 lowkkey，服务器地址粘贴下方地址。选择 OAuth 登录，使用你的 lowkkey 账户完成授权。'},
  ],help:'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'},
  chatgpt:{name:'ChatGPT',connect:'https://chatgpt.com/plugins',chat:'https://chatgpt.com/',steps:[
    {title:'在网页版添加',text:'打开 Plugins → ＋ → Add custom MCP server。名称填 lowkkey，Server URL 填下方 MCP 地址，认证选 OAuth。阅读提示后选择 Create as a plugin，并用你的 lowkkey 账户完成授权。'},
    {title:'安装到 ChatGPT',text:'创建连接后，还需要在个人插件列表里找到 lowkkey 并安装。仅完成授权，还不能确认已安装或可以调用。'},
    {title:'回到手机试一次',text:'使用同一个 ChatGPT 账号打开新对话，用 @ 选择 lowkkey，发送：“请读取我的 lowkkey 训练简报。”手机找不到插件时，先核对账号、工作区及安装状态，也可以先在网页版新建 Work 对话试用。'},
  ],help:'https://developers.openai.com/api/docs/guides/custom-mcp-server'},
};
// Client names are display metadata, not verified identities or permission checks.
// Never use an unrelated/latest grant as proof that the selected AI connected.
function matchesAI(client:Setup['clients'][number],ai:Setup['ai']){
  return ai==='chatgpt'?/\b(chatgpt|openai)\b/i.test(client.name):ai==='claude'?/\b(claude|anthropic)\b/i.test(client.name):false;
}
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
  const {setup,update}=product;
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[prompt,setPrompt]=useState(starter),[fallback,setFallback]=useState<string|null>(null),[openLink,setOpenLink]=useState<string|null>(null);
  const copyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const active=(setup?.clients??[]).filter(c=>c.status==='active'&&matchesAI(c,setup?.ai??null)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const current=active[0],recent=current&&setup?.connectionStartedAt&&current.createdAt>=setup.connectionStartedAt?current:undefined;
  const readOnly=!!current&&!current.scopes.includes('write'),isGPT=setup?.ai==='chatgpt';
  useEffect(()=>{const heading=document.querySelector<HTMLElement>('.journey h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}window.scrollTo({top:0});setMessage('');setFallback(null);setOpenLink(null);setPrompt(setup?.ai==='chatgpt'?'请读取我的 lowkkey 训练简报。':starter);if(copyTimer.current)clearTimeout(copyTimer.current);},[setup?.step,setup?.ai]);
  useEffect(()=>()=>{if(copyTimer.current)clearTimeout(copyTimer.current);},[]);
  useEffect(()=>{if(recent&&setup?.ai==='claude'&&setup.step==='guide')void update({step:'chat'}).catch(()=>{});},[recent?.id,setup?.step,setup?.ai]);
  async function run(task:()=>Promise<unknown>){if(busy)return;setBusy(true);setMessage('');try{await task();}catch{setMessage('暂时未能保存，请重试。');}finally{setBusy(false);}}
  async function copy(text:string,url?:string){
    if(busy)return;setBusy(true);setMessage('');setFallback(null);setOpenLink(null);
    if(copyTimer.current)clearTimeout(copyTimer.current);
    // Reserve the tab during the gesture; asynchronous clipboard work otherwise trips popup blockers.
    let tab:Window|null=null;
    if(url){try{tab=window.open('about:blank','_blank');if(tab)tab.opener=null;}catch{ /* Keep the direct link available. */ }setOpenLink(url);}
    try{
      await navigator.clipboard.writeText(text);setMessage('已复制');
      copyTimer.current=setTimeout(()=>setMessage(''),2400);
      if(tab&&url){try{tab.location.replace(url);}catch{tab.close();}}
    }catch{tab?.close();setFallback(text);setMessage('未能复制，请长按下方文字。');product.report('copy_failed');}
    finally{setBusy(false);}
  }
  const exit=()=>void run(async()=>{await update({skipped:true});onClose();});
  if(!setup)return <Welcome><h1>正在打开你的档案。</h1>{product.error&&<><p role="alert">{product.error}</p><button className="journey-quiet" onClick={()=>void product.refresh()}>重试</button></>}</Welcome>;
  const host=aiHosts[setup.ai??'claude'],step=setup.ai?setup.step:'choose',chat=step==='chat'&&!!current;
  const receipt=current&&<p className="connection-receipt" data-testid="connection-receipt">{current.firstReadAt?'已连接':'已授权'} · {current.name}{readOnly&&' · 当前只读'}</p>;
  return <Welcome action={<button className="journey-quiet" disabled={busy} onClick={exit}>稍后连接</button>} back={step==='choose'?undefined:()=>void run(()=>update({step:'choose'}))}>
    {step==='choose'?<>
      <p className="meta">让对话接上你的档案</p><h1>你习惯和谁聊？</h1><p className="journey-copy">连接一次，以后就在那里聊训练。<br/>整理好的内容，会留在这里。</p>
      <div className="ai-options">{(['chatgpt','claude'] as const).map(ai=><button key={ai} aria-label={aiHosts[ai].name} disabled={busy} onClick={()=>void run(()=>update({ai,step:'guide',skipped:false}))}><ProviderMark ai={ai}/><span>{aiHosts[ai].name}</span></button>)}</div>
      <p className="journey-hint">之后也可以连接另一个 AI，接着同一份档案聊。</p>
    </>:chat?<>
      <p className="meta">{current.firstReadAt?'已连接':'已授权'}</p><h1>接下来，和你的 AI 聊聊。</h1>
      <p className="journey-copy">{isGPT?'在 ChatGPT 中安装 lowkkey，即可开始。':'在对话的连接器菜单中启用 lowkkey。'}</p>
      <label className="starter-label" htmlFor="starter">你的第一句话</label><textarea id="starter" className="starter-input" value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4} maxLength={2000}/>
      <button className="journey-primary" disabled={busy||!prompt.trim()} onClick={()=>void copy(prompt,host.chat)}>复制开场白并打开 {host.name}</button>{receipt}
      <button className="journey-quiet" disabled={busy} onClick={()=>void product.refresh()}>重新检查连接</button>
      {readOnly&&<button className="journey-quiet" onClick={()=>void run(()=>update({ai:setup.ai??'claude',step:'guide'}))}>重新连接并允许保存</button>}
    </>:<>
      <div className="connection-host"><ProviderMark ai={setup.ai??'claude'}/><span>{host.name}</span></div>
      <h1>连接 {host.name}</h1><p className="journey-copy">请打开网页版连接。</p>
      <button className="journey-primary" disabled={busy} onClick={()=>void copy(location.origin+'/mcp',host.connect)}>复制地址并打开网页版</button>
      <button className="journey-quiet connection-copy" disabled={busy} onClick={()=>void copy(location.origin+'/mcp')}>仅复制地址</button>
      {receipt}{current&&<>{isGPT&&!current.firstReadAt&&<p className="journey-hint">在 ChatGPT 中安装 lowkkey，即可开始。</p>}<button className="journey-quiet" disabled={busy} onClick={()=>void run(()=>update({step:'chat'}))}>继续去聊天</button></>}
      <button className="journey-quiet" disabled={busy} onClick={()=>void product.refresh()}>重新检查连接</button>
    </>}
    {fallback!==null&&<div className="copy-fallback"><code>{fallback}</code></div>}
    {openLink&&<a className="journey-quiet" href={openLink} target="_blank" rel="noreferrer">打开 {host.name} 网页版 ↗</a>}
    <p className="journey-status" role="status">{message||product.error||(product.timedOut?'进度已保留，可以稍后继续。':'')}</p>
    <div className="notes-entry"><button className="journey-quiet" disabled={busy} onClick={onNotes}>先随手记</button><p className="journey-hint">可以先记录，之后再连接 AI。</p></div>
    {step!=='choose'&&<details className="journey-help" onToggle={e=>{if(e.currentTarget.open)product.report('connection_help');}}><summary>连接帮助</summary>
      <p>{isGPT?chatgptIntro:'在 Claude 网页版添加连接。'}授权时使用与你的 lowkkey 档案相同的 Google 账户。</p>
      <code className="connection-address">{location.origin}/mcp</code><ol>{host.steps.map(s=><li key={s.title}>{s.title}：{s.text}</li>)}</ol>
      <p>只读连接不能保存训练；需要时重新授权写入。转录到随手记需另外勾选“写随手记”。组织账户可能需要管理员允许。</p>
      <p>授权名称不同可能无法自动识别，请在设置中核对。打开网页不代表连接已完成。</p>
      <a href={host.connect} target="_blank" rel="noreferrer">打开 {host.name} 网页版 ↗</a><a href={host.help} target="_blank" rel="noreferrer">查看 {host.name} 官方说明 ↗</a><a href="#settings">账户与连接设置</a>
    </details>}
  </Welcome>;
}
