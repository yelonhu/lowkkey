import type { StateResponse } from '@lowkkey/protocol';
import { strengthSeries } from '@lowkkey/core';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { screens, type Screen } from './navigation.ts';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ease = 'cubic-bezier(.22,.8,.25,1)';
export function animate(element: Element | null, frames: Keyframe[], duration = 240) {
  if (!element || reducedMotion()) return null;
  return element.animate(frames, { duration, easing: ease });
}

// Native summaries keep keyboard semantics. Measure only the two endpoints;
// interrupting starts at the currently painted height instead of queuing work.
export function useMotion() {
  useEffect(() => {
    const running = new Map<HTMLDetailsElement, { animation: Animation; opening: boolean }>();
    const pointer = () => {
      document.documentElement.dataset.input = 'pointer';
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') document.documentElement.dataset.input = 'keyboard';
    };
    const click = (event: MouseEvent) => {
      const summary = event.target instanceof Element ? event.target.closest('summary') : null;
      const detail = summary?.parentElement;
      if (!(detail instanceof HTMLDetailsElement) || event.defaultPrevented || reducedMotion()) return;
      if (event.target instanceof Element && event.target.closest('a,button,input,select')) return;
      event.preventDefault();
      const previous = running.get(detail),
        opening = previous ? !previous.opening : !detail.open;
      const start = detail.getBoundingClientRect().height;
      previous?.animation.cancel();
      detail.open = true;
      const end = opening
        ? detail.getBoundingClientRect().height
        : summary!.getBoundingClientRect().height +
          parseFloat(getComputedStyle(detail).borderTopWidth) +
          parseFloat(getComputedStyle(detail).borderBottomWidth);
      detail.dataset.expanded = String(opening);
      detail.style.overflow = 'hidden';
      const animation = detail.animate([{ height: start + 'px' }, { height: end + 'px' }], {
        duration: 240,
        easing: ease,
      });
      running.set(detail, { animation, opening });
      animation.onfinish = () => {
        if (running.get(detail)?.animation !== animation) return;
        detail.open = opening;
        detail.style.overflow = '';
        delete detail.dataset.expanded;
        running.delete(detail);
      };
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => {
      for (const [detail, { animation, opening }] of running) {
        animation.cancel();
        detail.open = opening;
        detail.style.overflow = '';
        delete detail.dataset.expanded;
      }
      running.clear();
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('click', click);
    media.addEventListener('change', settle);
    return () => {
      settle();
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('click', click);
      media.removeEventListener('change', settle);
    };
  }, []);
}

// The first page is the board; its hash stays `next` so receipts and old links keep working.
const labels: Partial<Record<Screen, string>> = { next: 'board' };
export function PageTabs({ screen }: { screen: Screen }) {
  const ref = useRef<HTMLElement>(null),
    [indicator, setIndicator] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const nav = ref.current!;
    const update = () => {
      const link = nav.querySelector<HTMLElement>('[aria-current]');
      if (link) setIndicator({ left: link.offsetLeft, width: link.offsetWidth });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    for (const link of nav.children) observer.observe(link);
    void document.fonts.ready.then(update);
    return () => observer.disconnect();
  }, [screen]);
  return (
    <nav ref={ref} className="wrap tabs" aria-label="页面">
      {screens.map(key => (
        <a key={key} href={'#' + key} aria-current={screen === key ? 'page' : undefined}>
          {labels[key] ?? key}
        </a>
      ))}
      <span
        className="tab-indicator"
        aria-hidden="true"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width,
          opacity: indicator.width ? 1 : 0,
        }}
      />
    </nav>
  );
}

export function useFactMotion(revision: unknown, screen: Screen) {
  const values = useRef(new WeakMap<Element, string>());
  useEffect(() => {
    if (screen === 'notes') return;
    const animations: Animation[] = [];
    for (const node of document.querySelectorAll(`#v-${screen} .cl, #v-${screen} .bw, #v-${screen} .lift .v`)) {
      const text = node.textContent ?? '',
        prior = values.current.get(node);
      if (prior !== undefined && prior !== text) {
        const animation = animate(node, [{ opacity: 0.5 }, { opacity: 1 }], 180);
        if (animation) animations.push(animation);
      }
      values.current.set(node, text);
    }
    return () => animations.forEach(a => a.cancel());
  }, [revision, screen]);
}

// Establish a quiet baseline on load. Only a genuinely higher best arriving
// during this visit can be highlighted; refreshes and tab changes don't replay it.
export function useRecordMotion(facts: StateResponse | null, screen: Screen) {
  const history = useRef<{
    owner: string;
    best: Map<string, number>;
    seen: Set<string>;
    pending: Map<string, string>;
  } | null>(null);
  useEffect(() => {
    if (!facts) return;
    const series = strengthSeries(facts),
      fresh = history.current?.owner !== facts.accountId;
    if (fresh) history.current = { owner: facts.accountId, best: new Map(), seen: new Set(), pending: new Map() };
    const state = history.current!;
    for (const line of series) {
      if (!line.best) continue;
      const id = line.ex + ':' + line.best.date + ':' + line.best.e1rm,
        previous = state.best.get(line.ex);
      if (!fresh && previous !== undefined && line.best.e1rm > previous && !state.seen.has(id))
        state.pending.set(line.ex, id);
      state.best.set(line.ex, line.best.e1rm);
      state.seen.add(id);
    }
    if (screen !== 'recap') return;
    for (const [ex] of state.pending) {
      const node = document.querySelector(`#v-recap .lift[data-ex="${ex}"]`);
      if (node) {
        animate(
          node,
          [
            { backgroundColor: 'transparent' },
            { backgroundColor: getComputedStyle(node).getPropertyValue('--wash') },
            { backgroundColor: 'transparent' },
          ],
          800,
        );
        state.pending.delete(ex);
      }
    }
  }, [facts, screen]);
}

// First arrival on a page: its blocks rise in sequence. Later visits keep the quiet fade.
export function useArrivalMotion(ready: boolean, screen: Screen, owner: string | undefined, skip: RefObject<boolean>) {
  const seen = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!ready || !owner) return;
    const key = owner + ':' + screen;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    if (skip.current || reducedMotion()) return;
    const page = document.getElementById('v-' + screen);
    if (!page) return;
    const blocks = [...page.children]
      .filter((el): el is HTMLElement => el instanceof HTMLElement && !el.hidden)
      .slice(0, 7);
    // Only a visible document may hold content at opacity 0; a throttled timeline must never leave it there.
    if (document.visibilityState !== 'visible') return;
    const animations = blocks.map((el, i) =>
      el.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 380, delay: i * 48, easing: ease, fill: 'backwards' },
      ),
    );
    const settle = () => animations.forEach(a => a.playState !== 'finished' && a.finish());
    const guard = window.setTimeout(settle, 380 + blocks.length * 48 + 400);
    document.addEventListener('visibilitychange', settle, { once: true });
    return () => {
      clearTimeout(guard);
      document.removeEventListener('visibilitychange', settle);
    };
  }, [ready, screen, owner, skip]);
}

// Pull past the top to sync. Touch events keep firing through native overscroll, so the
// mark follows the finger; release beyond the threshold refreshes, then settles.
export function usePullRefresh(enabled: boolean, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!enabled) return;
    const indicator = document.getElementById('pull');
    if (!indicator) return;
    const threshold = 72;
    let startY = 0,
      startX = 0,
      active = false,
      locked = false,
      progress = 0,
      busy = false,
      timer = 0;
    const set = (value: number) => {
      progress = value;
      indicator.style.setProperty('--p', String(Math.max(0, Math.min(1, value))));
    };
    const start = (event: TouchEvent) => {
      if (busy || event.touches.length !== 1 || scrollY > 0 || reducedMotion()) return;
      if (document.activeElement?.matches('textarea,input')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('textarea,input,.chartbox,.account-panel,.journey')) return;
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      active = true;
      locked = false;
    };
    const move = (event: TouchEvent) => {
      if (!active) return;
      const dy = event.touches[0].clientY - startY,
        dx = event.touches[0].clientX - startX;
      if (!locked) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          active = false;
          return;
        }
        if (dy <= 12) return;
        locked = true;
        indicator.dataset.live = '';
      }
      if (scrollY > 0 || dy < 0) {
        set(0);
        return;
      }
      set((dy - 12) / threshold);
    };
    const end = () => {
      if (!active) return;
      active = false;
      delete indicator.dataset.live;
      if (progress < 1 || busy) {
        set(0);
        return;
      }
      busy = true;
      indicator.dataset.state = 'syncing';
      void refresh().finally(() => {
        indicator.dataset.state = 'done';
        timer = window.setTimeout(() => {
          delete indicator.dataset.state;
          set(0);
          busy = false;
        }, 720);
      });
    };
    const options = { passive: true } as const;
    window.addEventListener('touchstart', start, options);
    window.addEventListener('touchmove', move, options);
    window.addEventListener('touchend', end, options);
    window.addEventListener('touchcancel', end, options);
    return () => {
      clearTimeout(timer);
      delete indicator.dataset.state;
      delete indicator.dataset.live;
      set(0);
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [enabled, refresh]);
}

// A hero number settles into place on arrival instead of appearing fully formed.
export function useSettle(value: number, digits = 1, duration = 560) {
  const [mounted] = useState(() => performance.now());
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (performance.now() - mounted > 1200 || reducedMotion()) {
      setShown(value);
      return;
    }
    const from = value - Math.max(0.6, Math.abs(value) * 0.004),
      started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration),
        eased = 1 - (1 - t) ** 3;
      setShown(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, mounted, duration]);
  return Math.round(shown * 10 ** digits) / 10 ** digits;
}
