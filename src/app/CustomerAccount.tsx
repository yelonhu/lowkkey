import { useEffect, useRef, useState } from 'react';
import type { ClientPublic } from '@lowkkey/protocol';
import type { useShowroom } from './useShowroom.ts';
type AuthConfig = { mode: string; local: boolean; google: boolean; email: boolean; aiConnection?: boolean };
async function call(path: string, body?: unknown, owner?: string) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', ...(owner ? { 'X-Lowkkey-Account': owner } : {}) } : {},
    body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (!response.ok) throw new Error(value.code ?? value.error?.code ?? 'REQUEST_FAILED');
  return value;
}
const labels: Record<string,string> = { INVITATION_REQUIRED: '目前仅向受邀用户开放。请使用受邀邮箱。', INVALID_OTP: '验证码不正确，请重试。', OTP_EXPIRED: '验证码已过期，请重新获取。', MAIL_UNAVAILABLE: '邮件暂时未能发出，请稍后重试。', ACCOUNT_NOT_LINKED: '请先用邮箱验证码登录，再在设置中绑定 Google。' };
function returnPath() {
  const path = new URLSearchParams(location.search).get('returnTo');
  if (path?.startsWith('/authorize?')) return path;
  return ['Plan','Gallery','Weight'].includes(location.hash.slice(1).split('?')[0]) ? '/' + location.hash : '/#Plan';
}
export function LoginGate({ chamber }: { chamber: ReturnType<typeof useShowroom> }) {
  const [config,setConfig] = useState<AuthConfig | null>(null), [email,setEmail] = useState(''), [otp,setOtp] = useState(''), [sent,setSent] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(() => {
    if (new URLSearchParams(location.search).has('authError')) setError('登录未完成。请使用受邀 Google 邮箱重试。');
    void call('/api/auth/config').then(setConfig).catch(() => setError('暂时无法连接，请重试。'));
  }, []);
  async function perform(task: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { await task(); } catch (cause) { setError(labels[(cause as Error).message] ?? '暂时未能完成，请重试。'); } finally { setBusy(false); }
  }
  return <main className="access-gate"><div>lowkkey.</div><h1>{chamber.auth === 'loading' ? '正在打开你的档案。' : '欢迎回来。'}</h1>
    {config?.mode === 'customer' ? <><p>使用受邀邮箱，打开你的训练档案。</p>
      {config.google && <button disabled={busy} onClick={() => void perform(async () => { const result = await call('/api/auth/sign-in/social', { provider: 'google', callbackURL: returnPath(), errorCallbackURL:'/?authError=1#Login' }); location.assign(result.url); })}>使用 Google 继续</button>}
      {config.email && <form onSubmit={event => { event.preventDefault(); void perform(async () => {
        if (sent) { await call('/api/auth/sign-in/email-otp', { email,otp }); location.assign(returnPath()); }
        else { await call('/api/auth/email-otp/send-verification-otp', { email,type:'sign-in' }); setSent(true); }
      }); }}>
        <label>邮箱<input type="email" autoComplete="email" required value={email} disabled={busy || sent} onChange={event => setEmail(event.target.value)}/></label>
        {sent && <label>验证码<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={event => setOtp(event.target.value)}/></label>}
        <button disabled={busy || !config.email}>{busy ? '请稍候…' : sent ? '登录' : '获取验证码'}</button>
        {sent && <button type="button" disabled={busy} onClick={() => { setSent(false); setOtp(''); }}>重新获取或更换邮箱</button>}
      </form>}
      {!config.email && !config.google && <p>登录暂时不可用，请稍后重试。</p>}</> : <><p>训练安排、记录与长期趋势。</p>{chamber.auth === 'required' && <button disabled={chamber.busy} onClick={() => void chamber.login()}>打开我的展厅</button>}</>}
    {(error || chamber.error) && <p role="alert">{error || chamber.error}</p>}
    {chamber.auth === 'loading' && chamber.error && <button onClick={() => void chamber.refresh()}>重试</button>}
  </main>;
}
export function CustomerAccount({ chamber,onClose,returnFocusTo }: { chamber: ReturnType<typeof useShowroom>; onClose: () => void; returnFocusTo: HTMLButtonElement | null }) {
  const [account,setAccount] = useState<{email: string; mode: string} | null>(null), [config,setConfig] = useState<AuthConfig | null>(null);
  const [clients,setClients] = useState<ClientPublic[]>([]), [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null), owner = chamber.state!.accountId;
  useEffect(() => {
    void Promise.all([call('/v1/account').then(setAccount), call('/api/auth/config').then(setConfig), call('/v1/clients').then(setClients)]).catch(() => setMessage('暂时无法读取账户。'));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),summary,a[href]')].filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown',keys);
    return () => { document.removeEventListener('keydown',keys); document.body.style.overflow = overflow; returnFocusTo?.focus(); };
  }, []);
  async function run(task: () => Promise<void>) {
    if (busy) return; setBusy(true); setMessage('');
    try { await task(); } catch { setMessage('操作未完成，请重试。'); } finally { setBusy(false); }
  }
  return <div className="account-panel"><section ref={dialog} className="account-drawer" role="dialog" aria-modal="true" aria-label="设置">
    <header className="settings-heading"><h2>设置</h2><button className="close-account" onClick={onClose}>完成</button></header>
    {(config?.aiConnection || clients.length > 0) && <section className="settings-section"><h3>AI 连接</h3>
      {config?.aiConnection && <><p>在 Claude 或其他支持 MCP 的 AI 中添加此地址，登录后即可连接。</p><code className="connection-address">{location.origin}/mcp</code><button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(location.origin + '/mcp'); setMessage('连接地址已复制。'); })}>复制连接地址</button><p className="settings-hint">写入授权允许 AI 直接保存记录与计划，同日记录会覆盖更新。</p></>}
      {clients.map(client => <div className="client-row" key={client.id}><div><span>{client.name}</span><small>{client.status === 'revoked' ? '已撤销' : client.scopes.map(scope => scope === 'write' ? '直接写入' : '读取').join(' · ')}</small></div>
        {client.status === 'active' && <button disabled={busy} onClick={() => void run(async () => { await call('/v1/clients/' + client.id + '/revoke',{},owner); setClients(await call('/v1/clients')); })}>撤销授权</button>}</div>)}
    </section>}
    <section className="settings-section"><h3>数据</h3><p>下载训练、体重与计划的完整记录。</p>
      <button disabled={busy} onClick={() => void run(async () => { const result = await call('/v1/export'), url = URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})), link = document.createElement('a'); link.href = url; link.download = 'lowkkey-showroom.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); })}>导出我的记录</button>
    </section>
    <section className="settings-section"><h3>登录</h3><p className="login-identity">{account?.email ?? '正在读取…'}</p><div className="settings-actions">
      {account?.mode === 'customer' && <><button disabled={busy} onClick={() => void run(async () => { await call('/api/auth/revoke-other-sessions',{}); setMessage('其他设备已退出。'); })}>退出其他设备</button>
        {config?.google && config.email && <button disabled={busy} onClick={() => void run(async () => { const result = await call('/api/auth/link-social',{ provider:'google',callbackURL:'/#Plan' }); location.assign(result.url); })}>绑定 Google 登录</button>}</>}
      <button disabled={busy} onClick={() => void run(async () => { await chamber.logout(); onClose(); })}>退出登录</button>
    </div></section><p role="status" className="settings-status">{message}</p>
  </section></div>;
}
