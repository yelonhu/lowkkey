import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoteEntry, NotesModel } from './notes-model.ts';

function NoteSection({
  date,
  today,
  entry,
  model,
}: {
  date: string;
  today: string;
  entry: NoteEntry;
  model: NotesModel;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null),
    [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const resize = () => {
      el.style.height = '0px';
      el.style.height = el.scrollHeight + 'px';
    };
    resize();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [entry.text]);
  const hidden =
    date !== today &&
    !entry.text &&
    !entry.dirty &&
    !entry.saving &&
    !focused &&
    !entry.conflict &&
    !entry.recovered.length;
  const label = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T12:00:00Z'));
  const status = entry.localError
    ? '本机草稿未能保存'
    : entry.conflict || entry.recovered.length
      ? '有另一份内容'
      : entry.error
        ? entry.error
        : entry.saving
          ? '保存中…'
          : entry.dirty
            ? '待保存'
            : entry.server.updated_at
              ? '已保存'
              : '';
  return (
    <section className="note-day" id={'notes-' + date} hidden={hidden} aria-label={label}>
      <header className="note-date">
        <h2>
          <time dateTime={date}>{label}</time>
          {date === today && <span>今天</span>}
        </h2>
        <span className="note-status" role="status">
          <span key={status}>{status}</span>
        </span>
      </header>
      <textarea
        ref={textarea}
        className="note-text"
        aria-label={date + ' 随手记'}
        placeholder={date === today ? '随手记点什么…' : ''}
        value={entry.text}
        rows={date === today ? 5 : 1}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void model.save(date);
        }}
        onChange={event => model.edit(date, event.target.value)}
        onCompositionStart={() => model.composition(date, true)}
        onCompositionEnd={event => {
          model.edit(date, event.currentTarget.value);
          model.composition(date, false);
        }}
      />
      {(entry.error || entry.localError) && !entry.conflict && (
        <button
          className="note-quiet"
          onClick={() => {
            model.edit(date, entry.text);
            void model.refresh(today);
          }}
        >
          重试保存
        </button>
      )}
      {(entry.conflict || entry.recovered.length > 0) && (
        <div className="note-conflict" role="region" aria-label="选择保留的内容">
          <p>这一天有另一份内容。你的文字仍在上方，请比较后选择。</p>
          {entry.conflict && (
            <>
              <h3>云端内容</h3>
              <pre>{entry.conflict.text || '（已清空）'}</pre>
            </>
          )}
          {entry.recovered.map(draft => (
            <div key={draft.key}>
              <h3>另一份本机草稿</h3>
              <pre>{draft.text || '（已清空）'}</pre>
              <button onClick={() => void model.resolve(date, draft)}>保留这份草稿</button>
            </div>
          ))}
          <div className="note-choices">
            <button onClick={() => void model.resolve(date, 'local')}>保留我的内容</button>
            <button onClick={() => void model.resolve(date, 'remote')}>使用云端内容</button>
          </div>
        </div>
      )}
    </section>
  );
}
export function NotesView({
  model,
  today,
  target,
  active = true,
}: {
  model: NotesModel;
  today: string;
  target: string | null;
  active?: boolean;
}) {
  const [away, setAway] = useState(false),
    positioned = useRef(false),
    positionedTarget = useRef<string | null>(null),
    anchor = useRef<{ id: string; top: number } | null>(null);
  useEffect(() => {
    if (active && target?.startsWith('notes-')) void model.loadDate(target.slice(6));
  }, [model, active, target]);
  model.entry(today);
  const dates = [...model.entries.keys()].sort();
  useLayoutEffect(() => {
    if (!active) return;
    if (anchor.current && !model.loading) {
      const el = document.getElementById(anchor.current.id);
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - anchor.current.top);
      anchor.current = null;
    }
    if (model.loaded && (!positioned.current || (target && positionedTarget.current !== target))) {
      const node = document.getElementById(target ?? 'notes-' + today);
      if (node) {
        positioned.current = true;
        positionedTarget.current = target;
        node.scrollIntoView({ block: 'start' });
      }
    }
  }, [model.version, model.loaded, today, target, active]);
  useEffect(() => {
    const node = document.getElementById('notes-' + today);
    if (!node) return;
    const observer = new IntersectionObserver(([e]) => setAway(!e.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, [today]);
  return (
    <div className="notebook">
      {model.cursor && (
        <button
          className="note-quiet earlier-notes"
          disabled={model.loading}
          onClick={() => {
            const first = dates.find(date => model.entries.get(date)?.text);
            const el = first ? document.getElementById('notes-' + first) : null;
            anchor.current = el ? { id: el.id, top: el.getBoundingClientRect().top } : null;
            void model.earlier();
          }}
        >
          {model.loading ? '正在读取…' : '更早的记录'}
        </button>
      )}
      {model.error && (
        <div className="note-notice" role="alert">
          {model.error}
          <button onClick={() => void model.refresh(today)}>重试</button>
        </div>
      )}
      {!model.loaded && model.loading && <p className="meta">正在打开随手记…</p>}
      {dates.map(date => (
        <NoteSection key={date} date={date} today={today} entry={model.entries.get(date)!} model={model} />
      ))}
      {away && (
        <button
          className="back-to-today"
          onClick={() => document.getElementById('notes-' + today)?.scrollIntoView({ block: 'start' })}
        >
          回到今天
        </button>
      )}
    </div>
  );
}
