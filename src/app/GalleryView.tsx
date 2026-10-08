import { bestSets } from '@lowkkey/core';
import { exerciseById, type Facts, type StrengthSeries } from '@lowkkey/protocol';
import { TrendChart } from './TrendChart.tsx';
import { loadLabel } from './PlanView.tsx';
export function GalleryView({ facts, series }: { facts: Facts; series: StrengthSeries[] }) {
  const sessions = [...facts.sessions].sort((a, b) => b.date.localeCompare(a.date));
  return <>
    <div className="page-intro"><p className="eyebrow">02 / THE TRAINING ARCHIVE</p><h1>力量，<br/>慢慢有了形状。</h1><p className="intro-note">{sessions.length ? sessions.length + ' 个训练日 · 每一笔，都是你练过的。' : '把真实的每一次，留在这里。'}</p></div>
    <section aria-label="长期力量曲线" className="strength-grid">{series.map(item => <article className="strength-card" key={item.exerciseId}>
      <div className="strength-heading"><h2>{item.name}</h2><span className="muted">e1RM{item.per_hand ? ' · 单只' : ''}</span></div>
      <div className="strength-number">{item.latest ? <><span className="number">{item.latest.lb.toFixed(1)}</span><span className="unit">lb</span></> : <span className="no-value">—</span>}</div>
      <TrendChart points={item.points} label={item.name + '长期 e1RM 曲线，单位磅'}/>
      {item.best && <p className="chart-caption">历史最佳 <span className="number">{item.best.lb.toFixed(1)} lb</span><span>{item.best.date}</span></p>}
    </article>)}</section>
    <p className="method-note">e1RM 为估算值。每个训练日取最高一组，明确热身组不计；13–20 次的估算误差较大。引体按体重与负重／辅助重量换算。</p>
    <div className="section-heading"><h2>练过的日子</h2><span className="eyebrow">THE ORIGINAL WORDS</span></div>
    {!sessions.length && <section className="empty-state"><h2>这里，留给第一篇记录。</h2><p>在熟悉的 AI 对话里保存训练，你的原话会完整留在这里。</p></section>}
    <div className="session-flow">{sessions.map(session => {
      const best = bestSets(session, facts.weights), groups = [...new Set(session.sets.map(set => set.exerciseId))];
      return <article className="session-entry" id={'Gallery-' + session.date} key={session.date}>
        <header className="session-date"><time dateTime={session.date}>{session.date.replaceAll('-', '.')}</time><span>{session.sets.length} 组</span></header>
        <p className="raw-text">{session.raw_text}</p>
        {groups.length > 0 && <div className="session-sets">{groups.map(id => <div className="record-exercise" key={id}>
          <h3>{exerciseById(id).name}</h3><div className="set-list">{session.sets.map((set, index) => set.exerciseId !== id ? null : <div className={'set-row' + (best[id]?.set_index === index ? ' best-set' : '')} key={index}>
            <span className="number">{loadLabel(set)} <span className="times">×</span> {set.reps}</span>
            <span className="set-context">{set.setRole === 'warmup' ? '热身' : ''}{set.rir != null ? ' · RIR ' + set.rir : ''}</span>
            {best[id]?.set_index === index && <span className="best-label" title={'e1RM ' + best[id].lb.toFixed(1) + ' lb'}>最佳组</span>}
          </div>)}</div>
        </div>)}</div>}
      </article>;
    })}</div>
  </>;
}
