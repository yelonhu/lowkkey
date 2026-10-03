import { useEffect, useRef, useState } from 'react';
import type { useHandoff } from './useHandoff.ts';
type AuthConfig={mode:string;local:boolean;google:boolean;email:boolean;aiConnection?:boolean};
async function call(path:string,body?:unknown){
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const value=await response.json();if(!response.ok)throw new Error(value.code??value.error?.code??'REQUEST_FAILED');return value;
}
const labels:Record<string,string>={INVITATION_REQUIRED:'目前仅向受邀用户开放。请使用受邀邮箱。',INVALID_OTP:'验证码不正确，请重试。',OTP_EXPIRED:'验证码已过期，请重新获取。',MAIL_UNAVAILABLE:'邮件暂时未能发出，请稍后重试。',ACCOUNT_NOT_LINKED:'请先用邮箱验证码登录，再在账户中绑定 Google。'};
function returnPath(){const path=new URLSearchParams(location.search).get('returnTo');return path?.startsWith('/authorize?')?path:`/${location.hash&&location.hash!=='#Login'?location.hash:'#Main'}`;}
export function LoginGate({chamber}:{chamber:ReturnType<typeof useHandoff>}){
  const [config,setConfig]=useState<AuthConfig|null>(null),[email,setEmail]=useState(''),[otp,setOtp]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void call('/api/auth/config').then(setConfig).catch(()=>setError('暂时无法连接，请重试。'));},[]);
  async function perform(task:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await task();}catch(cause){setError(labels[(cause as Error).message]??'暂时未能完成，请重试。');}finally{setBusy(false);}}
  return <main className="access-gate"><div>lowkkey</div><h1>{chamber.auth==='loading'?'正在连接状态舱':'欢迎回来。'}</h1>
    {config?.mode==='customer'?<><p>用受邀邮箱登录，你的记录会一直在这里。</p>
      {config.google&&<button disabled={busy} onClick={()=>void perform(async()=>{const result=await call('/api/auth/sign-in/social',{provider:'google',callbackURL:returnPath()});location.assign(result.url);})}>使用 Google 继续</button>}
      <form onSubmit={event=>{event.preventDefault();void perform(async()=>{if(sent){await call('/api/auth/sign-in/email-otp',{email,otp});location.assign(returnPath());}else{await call('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'});setSent(true);}});}}>
        <label>邮箱<input type="email" autoComplete="email" required value={email} disabled={busy||sent} onChange={event=>setEmail(event.target.value)}/></label>
        {sent&&<label>验证码<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={event=>setOtp(event.target.value)}/></label>}
        <button disabled={busy||!config.email}>{busy?'请稍候…':sent?'登录':'获取验证码'}</button>
        {sent&&<button type="button" disabled={busy} onClick={()=>{setSent(false);setOtp('');}}>重新获取或更换邮箱</button>}
        {!config.email&&<p>邮箱登录尚未配置。</p>}
      </form></>:<><p>查看训练安排，留下今天的记录。</p>{chamber.auth==='required'&&<button disabled={chamber.busy} onClick={()=>void chamber.login()}>进入状态舱 ↗</button>}</>}
    {(error||chamber.error)&&<p role="alert">{error||chamber.error}</p>}
    {chamber.auth==='loading'&&chamber.error&&<button onClick={()=>void chamber.refresh()}>重试</button>}
  </main>;
}
export function CustomerAccount({chamber,onClose}:{chamber:ReturnType<typeof useHandoff>;onClose:()=>void}){
  const [account,setAccount]=useState<{email:string;mode:string}|null>(null),[config,setConfig]=useState<AuthConfig|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const dialog=useRef<HTMLElement>(null);
  useEffect(()=>{void call('/v1/account').then(setAccount).catch(()=>setMessage('暂时无法读取账户。'));void call('/api/auth/config').then(setConfig).catch(()=>{});const prior=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();const keys=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();}if(e.key==='Tab'){const items=[...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',keys);return()=>{document.removeEventListener('keydown',keys);prior?.focus();};},[]);
  async function run(task:()=>Promise<void>){if(busy)return;setBusy(true);try{await task();}catch{setMessage('操作未完成，请重试。');}finally{setBusy(false);}}
  return <div className="formula-scrim account-panel"><section ref={dialog} className="formula-drawer" role="dialog" aria-modal="true" aria-label="账户"><button onClick={onClose}>完成</button><h2>我的账户</h2><p>{account?.email??'正在读取…'}</p>
    {account?.mode==='customer'&&<><button disabled={busy} onClick={()=>void run(async()=>{await call('/api/auth/revoke-other-sessions',{});setMessage('其他设备已退出。');})}>退出其他设备</button>
      {config?.google&&<button disabled={busy} onClick={()=>void run(async()=>{const result=await call('/api/auth/link-social',{provider:'google',callbackURL:'/#Connect'});location.assign(result.url);})}>绑定 Google 登录</button>}</>}
    {config?.aiConnection&&<details><summary>连接 Claude</summary><p>在 Claude 的设置 → 连接器中添加自定义连接，填入下方地址，然后登录 lowkkey 并选择权限。客户端是否提供此入口取决于你的账户。</p><input aria-label="连接地址" readOnly value={`${location.origin}/mcp`} onFocus={e=>e.target.select()}/><button onClick={()=>void run(async()=>{await navigator.clipboard.writeText(`${location.origin}/mcp`);setMessage('连接地址已复制。');})}>复制连接地址</button><p>提交后的记录和计划仍需要你确认。</p></details>}
    <button disabled={busy} onClick={()=>void run(async()=>{const result=await call('/v1/export'),url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='lowkkey-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}>导出我的记录</button>
    <button disabled={busy} onClick={()=>void run(async()=>{await chamber.logout();onClose();})}>退出登录</button><p role="status">{message}</p>
  </section></div>;
}
