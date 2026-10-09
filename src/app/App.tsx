import { useEffect, useMemo, useRef, useState } from 'react';
import { currentContext, strengthSeries } from '@lowkkey/core';
import { screenFromHash, screens, targetFromHash } from './navigation.ts';
import { useShowroom } from './useShowroom.ts';
import { LoginGate, CustomerAccount } from './CustomerAccount.tsx';
import { PlanView } from './PlanView.tsx';
import { GalleryView } from './GalleryView.tsx';
import { WeightView } from './WeightView.tsx';
import { applyPageTheme } from './viewport.ts';
import { installPressFeedback } from './press-feedback.ts';

const labels = { Plan: '下次练什么', Gallery: '训练展厅', Weight: '体重' };
export function App() {
  const chamber = useShowroom(), [screen, setScreen] = useState(screenFromHash), [accountOpen, setAccountOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState(targetFromHash);
  const series = useMemo(() => chamber.state ? strengthSeries(chamber.state) : [], [chamber.state]);
  const context = useMemo(() => currentContext(chamber.state?.plans ?? []), [chamber.state]);
  useEffect(() => { applyPageTheme(); return installPressFeedback(document.getElementById('root')!); }, []);
  useEffect(() => {
    const change = () => { setScreen(screenFromHash()); setTarget(targetFromHash()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (chamber.auth !== 'ready' || !target) return;
    document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [chamber.auth, screen, target]);
  if (chamber.auth !== 'ready' || !chamber.state) return <LoginGate chamber={chamber}/>;
  return <div className="showroom">
    <div className="showroom-content" inert={accountOpen}>
    <header className="masthead"><div className="masthead-top"><a className="wordmark" href="#Plan">lowkkey<span className="brand-dot">.</span></a><span className="masthead-caption">私人训练档案</span><button ref={settingsTrigger} className="account-link" onClick={() => setAccountOpen(true)} aria-haspopup="dialog" aria-expanded={accountOpen}>设置</button></div>
      <nav aria-label="主导航">{screens.map(key => <a key={key} href={'#' + key} aria-current={screen === key ? 'page' : undefined}>{labels[key]}</a>)}</nav>
    </header>
    {chamber.error && <div className="connection-notice" role="alert">{chamber.error}<button onClick={() => void chamber.refresh()}>重试</button></div>}
    <main key={chamber.state.accountId + screen} className="canvas" data-screen={screen}>
      {screen === 'Plan' && <PlanView plans={chamber.state.plans}/>}
      {screen === 'Gallery' && <GalleryView facts={chamber.state} series={series}/>}
      {screen === 'Weight' && <WeightView weights={chamber.state.weights} target={context.gain_target}/>}
    </main>
    <footer className="colophon"><span>lowkkey.</span><div className="sync-status"><span aria-live="polite">{chamber.syncedAt && <>最近同步 <time dateTime={chamber.syncedAt.toISOString()}>{chamber.syncedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></>}</span><button onClick={() => void chamber.refresh()} disabled={chamber.refreshing}>{chamber.refreshing ? '同步中…' : '刷新'}</button></div></footer>
    </div>
    {accountOpen && <CustomerAccount chamber={chamber} onClose={() => setAccountOpen(false)} returnFocusTo={settingsTrigger.current}/>}
  </div>;
}
