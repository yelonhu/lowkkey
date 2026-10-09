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
    <header className="page-intro"><h1>下次训练</h1>{active.length > 0 && <p className="intro-note">{active.length} 个训练日 · 最新安排</p>}</header>
    {!active.length ? <section className="empty-state"><h2>还没有训练安排</h2><p>和你的 AI 聊好安排，保存后会显示在这里。</p></section> :
      <div className="plan-grid">{active.map(plan => <article className="plan-card" id={'Plan-' + plan.day} key={plan.day}>
        <header className="card-heading"><h2>{plan.day}</h2><span className="muted">{plan.items.length} 个动作</span></header>
        <ol className="plan-items">{plan.items.map((item, i) => <li key={i}>
          <div className="exercise-line"><span className="exercise-name">{exerciseById(item.exerciseId).name}</span><span className="load-value">{loadLabel(item)}</span></div>
          <div className="prescription"><span className="number">{item.sets}</span> 组 <span className="times">×</span> <span className="number">{item.repMin === item.repMax ? item.repMin : item.repMin + '–' + item.repMax}</span> 次</div>
          {item.note && <p className="item-note">{item.note}</p>}
        </li>)}</ol>
        {plan.notes.coach && <div className="coach-note"><span className="note-label">教练备注</span><p>{plan.notes.coach}</p></div>}
      </article>)}</div>}
  </>;
}
