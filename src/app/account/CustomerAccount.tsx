import { Connections } from './Connections.tsx';
import { animate } from '../shell/motion.tsx';
import { clearPendingNotes, downloadPendingNotes, hasPendingNotes } from '../pages/notes-model.ts';
import { PRIVACY_VERSION } from '@lowkkey/protocol/constants';
import { Welcome } from './Welcome.tsx';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ClientPublic } from '@lowkkey/protocol';
import type { useShowroom } from '../shell/useShowroom.ts';
import { call, errorLabel, returnPath, type AuthConfig, type Account } from './customer-api.ts';
import { PushSection } from './Push.tsx';
export function LoginGate({
  chamber,
  preview = false,
}: { chamber: ReturnType<typeof useShowroom>; preview?: false } | { chamber?: never; preview: true }) {
  const isPreview = import.meta.env.DEV && preview;
  const [config, setConfig] = useState<AuthConfig | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (isPreview) {
      setConfig({ mode: 'customer', local: false, google: true, email: false });
      return;
    }
    const params = new URLSearchParams(location.search);
    if (params.has('deleted')) setError('账户已停用，资料清理已安排。清理完成后可以重新注册空档案。');
    if (params.has('authError'))
      setError(params.has('error') ? errorLabel(params.get('error')!) : '登录未完成，你可以重新选择账户。');
    void call('/api/auth/config')
      .then(setConfig)
      .catch(() => setError('暂时无法连接，请重试。'));
  }, [isPreview]);
  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(errorLabel((cause as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function intent() {
    await call('/api/privacy/intent', { version: PRIVACY_VERSION, accepted: true });
  }
  const privacyNotice = (
    <p className="login-privacy" id="login-privacy">
      继续即代表同意
      <a href="/privacy" target="_blank" rel="noreferrer">
        《隐私政策》
      </a>
    </p>
  );
  return (
    <Welcome variant="login" action={isPreview ? <span className="preview-label">设计预览</span> : undefined}>
      <h1 className="welcome-title">
        每一次训练，
        <br />
        都有下文。
      </h1>
      <p className="journey-copy">
        和你熟悉的 AI 聊训练。
        <br />
        计划、记录与变化，在这里接着写。
      </p>
      {config?.mode === 'customer' ? (
        <div className="welcome-login">
          {config.google && (
            <button
              className="journey-primary google-signin"
              aria-describedby="login-privacy"
              disabled={busy}
              onClick={() => {
                void perform(async () => {
                  if (isPreview) {
                    setError('这是登录页设计预览，不会发起 Google 登录或创建账户。');
                    return;
                  }
                  await intent();
                  const result = await call('/api/auth/sign-in/social', {
                    provider: 'google',
                    callbackURL: returnPath(),
                    errorCallbackURL: '/?authError=1&returnTo=' + encodeURIComponent(returnPath()) + '#Login',
                  });
                  location.assign(result.url);
                });
              }}
            >
              <img src="/brands/google.png" width="20" height="20" alt="" />
              <span>{busy ? '请稍候…' : '使用 Google 继续'}</span>
            </button>
          )}
          {config.google && privacyNotice}
          {!config.google && <p>登录暂时不可用，请稍后重试。</p>}
        </div>
      ) : config ? (
        <button className="journey-primary" disabled={!chamber || chamber.busy} onClick={() => void chamber?.login()}>
          打开我的展厅
        </button>
      ) : (
        <p className="journey-hint">正在准备登录…</p>
      )}
      {(error || chamber?.error) && (
        <p className="journey-status" role="alert">
          {error || chamber?.error}
        </p>
      )}
      {!config && error && (
        <button
          className="journey-quiet"
          disabled={busy}
          onClick={() => void perform(async () => setConfig(await call('/api/auth/config')))}
        >
          重试登录
        </button>
      )}
    </Welcome>
  );
}
export function CustomerAccount({
  chamber,
  onClose,
  returnFocusTo,
  onConnect,
  accountId,
}: {
  chamber: ReturnType<typeof useShowroom>;
  onClose: () => void;
  returnFocusTo: HTMLButtonElement | null;
  onConnect: () => void;
  accountId?: string;
}) {
  const [account, setAccount] = useState<Account | null>(null),
    [config, setConfig] = useState<AuthConfig | null>(null);
  const [clients, setClients] = useState<ClientPublic[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => Promise<void>) | null>(null);
  const [zone, setZone] = useState(''),
    [deleting, setDeleting] = useState(false),
    [confirmation, setConfirmation] = useState('');
  const panel = useRef<HTMLDivElement>(null),
    closing = useRef(false);
  const dialog = useRef<HTMLElement>(null),
    owner = accountId ?? chamber.state!.accountId;
  useLayoutEffect(() => {
    animate(panel.current, [{ opacity: 0 }, { opacity: 1 }], 280);
    animate(
      dialog.current,
      [
        { opacity: 0, transform: 'translateY(24px) scale(.985)' },
        { opacity: 1, transform: 'none' },
      ],
      320,
    );
  }, []);
  async function close(after = onClose) {
    if (closing.current) return;
    closing.current = true;
    const overlay = animate(
      panel.current,
      [{ opacity: getComputedStyle(panel.current!).opacity }, { opacity: 0 }],
      200,
    );
    const drawer = animate(
      dialog.current,
      [
        { transform: getComputedStyle(dialog.current!).transform, opacity: getComputedStyle(dialog.current!).opacity },
        { transform: 'translateY(28px) scale(.985)', opacity: 0 },
      ],
      200,
    );
    await Promise.all([overlay?.finished.catch(() => {}), drawer?.finished.catch(() => {})]);
    after();
  }
  // On a phone the sheet follows a downward drag on its heading and closes past 80px.
  const drag = useRef<{ y: number; id: number } | null>(null);
  const dragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || busy) return;
    drag.current = { y: event.clientY, id: event.pointerId };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic pointers cannot be captured; the drag still follows pointer ids. */
    }
  };
  const dragMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || event.pointerId !== drag.current.id || !dialog.current) return;
    dialog.current.style.transform = `translateY(${Math.max(0, event.clientY - drag.current.y)}px)`;
  };
  const dragEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || event.pointerId !== drag.current.id) return;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    if (dy > 80) {
      void close();
      return;
    }
    const settle = animate(
      dialog.current,
      [{ transform: `translateY(${Math.max(0, dy)}px)` }, { transform: 'translateY(0)' }],
      200,
    );
    if (settle)
      settle.onfinish = () => {
        dialog.current?.style.removeProperty('transform');
      };
    else dialog.current?.style.removeProperty('transform');
  };
  useEffect(() => {
    if (new URLSearchParams(location.search).has('authError'))
      setMessage(errorLabel(new URLSearchParams(location.search).get('error') ?? 'REQUEST_FAILED'));
    void Promise.all([
      call('/v1/account').then(value => {
        setAccount(value);
        setZone(value.timezone);
      }),
      call('/api/auth/config').then(setConfig),
      call('/v1/clients').then(setClients),
    ]).catch(() => setMessage('暂时无法读取账户。'));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void close();
      }
      if (event.key === 'Tab') {
        const nodes = [
          ...dialog.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),summary,a[href],input:not(:disabled),select:not(:disabled)',
          ),
        ].filter(node => node.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('keydown', keys);
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => returnFocusTo?.focus({ preventScroll: true }));
    };
  }, []);
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await task();
    } catch (cause) {
      if ((cause as Error).message === 'notes_pending') {
        setPendingLeave(() => task);
        return;
      }
      if ((cause as Error).message === 'reauth_required')
        setAccount(value => (value ? { ...value, fresh: false } : value));
      setMessage(errorLabel((cause as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function reauthenticate() {
    if (hasPendingNotes(owner)) throw new Error('notes_pending');
    await chamber.logout();
    location.assign('/?returnTo=' + encodeURIComponent('/#settings') + '#Login');
  }
  return (
    <div ref={panel} className="account-panel">
      <section ref={dialog} className="account-drawer" role="dialog" aria-modal="true" aria-label="设置">
        <header
          className="settings-heading"
          onPointerDown={dragStart}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
        >
          <h2>设置</h2>
          <button className="close-account" onClick={() => void close()}>
            完成
          </button>
        </header>
        <div className="settings-content">
          {(config?.aiConnection || clients.length > 0) && (
            <section className="settings-section">
              <h3>AI 连接</h3>
              <Connections
                clients={clients}
                busy={busy}
                onRevoke={selected =>
                  void run(async () => {
                    const results = await Promise.allSettled(
                      selected.map(client => call('/v1/clients/' + client.id + '/revoke', {}, owner)),
                    );
                    setClients(await call('/v1/clients'));
                    const failed = results.filter(r => r.status === 'rejected').length;
                    setMessage(
                      failed
                        ? `${selected.length - failed} 项已处理，${failed} 项未完成，请检查后重试。`
                        : '已断开所选授权。',
                    );
                  })
                }
              />
              {config?.aiConnection && (
                <details className="connection-help">
                  <summary>连接新的 AI</summary>
                  <p>连接 ChatGPT 或 Claude，让 AI 整理你的训练档案。</p>
                  <button onClick={() => void close(onConnect)}>打开连接引导</button>
                  <code className="connection-address">{location.origin}/mcp</code>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(location.origin + '/mcp');
                        setMessage('连接地址已复制。');
                      })
                    }
                  >
                    复制连接地址
                  </button>
                  <p className="settings-hint">
                    读取授权包括随手记原文。写入授权允许 AI
                    保存、修改和删除训练记录、计划与策展；“写随手记”需另外授权一次，AI
                    仅在你明确要求时转录、追加、改写或清空。撤销授权不会删除档案。
                  </p>
                  <p className="settings-hint">
                    lowkkey 增加新工具后，已连接的 AI 可能仍只看到旧的工具列表；在 AI 那边断开再重新连接一次即可。
                  </p>
                </details>
              )}
            </section>
          )}
          <section className="settings-section">
            <h3>数据</h3>
            <div className="settings-data-row">
              <p>
                {chamber.syncedAt && (
                  <>最近同步 {chamber.syncedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </p>
              <button disabled={chamber.refreshing} onClick={() => void chamber.refresh()}>
                {chamber.refreshing ? '同步中…' : '刷新'}
              </button>
            </div>
            <button
              className="export-records"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await call('/v1/export'),
                    url = URL.createObjectURL(
                      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                    ),
                    link = document.createElement('a');
                  link.href = url;
                  link.download = 'lowkkey-v5.json';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              导出我的记录
            </button>
          </section>
          <section className="settings-section">
            <h3>日期与时区</h3>
            <label>
              档案时区
              <select value={zone} onChange={e => setZone(e.target.value)}>
                {[...new Set([zone, ...Intl.supportedValuesOf('timeZone')])].filter(Boolean).map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !zone || zone === account?.timezone}
              onClick={() =>
                void run(async () => {
                  await call('/v1/account/preferences', { timezone: zone }, owner);
                  setAccount(await call('/v1/account'));
                  await chamber.refresh();
                  setMessage('时区已保存。历史记录的日期保持原样。');
                })
              }
            >
              保存时区
            </button>
          </section>
          <PushSection />
          <section className="settings-section">
            <h3>隐私</h3>
            <a className="privacy-settings-link" href="/privacy" target="_blank" rel="noreferrer">
              查看隐私政策 ↗
            </a>
            {account?.privacy?.acceptedAt && (
              <p>已于 {new Date(account.privacy.acceptedAt).toLocaleDateString('zh-CN')} 确认。</p>
            )}
          </section>
          <section className="settings-section">
            <h3>登录</h3>
            <p className="login-identity">{account?.email ?? '正在读取…'}</p>
            {account?.mode === 'customer' && <p className="settings-hint">使用 Google 登录</p>}
            <div className="settings-actions">
              {account?.mode === 'customer' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call('/api/auth/revoke-other-sessions', {});
                      setMessage('其他设备已退出。');
                    })
                  }
                >
                  退出其他设备
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (hasPendingNotes(owner)) throw new Error('notes_pending');
                    await chamber.logout();
                    onClose();
                  })
                }
              >
                退出登录
              </button>
            </div>
          </section>
          {account?.mode === 'customer' && (
            <section className="settings-section">
              <h3>注销账户</h3>
              <p className="settings-hint">
                注销会立即停用登录和所有 AI 连接，并删除训练档案。清理完成后可以重新注册，原有档案不会恢复。
              </p>
              {!deleting ? (
                <button disabled={busy} onClick={() => setDeleting(true)}>
                  注销我的账户
                </button>
              ) : (
                <div>
                  <p>请先导出需要保留的记录。输入 DELETE 确认注销。</p>
                  <label>
                    确认注销
                    <input value={confirmation} autoComplete="off" onChange={e => setConfirmation(e.target.value)} />
                  </label>
                  <button
                    disabled={busy || confirmation !== 'DELETE'}
                    onClick={() =>
                      void run(async () => {
                        if (!account.fresh) {
                          await reauthenticate();
                          return;
                        }
                        if (hasPendingNotes(owner)) throw new Error('notes_pending');
                        await call('/v1/account/delete', { confirm: 'DELETE' }, owner);
                        clearPendingNotes(owner);
                        localStorage.setItem('lowkkey-signout', String(Date.now()));
                        location.assign('/?deleted=1#Login');
                      })
                    }
                  >
                    {account.fresh ? '确认永久注销' : '重新登录以验证身份'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setDeleting(false);
                      setConfirmation('');
                    }}
                  >
                    取消
                  </button>
                </div>
              )}
            </section>
          )}
          {pendingLeave && (
            <section className="settings-section" role="region" aria-label="未同步的随手记">
              <h3>还有未同步的文字</h3>
              <p>先导出草稿，再继续退出或账户操作。也可以取消，回到随手记等待同步。</p>
              <div className="settings-actions">
                <button
                  onClick={() =>
                    void run(async () => {
                      downloadPendingNotes(owner);
                      clearPendingNotes(owner);
                      const action = pendingLeave;
                      setPendingLeave(null);
                      await action();
                    })
                  }
                >
                  导出草稿并继续
                </button>
                <button onClick={() => setPendingLeave(null)}>取消</button>
              </div>
            </section>
          )}
          <p role="status" className="settings-status">
            {message}
          </p>
        </div>
      </section>
    </div>
  );
}
