import { useState } from 'react';
import { shareImage } from './share.ts';

/** One quiet control under a medal's story or a letter: draw it onto paper and hand it over. */
export function ShareButton({ make, name, title }: { make: () => Promise<Blob>; name: string; title: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const sheet = 'share' in navigator && 'canShare' in navigator;
  const go = async () => {
    setState('busy');
    try {
      const result = await shareImage(await make(), name, title);
      setState(result === 'saved' ? 'saved' : 'idle');
      if (result === 'saved') setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('idle');
    }
  };
  return (
    <button className="share" disabled={state === 'busy'} onClick={() => void go()}>
      {state === 'busy' ? '正在画…' : state === 'saved' ? '已存为图片' : sheet ? '分享成图' : '存为图片'}{' '}
      <span aria-hidden="true">↗</span>
    </button>
  );
}
