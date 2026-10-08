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
    <div className="page-intro"><p className="eyebrow">03 / A STEADY CHANGE</p><h1>看趋势，<br/>让时间说话。</h1><p className="intro-note">七天的平均，比一天的起伏更清楚。</p></div>
    <section className="weight-sheet" aria-label="体重趋势">
      <div className="weight-summary"><div><span className="eyebrow">7 日滚动均值</span><div className="weight-number"><span className="number">{mean?.lb != null ? mean.lb.toFixed(1) : '—'}</span><span className="unit">lb</span></div><p className="muted">{mean ? mean.date + ' · 窗口内 ' + mean.samples + ' / 7 天有测量' : '等待体重记录'}</p></div>
        {latest && <div className="last-weight"><span className="eyebrow">最近一次</span><p><span className="number">{latest.lb.toFixed(1)}</span> lb</p><time>{latest.date}</time></div>}</div>
      {points.length || band.length ? <TrendChart points={points} band={band} large label="体重七日滚动均线与目标周增重参考带，单位磅"/> :
        <div className="weight-empty"><span className="empty-mark" aria-hidden="true">—</span><h2>变化，从第一笔开始。</h2><p>让 AI 保存测量日期和磅数，均线会在这里慢慢展开。</p></div>}
      <div className="chart-legend"><span><i className="line-swatch"/>7 日均线</span>{target && <span><i className="band-swatch"/>目标参考带</span>}</div>
      {target && <div className="target-note"><span className="eyebrow">按你的节奏</span><p>每周 <span className="number">+{target.weekly_lb_min}–{target.weekly_lb_max} lb</span></p><span className="muted">从 {target.start_date} 的 {target.start_lb} lb 起</span></div>}
    </section>
    <p className="method-note">每个日期取当日及之前六天内的实际测量均值。缺测不补零、不插值；没有测量的七日窗口留白。{target ? '参考带延伸四周，表示目标范围。' : '设置增重目标后，这里会出现参考带。'}</p>
    {selected && <p className="receipt-note" id={'Weight-' + selected.date}><time>{selected.date}</time> · 已保存 <span className="number">{selected.lb} lb</span></p>}
  </>;
}
