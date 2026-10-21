import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePageSwipe } from './usePageSwipe.ts';
import {
  animate,
  PageTabs,
  useArrivalMotion,
  useMotion,
  useFactMotion,
  usePullRefresh,
  useRecordMotion,
} from './motion.tsx';
import { installPressFeedback } from './press-feedback.ts';
import { screenFromHash, screens, targetFromHash, type Screen } from './navigation.ts';
import { useShowroom } from './useShowroom.ts';
import { applyPageTheme, themeNames } from './theme.ts';
import { useNotes } from '../pages/useNotes.ts';
import { NotesView } from '../pages/NotesView.tsx';
import { BoardView } from '../pages/BoardView.tsx';
import { RecapView } from '../pages/RecapView.tsx';
import { WeightView } from '../pages/WeightView.tsx';
import { LogView } from '../pages/LogView.tsx';
import { CustomerAccount, LoginGate } from '../account/CustomerAccount.tsx';
import { aiHosts, Onboarding, useProduct } from '../account/Onboarding.tsx';
import { ConsentGate } from '../account/Privacy.tsx';
import { SessionLoading } from '../account/Welcome.tsx';

export function Showroom() {
  const chamber = useShowroom();
  const [screen, setScreen] = useState(screenFromHash);
  const [settings, setSettings] = useState(location.hash === '#settings');
  const [target, setTarget] = useState(targetFromHash);
  const [focus, setFocus] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ready = chamber.auth === 'ready' && !!chamber.state;
  const notes = useNotes(
    ready ? chamber.state?.accountId : undefined,
    chamber.state?.today,
    screen === 'notes' || screen === 'log',
  );
  useMotion();
  useFactMotion(chamber.state, screen);
  useRecordMotion(chamber.state, screen);
  const [starting, setStarting] = useState(location.hash === '#start');
  const product = useProduct(chamber.state?.accountId, chamber.refresh, starting);
  const positions = useRef<Partial<Record<Screen, number>>>({}),
    activeScreen = useRef(screen);
  const swipeCompleted = useRef(false);
  const showingOnboarding =
    screen !== 'notes' &&
    (starting ||
      (!product.setup &&
        !chamber.state?.sessions.length &&
        !chamber.state?.plans.length &&
        !chamber.state?.weights.length));
  const interactive = ready && !settings && !showingOnboarding;
  const swipeViewport = usePageSwipe(screen, interactive, chamber.state?.accountId, positions, swipeCompleted);
  usePullRefresh(interactive, chamber.refresh);
  useArrivalMotion(interactive, screen, chamber.state?.accountId, swipeCompleted);
  useEffect(() => installPressFeedback(document.body), []);
  useEffect(() => {
    if (chamber.refreshing) document.documentElement.dataset.syncing = '';
    else delete document.documentElement.dataset.syncing;
  }, [chamber.refreshing]);

  // Returning to a page restores its reading position and fades it in; the first visit is handled by the arrival motion.
  const pageMotion = useRef<Animation | null>(null),
    lastPage = useRef<Screen | null>(null),
    visited = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!ready || !chamber.state) return;
    if (lastPage.current === screen) return;
    lastPage.current = screen;
    if (!target) window.scrollTo({ top: positions.current[screen] ?? 0, behavior: 'instant' });
    pageMotion.current?.cancel();
    const key = chamber.state.accountId + ':' + screen,
      first = !visited.current.has(key);
    visited.current.add(key);
    if (screen !== 'notes' && !swipeCompleted.current && !first)
      pageMotion.current = animate(document.getElementById('v-' + screen), [
        { opacity: 0.65, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ]);
    swipeCompleted.current = false;
  }, [screen, ready, chamber.state, target]);

  const targetPositioned = useRef<string | null>(null);
  const awaitingFirstContent = useRef(false);
  useEffect(() => {
    if (!product.setup) {
      awaitingFirstContent.current = false;
      return;
    }
    if (!product.setup.hasContent && !product.setup.completedAt) awaitingFirstContent.current = true;
    else if (awaitingFirstContent.current && location.hash !== '#settings' && screen !== 'notes') {
      awaitingFirstContent.current = false;
      const receipt = new URL(product.setup.firstViewUrl ?? '/#next', location.origin);
      if (receipt.origin === location.origin && receipt.hash) location.hash = receipt.hash;
      setStarting(false);
      void chamber.refresh();
    }
  }, [product.setup, chamber.refresh]);
  useEffect(() => {
    if (
      location.hash !== '#settings' &&
      screen !== 'notes' &&
      product.setup &&
      !product.setup.hasContent &&
      !product.setup.completedAt &&
      !product.setup.skippedAt
    )
      setStarting(true);
  }, [product.setup]);
  useEffect(() => {
    const route = () => {
      targetPositioned.current = null;
      setStarting(location.hash === '#start');
      const next = screenFromHash();
      positions.current[activeScreen.current] = window.scrollY;
      activeScreen.current = next;
      setScreen(next);
      setTarget(targetFromHash());
      if (location.hash === '#settings') setSettings(true);
    };
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, []);
  useEffect(() => {
    const saved = () => {
      awaitingFirstContent.current = false;
      setStarting(false);
      void product.refresh();
    };
    window.addEventListener('lowkkey-notes-saved', saved);
    return () => window.removeEventListener('lowkkey-notes-saved', saved);
  }, [product.refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = chamber.state?.theme_state.active ?? 'ink';
    applyPageTheme();
    const media = matchMedia('(prefers-color-scheme:dark)');
    media.addEventListener('change', applyPageTheme);
    return () => media.removeEventListener('change', applyPageTheme);
  }, [chamber.state?.theme_state.active]);
  useEffect(() => {
    if (!target || !chamber.state) return;
    const key = chamber.state.accountId + ':' + target;
    if (targetPositioned.current === key) return;
    const element = document.getElementById(target);
    if (!element) return;
    if (element instanceof HTMLDetailsElement) element.open = true;
    element.scrollIntoView({ block: 'start' });
    targetPositioned.current = key;
  }, [target, screen, chamber.state]);

  // A door copies one sentence and opens the user's AI; the conversation stays there.
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number>(0);
  const ai = product.setup?.ai ?? null;
  const door = useCallback(
    (text: string) => {
      if (!ai) {
        location.hash = 'start';
        return;
      }
      const host = aiHosts[ai];
      let tab: Window | null = null;
      try {
        tab = window.open('about:blank', '_blank');
        if (tab) tab.opener = null;
      } catch {
        /* Popups may be blocked; the copy still happens. */
      }
      const show = (message: string) => {
        setToast(message);
        clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(''), 2600);
      };
      navigator.clipboard.writeText(text).then(
        () => {
          show('已复制这句话，去 ' + host.name + ' 粘贴');
          if (tab) tab.location.replace(host.chat);
        },
        () => {
          tab?.close();
          show('未能复制，去 ' + host.name + ' 直接说也可以');
        },
      );
    },
    [ai],
  );
  if (chamber.auth === 'loading') return <SessionLoading error={chamber.error} retry={chamber.refresh} />;
  if (chamber.auth === 'consent') return <ConsentGate chamber={chamber} />;
  if (chamber.auth !== 'ready' || !chamber.state) return <LoginGate chamber={chamber} />;
  if (!settings && showingOnboarding)
    return (
      <Onboarding
        product={product}
        onNotes={() => {
          setStarting(false);
          location.hash = 'notes';
        }}
        onClose={() => {
          setStarting(false);
          if (location.hash === '#start') location.hash = 'next';
          void chamber.refresh();
        }}
      />
    );

  const facts = chamber.state,
    today = facts.today,
    theme = facts.theme_state;
  const mood = theme.reason ? { name: themeNames[theme.active], why: theme.reason } : null;
  const resumeSetup = screen !== 'notes' && product.setup && !product.setup.hasContent && !product.setup.completedAt;
  return (
    <>
      <div className="showroom-content" inert={settings}>
        <div key={theme.active} className="sky" aria-hidden="true" />
        <div id="pull" className="pull" aria-hidden="true">
          <i />
        </div>
        <div className="wrap brandrow">
          <button
            ref={trigger}
            className="brand"
            aria-label="lowkkey，打开设置"
            aria-haspopup="dialog"
            aria-expanded={settings}
            onClick={() => setSettings(true)}
          >
            lowkkey
          </button>
          {mood && (
            <span className="mood" title={`本周主题 ${mood.name}：${mood.why}`}>
              <i className="mark" />
              <b>{mood.name}</b>
              <span>{mood.why}</span>
            </span>
          )}
        </div>
        <div className="navbar">
          <PageTabs screen={screen} />
        </div>
        {chamber.error && (
          <div className="wrap connection-notice" role="alert">
            {chamber.error}
            <button onClick={() => void chamber.refresh()}>重试</button>
          </div>
        )}
        {resumeSetup && (
          <div className="wrap setup-resume">
            <button onClick={() => setStarting(true)}>继续连接 AI，开始第一段对话</button>
          </div>
        )}
        <div ref={swipeViewport} className="page-viewport">
          {screens.map(key => (
            <main
              key={facts.accountId + key}
              hidden={key !== screen}
              inert={key !== screen}
              className={'wrap pg' + (key === 'next' ? ' next' : '')}
              id={'v-' + key}
            >
              {key === 'next' ? (
                <BoardView facts={facts} today={today} door={door} />
              ) : key === 'recap' ? (
                <RecapView facts={facts} today={today} focus={focus} setFocus={setFocus} />
              ) : key === 'body' ? (
                <WeightView facts={facts} today={today} />
              ) : key === 'notes' && notes ? (
                <NotesView
                  model={notes}
                  today={today}
                  target={screen === 'notes' ? target : null}
                  active={screen === 'notes'}
                />
              ) : (
                <LogView facts={facts} />
              )}
            </main>
          ))}
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {settings && (
        <CustomerAccount
          chamber={chamber}
          onConnect={() => {
            setSettings(false);
            setStarting(true);
            location.hash = 'start';
          }}
          onClose={() => setSettings(false)}
          returnFocusTo={trigger.current}
        />
      )}
    </>
  );
}
