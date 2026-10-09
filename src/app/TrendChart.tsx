import { useId, useLayoutEffect, useRef, useState } from 'react';
import { dayIndex } from '@lowkkey/core';
export type ChartPoint = { date: string; lb: number | null };
type BandPoint = { date: string; min: number; max: number };
export function TrendChart({ points, label, band = [], large = false }: { points: ChartPoint[]; label: string; band?: BandPoint[]; large?: boolean }) {
  const id = useId();
  const frame = useRef<HTMLDivElement>(null), [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = frame.current!;
    const measure = () => setWidth(Math.max(120, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = [...points.flatMap(point => point.lb == null ? [] : [point.lb]), ...band.flatMap(point => [point.min, point.max])];
  if (!values.length) return <div ref={frame} className="chart-frame chart-empty">暂无有效组</div>;
  const dates = [...points.map(point => dayIndex(point.date)), ...band.map(point => dayIndex(point.date))];
  const height = large ? (width < 480 ? 230 : 280) : (width < 220 ? 124 : 164);
  const left = 32, right = 8, top = 12, bottom = 26;
  const from = Math.min(...dates), to = Math.max(...dates);
  const low = Math.min(...values), high = Math.max(...values), padding = Math.max((high - low) * .18, 2);
  const min = Math.max(0, low - padding), max = high + padding;
  const x = (date: string) => to === from ? (width + left - right) / 2 : left + (dayIndex(date) - from) / (to - from) * (width - left - right);
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const paths: string[] = []; let current = '';
  for (const point of points) {
    if (point.lb == null) { if (current) paths.push(current); current = ''; }
    else current += (current ? ' L ' : 'M ') + x(point.date) + ' ' + y(point.lb);
  }
  if (current) paths.push(current);
  const bandPath = band.length ? 'M ' + band.map(point => x(point.date) + ' ' + y(point.max)).join(' L ') + ' L ' + [...band].reverse().map(point => x(point.date) + ' ' + y(point.min)).join(' L ') + ' Z' : '';
  const sameYear = new Date(from * 86400000).getUTCFullYear() === new Date(to * 86400000).getUTCFullYear();
  const fmtDate = (day: number) => new Date(day * 86400000).toISOString().slice(sameYear ? 5 : 2, 10).replaceAll('-', '.');
  const observations = points.filter((point): point is { date: string; lb: number } => point.lb != null);
  const dots = observations.length <= 12 ? observations : observations.slice(-1);
  return <div ref={frame} className={'chart-frame' + (large ? ' large-chart' : '')}><svg className="trend-chart" viewBox={'0 0 ' + width + ' ' + height} role="img" aria-labelledby={id}>
    <title id={id}>{label}</title>
    {[0, .5, 1].map(fraction => { const value = min + (max - min) * fraction; return <g key={fraction}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid"/><text x={left - 9} y={y(value) + 4} textAnchor="end">{value.toFixed(0)}</text></g>; })}
    {bandPath && <path d={bandPath} className="chart-band"/>}
    {paths.map((path, i) => <path key={i} d={path} className="chart-line"/>)}
    {dots.map(point => <circle key={point.date} cx={x(point.date)} cy={y(point.lb)} r={dots.length === 1 ? 3 : 2} className="chart-dot"><title>{point.date + ' · ' + point.lb.toFixed(1) + ' lb'}</title></circle>)}
    <text x={left} y={height - 5}>{fmtDate(from)}</text>
    {to !== from && <text x={width - right} y={height - 5} textAnchor="end">{fmtDate(to)}</text>}
  </svg></div>;
}
