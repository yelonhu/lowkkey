import { useEffect, useState } from 'react';
import { call } from './customer-api.ts';
import { base64urlBytes, isApple, isStandalone } from './device.ts';

type State = 'checking' | 'unsupported' | 'home-screen' | 'denied' | 'off' | 'on';

/**
 * 信到了. One quiet switch: when the AI writes a letter or a medal lands, the pod says so once,
 * at most three times a week. Shown only where it can work: a registered service worker, a
 * configured server, and on an iPhone, the app opened from the home screen.
 */
export function PushSection() {
  const [state, setState] = useState<State>('checking'),
    [key, setKey] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
        return setState('unsupported');
      const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      if (!registration) return setState('unsupported');
      const status = (await call('/v1/push').catch(() => null)) as { key: string | null } | null;
      if (!live) return;
      if (!status?.key) return setState('unsupported');
      setKey(status.key);
      if (await registration.pushManager.getSubscription()) return setState('on');
      if (isApple() && !isStandalone()) return setState('home-screen');
      setState(Notification.permission === 'denied' ? 'denied' : 'off');
    })();
    return () => {
      live = false;
    };
  }, []);
  const turnOn = async () => {
    if (!key) return;
    setBusy(true);
    setNote('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setState('denied');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlBytes(key) as BufferSource,
      });
      await call('/v1/push', subscription.toJSON());
      setState('on');
    } catch {
      setNote('这台设备暂时没能开启提醒。');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    setNote('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await call('/v1/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
        await subscription.unsubscribe();
      }
      setState('off');
    } catch {
      setNote('暂时没能关闭，稍后再试。');
    } finally {
      setBusy(false);
    }
  };
  if (state === 'checking' || state === 'unsupported') return null;
  return (
    <section className="settings-section" aria-label="提醒">
      <h3>信到了</h3>
      {state === 'home-screen' ? (
        <p>在 iPhone 上，先把 lowkkey 添加到主屏幕（分享 → 添加到主屏幕），从主屏幕打开后再来开启提醒。</p>
      ) : state === 'denied' ? (
        <p>这台设备拒绝了通知。在系统设置里允许 lowkkey 的通知后，再回来开启。</p>
      ) : (
        <div className="settings-data-row">
          <p>
            {state === 'on'
              ? '有信、有新奖章时提醒一句，一周最多三条。'
              : 'AI 写了信、落了奖章时，提醒一句。一周最多三条。'}
          </p>
          <button disabled={busy} onClick={() => void (state === 'on' ? turnOff() : turnOn())}>
            {busy ? '稍等…' : state === 'on' ? '关闭' : '开启'}
          </button>
        </div>
      )}
      {note && <p className="settings-hint">{note}</p>}
    </section>
  );
}
