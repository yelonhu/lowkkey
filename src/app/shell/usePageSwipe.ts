import { useLayoutEffect, useRef, type RefObject } from 'react';
import { screenFromHash, screens, type Screen } from './navigation.ts';
import { reducedMotion, spring } from './motion.tsx';

const protectedArea =
  'a,button,input,textarea,select,summary,[contenteditable],.chartbox,.glyph,.note-conflict,.connection-address,.note-status,[role="alert"]';
/** Real page nodes share a temporary clipped viewport. No screenshots or editor clones. */
export function usePageSwipe(
  screen: Screen,
  enabled: boolean,
  accountId: string | undefined,
  positions: RefObject<Partial<Record<Screen, number>>>,
  completed: RefObject<boolean>,
) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host || !enabled) return;
    const current = document.getElementById('v-' + screen)!;
    let pointer: number | null = null,
      startX = 0,
      startY = 0,
      base = 0,
      x = 0,
      lastX = 0,
      lastTime = 0,
      velocity = 0,
      locked = false,
      frame = 0;
    let neighbor: HTMLElement | null = null,
      destination: Screen | null = null,
      direction = 0,
      activeTop = 0,
      documentTop = 0,
      navBottom = 0,
      width = 0;
    let running: Animation[] = [];
    let finishing = false,
      suppressClick = false;
    const spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    const indicator = document.querySelector<HTMLElement>('.tab-indicator')!;
    const tabs = [...document.querySelectorAll<HTMLElement>('.tabs a')];
    let tabStart = { left: 0, width: 0 },
      tabEnd = tabStart;
    const stop = () => {
      running.forEach(a => a.cancel());
      running = [];
      finishing = false;
    };
    const hideNeighbor = () => {
      if (neighbor) {
        neighbor.hidden = neighbor.id !== 'v-' + screenFromHash();
        neighbor.inert = neighbor.hidden;
        neighbor.removeAttribute('data-swipe-page');
        neighbor.style.removeProperty('top');
        neighbor.style.removeProperty('transform');
      }
      neighbor = null;
    };
    const clean = () => {
      cancelAnimationFrame(frame);
      stop();
      hideNeighbor();
      current.removeAttribute('data-swipe-page');
      current.style.removeProperty('top');
      current.style.removeProperty('transform');
      host.removeAttribute('data-swiping');
      host.style.removeProperty('top');
      spacer.remove();
      indicator.style.removeProperty('transition');
      const tab = tabs[screens.indexOf(screenFromHash())];
      indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
      indicator.style.width = tab.offsetWidth + 'px';
      locked = false;
      pointer = null;
    };
    const choose = (dx: number) => {
      const sign = dx < 0 ? 1 : -1;
      if (direction === sign) return;
      hideNeighbor();
      direction = sign;
      destination = screens[screens.indexOf(screen) + sign] ?? null;
      tabEnd = destination
        ? { left: tabs[screens.indexOf(destination)].offsetLeft, width: tabs[screens.indexOf(destination)].offsetWidth }
        : tabStart;
      if (!destination) return;
      neighbor = document.getElementById('v-' + destination)!;
      neighbor.hidden = false;
      neighbor.inert = true;
      neighbor.dataset.swipePage = 'incoming';
      let saved = positions.current[destination] ?? 0;
      if (destination === 'notes' && positions.current.notes === undefined) {
        const today = neighbor.querySelector<HTMLElement>('.note-date h2 span')?.closest<HTMLElement>('.note-day');
        if (today) saved = Math.max(0, documentTop + today.offsetTop - 72);
      }
      saved = Math.min(saved, Math.max(0, documentTop + neighbor.offsetHeight - innerHeight));
      positions.current[destination] = saved;
      neighbor.style.top = documentTop - saved - navBottom + 'px';
      neighbor.style.transform = `translate3d(${direction * width}px,0,0)`;
    };
    const paint = () => {
      frame = 0;
      if (!locked) return;
      choose(x);
      const value = destination ? Math.max(-width, Math.min(width, x)) : x * 0.16;
      if (reducedMotion()) return;
      current.style.transform = `translate3d(${value}px,0,0)`;
      if (neighbor) neighbor.style.transform = `translate3d(${value + direction * width}px,0,0)`;
      const progress = destination ? Math.min(1, Math.abs(value) / width) : 0;
      indicator.style.transform = `translateX(${tabStart.left + (tabEnd.left - tabStart.left) * progress}px) scaleX(${(tabStart.width + (tabEnd.width - tabStart.width) * progress) / tabStart.width})`;
    };
    const begin = () => {
      locked = true;
      current.getAnimations().forEach(a => a.cancel());
      const rect = current.getBoundingClientRect();
      documentTop = rect.top + scrollY;
      navBottom = document.querySelector('.navbar')!.getBoundingClientRect().bottom;
      activeTop = rect.top - navBottom;
      width = innerWidth;
      positions.current[screen] = scrollY;
      spacer.style.height = host.getBoundingClientRect().height + 'px';
      host.before(spacer);
      host.dataset.swiping = 'true';
      host.style.top = navBottom + 'px';
      current.dataset.swipePage = 'current';
      current.style.top = activeTop + 'px';
      const tab = tabs[screens.indexOf(screen)];
      tabStart = { left: tab.offsetLeft, width: tab.offsetWidth };
      indicator.style.transition = 'none';
      direction = 0;
    };
    const settle = (commit: boolean) => {
      cancelAnimationFrame(frame);
      paint();
      pointer = null;
      suppressClick = true;
      const next = commit ? destination : null;
      const finish = () => {
        if (next) {
          completed.current = true;
          location.hash = next;
        } else clean();
      };
      if (reducedMotion()) {
        finish();
        return;
      }
      const from = destination ? Math.max(-width, Math.min(width, x)) : x * 0.16,
        to = next ? -direction * width : 0;
      // Released, the page settles on the snap spring; a longer travel takes a little longer.
      const duration = Math.max(320, Math.min(460, 320 + (Math.abs(to - from) / width) * 140)),
        easing = spring('snap');
      const motion = (el: HTMLElement, frames: Keyframe[]) => {
        const a = el.animate(frames, { duration, easing, fill: 'forwards' });
        running.push(a);
        return a;
      };
      finishing = true;
      const animation = motion(current, [
        { transform: `translate3d(${from}px,0,0)` },
        { transform: `translate3d(${to}px,0,0)` },
      ]);
      if (neighbor)
        motion(neighbor, [
          { transform: `translate3d(${from + direction * width}px,0,0)` },
          { transform: `translate3d(${to + direction * width}px,0,0)` },
        ]);
      motion(indicator, [
        { transform: indicator.style.transform },
        {
          transform: `translateX(${next ? tabEnd.left : tabStart.left}px) scaleX(${(next ? tabEnd.width : tabStart.width) / tabStart.width})`,
        },
      ]);
      animation.onfinish = finish;
    };
    const down = (e: PointerEvent) => {
      suppressClick = false;
      if (e.pointerType !== 'touch') return;
      if (pointer !== null) {
        if (locked) settle(false);
        pointer = null;
        return;
      }
      if (
        !e.isPrimary ||
        e.clientX < 24 ||
        e.clientX > innerWidth - 24 ||
        (e.target instanceof Element && e.target.closest(protectedArea)) ||
        document.activeElement?.matches('textarea,input,[contenteditable="true"]')
      )
        return;
      for (let el = e.target as HTMLElement | null; el && el !== host; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) return;
      }
      base = 0;
      if (finishing) {
        base = new DOMMatrixReadOnly(getComputedStyle(current).transform).m41;
        stop();
        x = base;
        paint();
      }
      pointer = e.pointerId;
      startX = lastX = e.clientX;
      startY = e.clientY;
      lastTime = e.timeStamp;
      velocity = 0;
      suppressClick = false;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const dx = e.clientX - startX,
        dy = e.clientY - startY;
      if (!locked) {
        if (Math.abs(dy) > 10 && Math.abs(dx) <= Math.abs(dy) * 1.3) {
          pointer = null;
          return;
        }
        if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
        begin();
      }
      const elapsed = e.timeStamp - lastTime;
      if (elapsed > 0) velocity = (e.clientX - lastX) / elapsed;
      lastX = e.clientX;
      lastTime = e.timeStamp;
      x = base + dx;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!locked) {
        pointer = null;
        return;
      }
      choose(x);
      const speed = e.timeStamp - lastTime < 100 ? velocity : 0;
      settle(
        !!destination &&
          (Math.abs(x) > width * 0.25 ||
            (Math.abs(x) >= 40 && Math.abs(speed) >= 0.5 && Math.sign(speed) === Math.sign(x))),
      );
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pointer) {
        if (locked) settle(false);
        else pointer = null;
      }
    };
    const click = (e: MouseEvent) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }
    };
    const abort = () => {
      if (locked) clean();
    };
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    host.addEventListener('click', click, true);
    window.addEventListener('resize', abort);
    window.addEventListener('blur', abort);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', abort);
    return () => {
      clean();
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      host.removeEventListener('click', click, true);
      window.removeEventListener('resize', abort);
      window.removeEventListener('blur', abort);
      media.removeEventListener('change', abort);
    };
  }, [screen, enabled, accountId, positions, completed]);
  return viewport;
}
