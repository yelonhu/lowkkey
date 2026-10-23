import { useId, useMemo } from 'react';

const digits = '〇一二三四五六七八九';
const small = (n: number) =>
  n <= 10
    ? n === 10
      ? '十'
      : digits[n]
    : n < 20
      ? '十' + digits[n - 10]
      : digits[Math.floor(n / 10)] + '十' + (n % 10 ? digits[n % 10] : '');
/** 2026-10-03 → 二〇二六·十·三. A date on a medal is written, not typeset. */
export function cnDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return [...String(y)].map(c => digits[Number(c)]).join('') + '·' + small(m) + '·' + small(d);
}

/** What the AI drew on the medal: SVG path data on a 100×100 canvas, as a line drawing or a silhouette. */
export type Drawing = { d: string; style?: 'line' | 'solid' };
export type PathFit = { s: number; tx: number; ty: number; box: { x: number; y: number; w: number; h: number } };
const NS = 'http://www.w3.org/2000/svg';
const fits = new Map<string, PathFit>();
/**
 * Fit a drawn path into the disc: measured once in a hidden SVG, then centred on (60,60) of the
 * medal's 120-unit face and scaled to a 56-unit box, so an off-centre or small drawing still sits right.
 */
export function fitPath(d: string, box = 56): PathFit {
  const known = fits.get(d);
  if (known) return known;
  let b = { x: 0, y: 0, w: 100, h: 100 };
  if (typeof document !== 'undefined') {
    const svg = document.createElementNS(NS, 'svg'),
      path = document.createElementNS(NS, 'path');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.visibility = 'hidden';
    path.setAttribute('d', d);
    svg.appendChild(path);
    document.body.appendChild(svg);
    try {
      const bb = path.getBBox();
      if (bb.width > 0 || bb.height > 0) b = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    } catch {
      /* An unmeasurable path keeps the whole canvas as its box. */
    } finally {
      svg.remove();
    }
  }
  const s = box / Math.max(b.w, b.h, 1);
  const fit = { s, tx: 60 - (b.x + b.w / 2) * s, ty: 60 - (b.y + b.h / 2) * s, box: b };
  fits.set(d, fit);
  return fit;
}

/**
 * An achievement is a medal: a metal rim, a quiet minute track, one motif in the middle,
 * and the name beneath it. The motif is what the AI drew, or failing that a number or a
 * character. The metal is the theme's: platinum under ink, gilt under gold. Locked medals
 * are an outline waiting to be earned.
 */
export function Medal({
  motif,
  drawing,
  unit,
  name,
  date,
  size = 112,
  locked = false,
  transition,
}: {
  motif?: string;
  drawing?: Drawing;
  unit?: string;
  name: string;
  date?: string;
  size?: number;
  locked?: boolean;
  /** A view-transition name, so the same medal travels from a board card to the wall. */
  transition?: string;
}) {
  const id = useId();
  const fit = useMemo(() => (drawing ? fitPath(drawing.d) : null), [drawing]);
  const text = drawing ? '' : (motif ?? '');
  const numeral = /^[\d.]+$/.test(text);
  const fontSize = numeral ? (text.length <= 2 ? 42 : text.length === 3 ? 36 : 28) : 40;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 15 === 0;
    const r0 = long ? 41 : 43.5;
    return (
      <line
        key={i}
        x1={60 + Math.cos(a) * r0}
        y1={60 + Math.sin(a) * r0}
        x2={60 + Math.cos(a) * 46}
        y2={60 + Math.sin(a) * 46}
        className="tick"
      />
    );
  });
  const solid = drawing?.style === 'solid';
  return (
    <figure
      className="medal"
      data-locked={locked ? '' : undefined}
      style={{ width: size, viewTransitionName: transition }}
    >
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={`${name}${locked ? '（未获得）' : ''}${date ? ' · ' + cnDate(date) : ''}`}
      >
        <defs>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
            <stop offset=".5" style={{ stopColor: 'var(--g1)' }} />
            <stop offset=".78" style={{ stopColor: 'var(--g0)' }} />
            <stop offset="1" style={{ stopColor: 'var(--g1)' }} />
          </linearGradient>
          <radialGradient id={`${id}-disc`} cx="40%" cy="35%" r="75%">
            <stop offset="0" style={{ stopColor: 'var(--surf)' }} />
            <stop offset="1" style={{ stopColor: 'var(--line2)' }} />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="57" className="rim" fill={`url(#${id}-metal)`} />
        <circle cx="60" cy="60" r="57" className="edge" />
        <circle cx="60" cy="60" r="50" className="disc" fill={`url(#${id}-disc)`} />
        <circle cx="60" cy="60" r="50" className="edge" />
        {ticks}
        {drawing && fit ? (
          <g
            className="drawing"
            data-style={solid ? 'solid' : 'line'}
            transform={`translate(${fit.tx.toFixed(3)} ${fit.ty.toFixed(3)}) scale(${fit.s.toFixed(4)})`}
          >
            <path
              d={drawing.d}
              fill={solid ? `url(#${id}-metal)` : 'none'}
              stroke={`url(#${id}-metal)`}
              strokeWidth={(solid ? 0.5 : 1.7) / fit.s}
            />
          </g>
        ) : (
          <text
            x="60"
            y={numeral ? 60 + fontSize * 0.34 : 60 + fontSize * 0.36}
            textAnchor="middle"
            className={'motif' + (numeral ? '' : ' glyph')}
            style={{ fontSize }}
            fill={`url(#${id}-metal)`}
          >
            {text}
          </text>
        )}
        {unit && (
          <text x="60" y="86" textAnchor="middle" className="unit">
            {unit}
          </text>
        )}
      </svg>
      <figcaption>
        <b>{name}</b>
        {date && !locked && <span>{cnDate(date)}</span>}
      </figcaption>
    </figure>
  );
}
