import type { Facts, PlanItem } from '@lowkkey/protocol';
import {
  bodyweightOn,
  compactSets,
  diffDays,
  exerciseName,
  fmt,
  lastExercise,
  md,
  plates,
  toLb,
  unitLabel,
  weekStatus,
  weekday,
} from '@lowkkey/core';
import { Barbell, Glyph } from '../ui/Graphics.tsx';

/** Where today sits: weekday, week number, this week's progress, the latest weight. */
export function StatusLine({ facts, today }: { facts: Facts; today: string }) {
  const week = weekStatus(facts, today),
    bw = bodyweightOn(facts.weights, today);
  const complete = week.planned > 0 && week.done >= week.planned;
  return (
    <p className="status" aria-label="今天的状态">
      <span>
        <b>周{'日一二三四五六'[weekday(today)]}</b>
        {md(today)}
      </span>
      {facts.sessions.length > 0 && (
        <span>
          <b>week</b>
          {week.index}
        </span>
      )}
      {week.planned > 0 && (
        <span>
          <b>本周</b>
          <span className={complete ? 'done' : undefined}>{week.done}</span>&thinsp;/&thinsp;{week.planned}
        </span>
      )}
      {bw && diffDays(today, bw.date) <= 7 && (
        <span>
          <b>体重</b>
          {fmt(bw.lb)} lb
        </span>
      )}
    </p>
  );
}
export function PlanItems({ items, facts }: { items: PlanItem[]; facts: Facts }) {
  return (
    <ul className="items">
      {items.map((it, i) => {
        const last = lastExercise(facts.sessions, it)[0],
          pl = ['bench_press', 'back_squat'].includes(it.ex) && it.load != null ? plates(toLb(it.load, it.unit)) : null;
        const assistance = last?.sets.filter(x => x.role !== 'warmup' && x.kind === 'assist');
        return (
          <li className="it" key={i}>
            <div className="it-h">
              <span className="it-n">
                {exerciseName(it)}
                {it.optional && <small>可选</small>}
              </span>
              <span className="it-l tn">
                {it.load == null ? (
                  <span className="mu" style={{ fontWeight: 400, fontSize: 13 }}>
                    现场试
                  </span>
                ) : (
                  <>
                    {it.loadKind === 'assist' && <span className="pre">辅助</span>}
                    {it.loadKind === 'bodyweight' && it.load > 0 && <span className="pre">负重</span>}
                    {fmt(it.load)}
                    <span className="u">{unitLabel(it)}</span>
                  </>
                )}
              </span>
            </div>
            <div className="it-m">
              <span>
                {it.sets} 组 × {it.min}–{it.max} 次
              </span>
              {it.loadKind === 'assist' && !!assistance?.length && (
                <span>上次辅助 {fmt(Math.min(...assistance.map(x => x.load)))}</span>
              )}
            </div>
            {last && (
              <div className="it-last">
                <span className="k">上次 {md(last.date)}</span>
                <span className="v">{compactSets(last.sets)}</span>
                <Glyph sets={last.sets} date={last.date} weights={facts.weights} />
              </div>
            )}
            {pl && (
              <div className="it-pl">
                <Barbell width={108} lb={toLb(it.load!, it.unit)} />
                <span>{pl.length ? '每边 ' + pl.join(' + ') : '空杆'}</span>
              </div>
            )}
            {it.note && <p className="it-note">{it.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
