import { exerciseById, type Plan, type PlanItem, type TrainingSet } from '@lowkkey/protocol';

export function loadLabel(item: Pick<PlanItem | TrainingSet, 'load' | 'loadKind' | 'unit' | 'exerciseId'>) {
  if (item.load == null) return '按状态选择重量';
  const prefix = item.loadKind === 'assist' ? '辅助 ' : item.loadKind === 'bodyweight' ? (item.load === 0 ? '' : '负重 +') : '';
  if (item.loadKind === 'bodyweight' && item.load === 0) return '自重';
  return prefix + item.load + ' ' + item.unit + (exerciseById(item.exerciseId).perHand ? ' / 只' : '');
}
export function PlanView({ plans }: { plans: Plan[] }) {
  const active = plans.filter(plan => plan.items.length);
  return <>
    <div className="page-intro"><p className="eyebrow">01 / THE NEXT SESSION</p><h1>下一次，<br/>心中有数。</h1><p className="intro-note">去健身房前，扫一眼就好。</p></div>
    {!active.length ? <section className="empty-state"><span className="empty-mark" aria-hidden="true">—</span><h2>下一次，从一份安排开始。</h2><p>和你的 AI 聊好训练安排，保存后会出现在这里。</p></section> :
      <div className="plan-grid">{active.map((plan, index) => <article className="plan-card" id={'Plan-' + plan.day} key={plan.day}>
        <header className="card-heading"><span className="eyebrow">训练日 {String(index + 1).padStart(2, '0')}</span><span className="muted">{plan.items.length} 个动作</span><h2>{plan.day}</h2></header>
        <ol className="plan-items">{plan.items.map((item, i) => <li key={i}>
          <div className="exercise-line"><span className="exercise-name">{exerciseById(item.exerciseId).name}</span><span className="leader"/><span className="load-value">{loadLabel(item)}</span></div>
          <div className="prescription"><span className="number">{item.sets}</span> 组 <span className="times">×</span> <span className="number">{item.repMin === item.repMax ? item.repMin : item.repMin + '–' + item.repMax}</span> 次</div>
          {item.note && <p className="item-note">{item.note}</p>}
        </li>)}</ol>
        {plan.notes.coach && <div className="coach-note"><span className="eyebrow">教练留的话</span><p>{plan.notes.coach}</p></div>}
      </article>)}</div>}
  </>;
}
