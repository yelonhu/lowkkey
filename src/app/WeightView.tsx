import { addDays, targetAt, weightMean, weightSeries } from '@lowkkey/core';
import type { GainTarget, Weight } from '@lowkkey/protocol';
import { targetFromHash } from './navigation.ts';
import { TrendChart } from './TrendChart.tsx';
export function WeightView({ weights, target }: { weights: Weight[]; target: GainTarget | null }) {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date)), latest = sorted.at(-1);
  const mean = latest ? weightMean(weights, latest.date) : null, points = weightSeries(weights);
  const end = target ? addDays([latest?.date ?? target.start_date, target.start_date].sort().at(-1)!, 28) : null;
  const band = target && end ? [targetAt(target, target.start_date)!, targetAt(target, end)!] : [];
  const selected = sorted.find(weight => targetFromHash() === 'Weight-' + weight.date);
  return <>
    <header className="page-intro"><h1>体重趋势</h1>{latest && <p className="intro-note">{weights.length} 次测量</p>}</header>
    {latest || target ? <>
    <section className="weight-sheet" aria-label="体重趋势">
      <div className="weight-summary"><div><span className="note-label">7 日滚动均值</span><div className="weight-number"><span className="number">{mean?.lb != null ? mean.lb.toFixed(1) : '—'}</span><span className="unit">lb</span></div><p className="muted">{mean ? <>截至 <time dateTime={mean.date}>{mean.date.replaceAll('-', '.')}</time><span className="sample-count">7 天内 {mean.samples} 次测量</span></> : '等待第一次测量'}</p></div>
        {latest && <div className="last-weight"><span className="note-label">最近一次</span><p><span className="number">{latest.lb.toFixed(1)}</span> lb</p><time dateTime={latest.date}>{latest.date.replaceAll('-', '.')}</time></div>}</div>
      <TrendChart points={points} band={band} large label="体重七日滚动均线与目标周增重参考带，单位磅"/>
      <div className="chart-legend">{points.length > 0 && <span><i className="line-swatch"/>7 日均线</span>}{target && <span><i className="band-swatch"/>目标参考带</span>}</div>
      {target && <div className="target-note"><span className="note-label">增重目标</span><p>每周 <span className="number">+{target.weekly_lb_min}–{target.weekly_lb_max} lb</span></p><span className="muted">从 {target.start_date} 的 {target.start_lb} lb 起</span></div>}
    </section>
    <p className="method-note">取当日及此前六天内的实际测量均值，缺测不补零、不插值。{target ? '参考带按目标周增重范围延伸四周。' : '增重目标可在 AI 对话中设置。'}</p>
    </> : <section className="empty-state"><h2>还没有体重记录</h2><p>让 AI 保存测量日期和磅数，这里会显示你的 7 日均线。</p></section>}
    {selected && <p className="receipt-note" id={'Weight-' + selected.date}><time>{selected.date}</time> · 已保存 <span className="number">{selected.lb} lb</span></p>}
  </>;
}
