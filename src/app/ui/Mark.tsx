import { useId } from 'react';

export type MarkVariant = 'ring' | 'guilloche' | 'seal';

/**
 * A milestone rendered as an engraving rather than a stamp: hairlines, a quiet numeral,
 * the material of the current theme. Three studies share one API so the board and the
 * styleguide can compare them side by side.
 */
export function Mark({
  variant,
  value,
  unit,
  caption,
  date,
  glyph,
  size = 120,
}: {
  variant: MarkVariant;
  value: string;
  unit?: string;
  caption: string;
  date: string;
  glyph?: string;
  size?: number;
}) {
  const id = useId();
  const gradient = `url(#${id}-m)`;
  const label = `${caption} ${value}${unit ? ' ' + unit : ''} · ${date}`;
  const defs = (
    <defs>
      <linearGradient id={`${id}-m`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
        <stop offset=".55" style={{ stopColor: 'var(--g1)' }} />
        <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
      </linearGradient>
      <path id={`${id}-arc`} d="M 60 60 m -46 0 a 46 46 0 1 1 92 0 a 46 46 0 1 1 -92 0" />
    </defs>
  );
  const numeral = (x: number, y: number, fontSize: number, anchor: 'middle' | 'start' = 'middle') => (
    <text x={x} y={y} textAnchor={anchor} className="mk-num" style={{ fontSize }}>
      {value}
      {unit && (
        <tspan className="mk-unit" dx="2">
          {unit}
        </tspan>
      )}
    </text>
  );

  if (variant === 'ring')
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label} className="mk mk-ring">
        {defs}
        <circle cx="60" cy="60" r="58" className="mk-hair" stroke={gradient} />
        <circle cx="60" cy="60" r="40" className="mk-hair mk-faint" />
        <text className="mk-ring-text">
          <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
            {caption} · {date}
          </textPath>
        </text>
        {numeral(60, 71, 30)}
      </svg>
    );

  if (variant === 'guilloche') {
    const rays = Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      const r0 = i % 6 === 0 ? 43 : 48;
      return (
        <line
          key={i}
          x1={60 + Math.cos(a) * r0}
          y1={60 + Math.sin(a) * r0}
          x2={60 + Math.cos(a) * 56}
          y2={60 + Math.sin(a) * 56}
          className="mk-ray"
          stroke={gradient}
        />
      );
    });
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label} className="mk mk-guilloche">
        {defs}
        <circle cx="60" cy="60" r="57.5" className="mk-hair" stroke={gradient} />
        {rays}
        <circle cx="60" cy="60" r="40" className="mk-disc" />
        {numeral(60, 68, 26)}
        <text x="60" y="84" textAnchor="middle" className="mk-cap">
          {caption}
        </text>
        <text x="60" y="101" textAnchor="middle" className="mk-date">
          {date}
        </text>
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label} className="mk mk-seal">
      {defs}
      <rect x="8" y="8" width="104" height="104" rx="18" className="mk-hair" stroke={gradient} />
      <rect x="13" y="13" width="94" height="94" rx="14" className="mk-hair mk-faint" />
      {numeral(24, 58, 32, 'start')}
      <text x="96" y="94" textAnchor="end" className="mk-glyph">
        {glyph ?? caption.slice(0, 1)}
      </text>
      <text x="24" y="95" className="mk-date">
        {date}
      </text>
      <text x="24" y="78" className="mk-cap mk-left">
        {caption}
      </text>
    </svg>
  );
}
