import { useEffect, useState } from 'react';
import { PRIVACY_VERSION } from '@lowkkey/protocol';
import { Welcome } from './Welcome.tsx';
import { call, type Account, returnPath, errorLabel } from './customer-api.ts';
import type { useShowroom } from './useShowroom.ts';
import { CustomerAccount } from './CustomerAccount.tsx';
export function PrivacyCheck({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="privacy-check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        我已阅读并同意
        <a href="/privacy" target="_blank" rel="noreferrer">
          《隐私政策》
        </a>
      </span>
    </label>
  );
}
export function PrivacyPage() {
  const [contact, setContact] = useState<string | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    void call('/api/privacy')
      .then(v => setContact(v.contact))
      .catch(() => setError(true));
  }, []);
  return (
    <Welcome
      action={
        <a className="journey-quiet" href="/">
          回到 lowkkey
        </a>
      }
    >
      <p className="meta">版本 {PRIVACY_VERSION}</p>
      <h1>你的档案，由你掌握。</h1>
      <article className="privacy-document">
        <p>这份隐私政策说明 lowkkey 如何保存和使用你的资料。lowkkey 是一份由你授权的 AI 帮助维护的训练档案。</p>
        <h2>我们保存什么</h2>
        <p>
          登录需要的账户身份（邮箱、名称）、会话与授权信息；你或你授权的 AI
          保存的随手记原文、训练计划、训练组、体重、身体备注、训练背景、偏好与 AI
          批注。我们还保存时区、主题、隐私确认版本及时间。
        </p>
        <p>
          连接和首次使用的事件会记录时间与错误码，帮助判断登录、授权、读取、保存和返回查看是否成功。这些事件不记录聊天内容或令牌。
        </p>
        <h2>AI 怎样使用档案</h2>
        <p>
          只有你授权的连接能按所授予的权限读取或写入档案。读取权限包括已同步的随手记原文；普通写入授权不包含随手记。另行授予“写随手记”权限后，AI
          可按你在对话中的明确要求转录、追加、改写或清空正文；服务端检查权限与版本，对话意图由 AI
          遵守。写入权限包括保存、更正和删除记录、计划及策展。AI 对话发生在你选择的平台；lowkkey
          不主动抓取完整对话，但你或 AI 通过工具提交的内容会保存到档案。
        </p>
        <p>
          AI 平台收到的档案数据由该平台按其政策处理。撤销 lowkkey
          授权会停止后续访问，不会自动删除已发送到其他平台的内容。
        </p>
        <h2>服务提供方</h2>
        <p>
          lowkkey 使用 Cloudflare 托管服务及数据库处理和保存资料；Google 用于你选择的 Google 登录。页面字体通过 Google
          Fonts 加载，浏览器会向该服务发送常规网络请求。相关服务可能在不同地区处理数据。
        </p>
        <h2>保存与保护</h2>
        <p>
          档案保留至你删除相应内容或注销账户。登录与 AI
          授权使用有期限的会话和令牌；网页会按账户在本机保存尚未同步的随手记草稿，以便断网或刷新后恢复；云端确认后移除草稿。退出前如有未同步文字，可以先导出或取消退出。其他私人
          API 数据不作持久缓存。我们按账户隔离资料，但无法保证任何系统绝对安全。
        </p>
        <h2>你的选择</h2>
        <p>
          你可以在设置中查看或撤销 AI 连接、导出记录、退出其他设备，以及注销账户。注销会先停用账户和 AI
          授权，再清理业务与认证数据；清理失败会重试。清理完成后可以使用 Google 重新注册空档案；旧资料和 AI
          授权不会恢复。已由第三方平台接收的数据需在对应平台管理。
        </p>
        <h2>更新与联系</h2>
        <p>
          政策更新会提供新版本并在需要时请你重新确认。
          {contact ? (
            <>
              <a href={'mailto:' + contact}>联系 {contact}</a>，可以提出隐私或资料处理请求。
            </>
          ) : error ? (
            '联系信息暂时无法加载，请刷新重试。'
          ) : (
            '此环境尚未配置隐私联系邮箱，正式开放前会补齐。'
          )}
        </p>
      </article>
    </Welcome>
  );
}
export function ConsentGate({ chamber }: { chamber: ReturnType<typeof useShowroom> }) {
  const [account, setAccount] = useState<Account | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [settings, setSettings] = useState(false);
  async function load() {
    try {
      setAccount(await call('/v1/account'));
      setError('');
    } catch (cause) {
      if ((cause as Error).message === 'unauthorized') await chamber.refresh();
      else setError('账户暂时无法读取，请重试。');
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function accept() {
    if (!checked || !account || busy) return;
    setBusy(true);
    setError('');
    try {
      await call('/v1/account/consent', { version: PRIVACY_VERSION, accepted: true }, account.accountId);
      const path = returnPath();
      if (path.startsWith('/authorize?')) location.assign(path);
      else await chamber.refresh();
    } catch (cause) {
      setError(errorLabel((cause as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Welcome
        action={
          <button className="journey-quiet" onClick={() => setSettings(true)} disabled={!account}>
            账户
          </button>
        }
      >
        <p className="meta">继续之前</p>
        <h1>你的档案，由你掌握。</h1>
        <p className="journey-copy">了解我们怎样保存资料，以及你授权的 AI 如何使用它们。</p>
        <p className="identity-line">{account?.email ?? '正在读取账户…'}</p>
        <PrivacyCheck checked={checked} onChange={setChecked} />
        <button className="journey-primary" disabled={!checked || !account || busy} onClick={() => void accept()}>
          {busy ? '正在保存…' : '同意并继续'}
        </button>
        <p className="journey-hint">也可以在账户中导出资料或注销，或退出登录。</p>
        {!account && error && (
          <button className="journey-quiet" onClick={() => void load()}>
            重试
          </button>
        )}
        <p className="journey-status" role="alert">
          {error}
        </p>
      </Welcome>
      {settings && account && (
        <CustomerAccount
          chamber={chamber}
          accountId={account.accountId}
          onClose={() => setSettings(false)}
          returnFocusTo={null}
          onConnect={() => setSettings(false)}
        />
      )}
    </>
  );
}
