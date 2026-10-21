import { useId } from 'react';

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

/**
 * An achievement is a medal: a metal rim, a quiet minute track, one motif in the middle,
 * and the name beneath it. Nothing else is written on it. The metal is the theme's:
 * platinum under ink, gilt under gold. Locked medals are an outline waiting to be earned.
 */
export function Medal({
  motif,
  unit,
  name,
  date,
  size = 112,
  locked = false,
  transition,
}: {
  motif: string;
  unit?: string;
  name: string;
  date?: string;
  size?: number;
  locked?: boolean;
  /** A view-transition name, so the same medal travels from a board card to the wall. */
  transition?: string;
}) {
  const id = useId();
  const numeral = /^[\d.]+$/.test(motif);
  const fontSize = numeral ? (motif.length <= 2 ? 42 : motif.length === 3 ? 36 : 28) : 40;
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
        <text
          x="60"
          y={numeral ? 60 + fontSize * 0.34 : 60 + fontSize * 0.36}
          textAnchor="middle"
          className={'motif' + (numeral ? '' : ' glyph')}
          style={{ fontSize }}
          fill={`url(#${id}-metal)`}
        >
          {motif}
        </text>
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
