import { useEffect, useState, type ReactNode } from 'react';
import type { Context, Medal as MedalFact, StateResponse } from '@lowkkey/protocol';
import { BOARD_CARDS, type BoardCard } from '@lowkkey/protocol/constants';
import {
  activeContexts,
  boardOf,
  datedCuration,
  diffDays,
  fmt,
  latestRecap,
  md,
  medalsThisWeek,
  monday,
  planSummary,
  relativeDay,
  upcoming,
  weekStatus,
  weekday,
  weightMean,
  weightRate,
} from '@lowkkey/core';
import { Medal } from '../ui/Medal.tsx';
import { Chev } from '../ui/Graphics.tsx';
import { PlanItems, StatusLine } from './PlanView.tsx';

const defaultOrder: BoardCard[] = ['next', 'week', 'body', 'letter', 'medal'];
const isCard = (value: string): value is BoardCard => (BOARD_CARDS as readonly string[]).includes(value);

/** A door takes one sentence back to the conversation. It writes nothing. */
export type Door = (text: string) => void;

function DoorButton({ door, text, label = '聊这个' }: { door: Door; text: string; label?: string }) {
  return (
    <button className="door" onClick={() => door(text)}>
      {label} <span aria-hidden="true">↗</span>
    </button>
  );
}

function targetTitle() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  return q.get('title') ?? q.get('day');
}

/** When a piece of everyday context applies: starting later this week, today only, or until a day. */
function contextWhen(c: Context, today: string) {
  if (c.date > today) return relativeDay(c.date, today) + '起';
  if (c.until === c.date) return '今天';
  return '到' + (diffDays(c.until, today) <= 6 ? relativeDay(c.until, today) : md(c.until));
}

/** The dated background the user mentioned, in force this week. It fades out on its own. */
function Contexts({ contexts, today }: { contexts: Context[]; today: string }) {
  const active = activeContexts(contexts, today);
  if (!active.length) return null;
  return (
    <ul className="bd-now" aria-label="这几天">
      {active.map(c => (
        <li key={c.date}>
          <small>{contextWhen(c, today)}</small>
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

function NextCard({ facts, today, door }: { facts: StateResponse; today: string; door: Door }) {
  const up = upcoming(facts, today),
    first = up[0],
    rest = up.slice(1),
    note = datedCuration(facts, 'next', today);
  // A receipt that points at a later day opens the full week straight away.
  const [open, setOpen] = useState(() => {
    const title = targetTitle();
    return !!title && !!first && title !== first.plan.title;
  });
  const firstTitle = first?.plan.title;
  useEffect(() => {
    const sync = () => {
      const title = targetTitle();
      if (title && firstTitle && title !== firstTitle) setOpen(true);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [firstTitle]);
  if (!first)
    return (
      <article className="bd-card bd-rest">
        <div className="bd-kind">rest</div>
        <p className="bd-sub">
          {facts.plans.length
            ? '这一周没有安排了。休息也是计划的一部分。'
            : '还没有训练安排。和你的 AI 聊好之后，会出现在这里。'}
        </p>
        {facts.plans.length ? (
          <DoorButton door={door} text="下周的安排，我们聊聊。" label="聊下周" />
        ) : (
          <a className="door" href="#start">
            去和 AI 聊 <span aria-hidden="true">↗</span>
          </a>
        )}
      </article>
    );
  const items = first.plan.items,
    required = items.filter(i => !i.optional);
  return (
    <article className="bd-card bd-next" id={'next-' + first.plan.title}>
      <div className="bd-kind">
        next
        <span>
          {first.rel} · 周{'日一二三四五六'[weekday(first.date)]} {md(first.date)}
        </span>
      </div>
      <h3>{first.plan.title}</h3>
      <div className="bd-sub">
        {required.length} 个动作 · {required.reduce((a, i) => a + i.sets, 0)} 组
        {items.length > required.length ? ` · 另有 ${items.length - required.length} 个可选` : ''}
      </div>
      {note?.date === first.date && <p className="cl sm bd-note">{note.text}</p>}
      {!open && (
        <ul className="bd-items">
          {required.map((it, i) => (
            <li key={i}>
              <span>{planSummary(it).replace(/\s[\d.]+$/, '')}</span>
              <b className="tn">
                {it.load == null ? (
                  <small>现场试</small>
                ) : (
                  <>
                    {fmt(it.load)}
                    <small>{it.unit}</small>
                  </>
                )}
              </b>
            </li>
          ))}
        </ul>
      )}
      <div className="bd-reveal" data-open={open ? '' : undefined} inert={!open} aria-hidden={!open}>
        <div>
          <PlanItems items={items} facts={facts} />
          {rest.length > 0 && (
            <div className="bd-later">
              <div className="sh">
                <h2>later</h2>
                <span>这一周剩下的</span>
              </div>
              {rest.map(r => (
                <details className="dy" key={r.date} id={'next-' + r.plan.title}>
                  <summary>
                    <b>{r.plan.title}</b>
                    <span className="d">
                      {r.rel} {md(r.date)}
                    </span>
                    <span className="s">
                      {r.plan.items
                        .filter(i => !i.optional)
                        .map(planSummary)
                        .join(' · ')}
                    </span>
                    <Chev />
                  </summary>
                  {r.plan.coach && <p className="coach cl sm">{r.plan.coach}</p>}
                  <PlanItems items={r.plan.items} facts={facts} />
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="bd-actions">
        <button className="bd-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '收起' : '完整安排'}
        </button>
        <DoorButton door={door} text={`我们聊聊${first.rel}的${first.plan.title}。`} label="聊这一天" />
      </div>
    </article>
  );
}

function WeekCard({ facts, today, door }: { facts: StateResponse; today: string; door: Door }) {
  const week = weekStatus(facts, today),
    r = 26,
    c = 2 * Math.PI * r,
    ratio = week.planned ? Math.min(1, week.done / week.planned) : 0;
  return (
    <article className="bd-card bd-week">
      <div className="bd-kind">
        week<span>{facts.sessions.length ? `week ${week.index}` : ''}</span>
      </div>
      <div className="bd-ring">
        <svg viewBox="0 0 60 60" aria-hidden="true">
          <defs>
            <linearGradient id="bd-ring-g" x1="0" x2="1">
              <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
              <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
            </linearGradient>
          </defs>
          <circle cx="30" cy="30" r={r} className="track" />
          <circle cx="30" cy="30" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />
        </svg>
        <b className="tn">
          {week.done}
          <small> / {week.planned || '–'}</small>
        </b>
      </div>
      <p className="bd-sub">
        {week.planned === 0
          ? '这周没有计划'
          : week.done >= week.planned
            ? '这周的都练了'
            : `还有 ${week.planned - week.done} 次`}
      </p>
      <DoorButton door={door} text="这周的训练节奏，我想聊聊。" label="聊这周" />
    </article>
  );
}

function BodyCard({ facts, today, door }: { facts: StateResponse; today: string; door: Door }) {
  const weights = [...facts.weights].filter(w => w.date <= today).sort((a, b) => a.date.localeCompare(b.date)),
    latest = weights.at(-1);
  if (!latest) return null;
  const mean = weightMean(weights, today),
    rate = weightRate(weights, today),
    recent = weights.slice(-14),
    lo = Math.min(...recent.map(w => w.lb)) - 0.3,
    hi = Math.max(...recent.map(w => w.lb)) + 0.3,
    x = (i: number) => (recent.length > 1 ? (i / (recent.length - 1)) * 300 : 150),
    y = (v: number) => 34 - ((v - lo) / (hi - lo)) * 30;
  const d = recent.map((w, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(w.lb).toFixed(1)).join(' ');
  return (
    <article className="bd-card bd-body">
      <div className="bd-kind">
        body<span>{md(latest.date)}</span>
      </div>
      <div className="bd-hero">
        <b className="tn">
          {fmt(latest.lb)}
          <small>lb</small>
        </b>
      </div>
      <p className="bd-sub tn">
        {mean.lb == null ? '七日均值待够四次' : `七日均值 ${fmt(mean.lb)}`}
        {rate != null ? ` · ${rate >= 0 ? '+' : ''}${rate.toFixed(1)} / 周` : ''}
      </p>
      <svg className="bd-spark" viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="bd-spark-g" x1="0" x2="1">
            <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
            <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
          </linearGradient>
        </defs>
        {recent.length > 1 && <path d={d} />}
        <circle cx={x(recent.length - 1)} cy={y(latest.lb)} r="3" />
      </svg>
      <a className="bd-link" href="#body" aria-label="打开 body 页" />
      <DoorButton door={door} text="聊聊最近的体重。" label="聊体重" />
    </article>
  );
}

function LetterCard({ facts, today, door }: { facts: StateResponse; today: string; door: Door }) {
  const letter = latestRecap(facts, today);
  if (!letter?.recap?.letter?.length) return null;
  return (
    <article className="bd-card bd-letter">
      <div className="bd-kind">
        letter<span>{letter.week === monday(today) ? '本周' : md(letter.week) + ' 那周'}</span>
      </div>
      {letter.recap.title && <h3>{letter.recap.title}</h3>}
      <p>{letter.recap.letter[0]}</p>
      {letter.recap.sign && <div className="sign">— {letter.recap.sign}</div>}
      <a className="bd-link" href={'#recap?week=' + letter.week} aria-label="读全文" />
      <DoorButton door={door} text="这周的信我读了，想聊聊。" label="回信" />
    </article>
  );
}

function MedalCard({ medals, today, door }: { medals: MedalFact[]; today: string; door: Door }) {
  const fresh = medalsThisWeek(medals, today);
  const shown = fresh.length
    ? fresh.slice(0, 2)
    : medals
        .filter(m => m.date)
        .sort((a, b) => b.date!.localeCompare(a.date!))
        .slice(0, 1);
  if (!shown.length) return null;
  const lead = shown[0];
  return (
    <article className="bd-card bd-medal">
      <div className="bd-kind">
        medal<span>{fresh.length ? '本周落下' : '最近的一枚'}</span>
      </div>
      <div className="bd-medals">
        {shown.map(m => (
          <Medal
            key={m.key}
            motif={m.motif}
            unit={m.unit}
            name={m.name}
            date={m.date ?? undefined}
            size={92}
            transition={'medal-' + m.key}
          />
        ))}
        <p>{shown.length === 1 ? (lead.occasion ?? lead.story[0]) : `${shown.length} 枚新的奖章。`}</p>
      </div>
      <a className="bd-link" href={'#recap?medal=' + lead.key} aria-label="打开成就墙" />
      <DoorButton door={door} text={`我拿到了「${lead.name}」，聊聊这个。`} label="聊这枚" />
    </article>
  );
}

/** The home: a line from the AI, where the week stands, and the cards it arranged. */
export function BoardView({ facts, today, door }: { facts: StateResponse; today: string; door: Door }) {
  const board = boardOf(facts, today);
  const line = board?.line ?? datedCuration(facts, 'next', today)?.text ?? null;
  const wished = (board?.cards ?? []).filter(isCard);
  const order = wished.length ? wished : defaultOrder;
  const cards = order.map(kind => {
    switch (kind) {
      case 'next':
        return <NextCard key={kind} facts={facts} today={today} door={door} />;
      case 'week':
        return <WeekCard key={kind} facts={facts} today={today} door={door} />;
      case 'body':
        return <BodyCard key={kind} facts={facts} today={today} door={door} />;
      case 'letter':
        return <LetterCard key={kind} facts={facts} today={today} door={door} />;
      case 'medal':
        return <MedalCard key={kind} medals={facts.medals} today={today} door={door} />;
    }
  });
  // Week and body sit side by side when the AI placed them next to each other.
  const grouped: ReactNode[] = [];
  for (let i = 0; i < cards.length; i++) {
    const kind = order[i],
      next = order[i + 1];
    if ((kind === 'week' && next === 'body') || (kind === 'body' && next === 'week')) {
      grouped.push(
        <div className="bd-two" key={kind + next}>
          {cards[i]}
          {cards[i + 1]}
        </div>,
      );
      i++;
    } else grouped.push(cards[i]);
  }
  return (
    <>
      {line && <p className="cl bd-presence">{line}</p>}
      <StatusLine facts={facts} today={today} />
      <Contexts contexts={facts.contexts} today={today} />
      <div className="bd-cards">{grouped}</div>
    </>
  );
}
