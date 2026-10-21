import { useEffect, useState } from 'react';
import { isApple, isStandalone } from '../account/device.ts';

const KEY = 'lowkkey-opens';
/**
 * A polite, one-time hint on an iPhone's second visit: the pod lives better on the home screen,
 * and only there can it say 信到了. Dismissed, it never returns; the count stays on this device.
 */
export function HomeHint() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      if (!isApple() || isStandalone()) return;
      const opens = Number(localStorage.getItem(KEY) ?? '0') + 1;
      localStorage.setItem(KEY, String(opens));
      if (opens === 2) setShown(true);
    } catch {
      /* Private windows forget; the hint simply never shows. */
    }
  }, []);
  if (!shown) return null;
  return (
    <div className="wrap home-hint" role="note">
      <p>把 lowkkey 添加到主屏幕，像一个 app 一样打开：分享 → 添加到主屏幕。</p>
      <button aria-label="知道了" onClick={() => setShown(false)}>
        ×
      </button>
    </div>
  );
}
