import { useId } from 'react';

export type MarkVariant = 'plaque' | 'tablet' | 'inscription';

const digits = '〇一二三四五六七八九';
const small = (n: number) =>
  n <= 10
    ? n === 10
      ? '十'
      : digits[n]
    : n < 20
      ? '十' + digits[n - 10]
      : digits[Math.floor(n / 10)] + '十' + (n % 10 ? digits[n % 10] : '');
/** 2026-10-03 → 二〇二六年十月三日. Dates on an engraving are written out, never typeset as digits. */
export function cnDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return [...String(y)].map(c => digits[Number(c)]).join('') + '年' + small(m) + '月' + small(d) + '日';
}

/**
 * A milestone is engraved, not awarded. Three compositions, one API:
 * plaque — a wide plate with a double hairline frame, a tracked title, the numeral, a rule with the brand's dot, the date;
 * tablet — a narrow vertical plate in the manner of a 题签, the title stacked character by character;
 * inscription — a single tracked line between two rules, the quietest form.
 * Numerals are the one place the display face is allowed.
 */
export function Mark({
  variant,
  value,
  unit,
  caption,
  date,
  serial,
  width,
}: {
  variant: MarkVariant;
  value: string;
  unit?: string;
  caption: string;
  date: string;
  serial?: number;
  width?: number | string;
}) {
  const id = useId();
  const gradient = `url(#${id})`;
  const label = `${caption} ${value}${unit ? ' ' + unit : ''} · ${cnDate(date)}`;
  const defs = (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
        <stop offset=".5" style={{ stopColor: 'var(--g1)' }} />
        <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
      </linearGradient>
    </defs>
  );

  if (variant === 'plaque')
    return (
      <svg viewBox="0 0 320 128" width={width ?? 320} className="mk mk-plaque" role="img" aria-label={label}>
        {defs}
        <rect x="0.5" y="0.5" width="319" height="127" rx="3" className="mk-frame" stroke={gradient} />
        <rect x="5.5" y="5.5" width="309" height="117" rx="2" className="mk-inner" />
        <text x="162" y="30" textAnchor="middle" className="mk-eyebrow">
          {caption}
        </text>
        <text x="160" y="80" textAnchor="middle" className="mk-num" style={{ fontSize: 42 }}>
          {value}
          {unit && (
            <tspan className="mk-unit" dx="5">
              {unit}
            </tspan>
          )}
        </text>
        <line x1="88" x2="152" y1="95.5" y2="95.5" className="mk-rule" />
        <circle cx="160" cy="95.5" r="1.6" className="mk-dot" />
        <line x1="168" x2="232" y1="95.5" y2="95.5" className="mk-rule" />
        <text x="161" y="112" textAnchor="middle" className="mk-date">
          {cnDate(date)}
        </text>
        {serial != null && (
          <text x="305" y="116" textAnchor="end" className="mk-serial">
            No. {serial}
          </text>
        )}
      </svg>
    );

  if (variant === 'tablet') {
    const chars = [...caption.replace(/\s*·\s*/g, '')];
    return (
      <svg viewBox="0 0 96 208" width={width ?? 96} className="mk mk-tablet" role="img" aria-label={label}>
        {defs}
        <rect x="0.5" y="0.5" width="95" height="207" rx="3" className="mk-frame" stroke={gradient} />
        <rect x="5.5" y="5.5" width="85" height="197" rx="2" className="mk-inner" />
        <text x="48" y="30" textAnchor="middle" className="mk-vert">
          {chars.map((c, i) => (
            <tspan key={i} x="48" dy={i ? 16 : 0}>
              {c}
            </tspan>
          ))}
        </text>
        <line x1="34" x2="44" y1="134" y2="134" className="mk-rule" />
        <circle cx="48" cy="134" r="1.4" className="mk-dot" />
        <line x1="52" x2="62" y1="134" y2="134" className="mk-rule" />
        <text x="48" y="168" textAnchor="middle" className="mk-num" style={{ fontSize: 30 }}>
          {value}
        </text>
        {unit && (
          <text x="48" y="181" textAnchor="middle" className="mk-unit-sub">
            {unit}
          </text>
        )}
        <text x="48" y="196" textAnchor="middle" className="mk-date mk-date-sm">
          {cnDate(date).replace('年', '·').replace('月', '·').replace('日', '')}
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 320 44" width={width ?? 320} className="mk mk-inscription" role="img" aria-label={label}>
      {defs}
      <line x1="0" x2="320" y1="6.5" y2="6.5" className="mk-rule mk-rule-long" stroke={gradient} />
      <line x1="0" x2="320" y1="37.5" y2="37.5" className="mk-rule mk-rule-long" stroke={gradient} />
      <text x="161" y="26" textAnchor="middle" className="mk-line">
        {caption} · <tspan className="mk-line-num">{value}</tspan>
        {unit && <tspan className="mk-line-unit"> {unit}</tspan>} · {cnDate(date)}
      </text>
    </svg>
  );
}
