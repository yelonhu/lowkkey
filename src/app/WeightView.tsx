import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, localeSchema, localDateAt, unitSchema } from '../domain/primitives.ts';
import { normalizeManualDecimal, normalizeMass } from '../domain/numbers.ts';
import { formatDate } from '../i18n/locale.ts';
import { dailyWeightCreateSchema, dailyWeightEditSchema } from '../domain/daily-records.ts';
import { weightTrend } from '../domain/weight.ts';
import type { Weight } from '../domain/weight.ts';
import type { ProfileSnapshot } from '../domain/profile.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import { observed, versionBindingSchema } from '../domain/manual-commands.ts';
import type { ManualMutation, QueuedCommand } from '../domain/manual-commands.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { useDraft } from './use-draft.ts';
import { commandFor } from './workspace-state.ts';
import type { WorkspaceRuntime } from './workspace-state.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { SaveStatus } from './SaveStatus.tsx';
import { weightProjection } from './weight-state.ts';
import { advanceOwnBinding, serializeTraining } from './training/save-coordinator.ts';
import { versionFor } from './training/training-state.ts';

export function displayMass(kgMicros: number, unit: 'kg' | 'lb', locale: ReturnType<typeof localeSchema.parse>) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(kgMicros / 1000000 / (unit === 'lb' ? 0.45359237 : 1));
}
export const queueStateKey: Record<QueuedCommand['state'], string> = { queued: 'savedLocally', sending: 'syncing', uncertain: 'syncFailed', committed: 'synced', conflict: 'conflict', needs_review: 'needsReview', rejected: 'rejected', discarded: 'discard' };

export function WeightView({ runtime, ledger, profile, commands, date, navigate }: { runtime: WorkspaceRuntime; ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[]; date: string; navigate: (path: string) => Promise<void> }) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage), timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const records = useMemo(() => weightProjection(ledger, commands).filter(item => item.isPrimary), [ledger, commands]);
  const current = records.find(item => item.localDate === date);
  const defaults = (record: Weight | null | undefined = current): Record<string, string> => ({ value: record?.value ?? '', unit: record?.unit ?? profile.bodyWeightUnit, date, condition: record?.condition ?? 'unspecified', targetId: record?.id ?? '', targetBinding: '', newId: crypto.randomUUID(), dirty: 'no' });
  const draft = useDraft(runtime.database, 'weight-day:' + date, 'weight', defaults(), timezone, fields => {
    try { const binding = versionBindingSchema.parse(JSON.parse(fields.targetBinding)); return { localDate: date, baseRefs: binding.source.kind === 'observed' ? [{ type: binding.type, id: binding.id, revision: binding.source.revision }] : [] }; }
    catch { return { localDate: date, baseRefs: [] }; }
  });
  const [restored, setRestored] = useState(false);
  const [editing, setEditing] = useState(false), [details, setDetails] = useState(false), [deleting, setDeleting] = useState<Weight | null>(null), [message, setMessage] = useState<string | null>(null), [outlier, setOutlier] = useState<Weight | null>(null), [reviewing, setReviewing] = useState<QueuedCommand | null>(null), [lastId, setLastId] = useState<string | null>(null), [undoId, setUndoId] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const handler = useRef<() => Promise<unknown>>(async () => undefined), migrated = useRef(false), input = useRef<HTMLInputElement>(null);
  const undoAnnounced = useRef<string | null>(null), requestedFocus = useRef(false);
  const action = commands.find(command => command.operationId === lastId) ?? commands.findLast(command => command.localDate === date && (command.mutation.kind.startsWith('day-weight.') || command.mutation.kind.startsWith('weight.')) && !['committed','discarded'].includes(command.state));
  const problems = commands.filter(command => command.localDate === date && (command.mutation.kind.startsWith('day-weight.') || command.mutation.kind.startsWith('weight.') || command.operationId === lastId) && ['conflict','needs_review','rejected'].includes(command.state));
  useEffect(() => { if (draft.ready && draft.read().dirty !== 'yes' && !editing) draft.resetAfterSubmit(defaults()); }, [current?.id, current?.revision, current?.value, current?.unit, draft.ready]);
  useEffect(() => {
    if (!draft.ready || migrated.current) return; migrated.current = true;
    if (draft.saved) { if (draft.read().dirty === 'yes') setEditing(true); setRestored(true); return; }
    void runtime.database.readDraft('weight-form').then(async old => {
      if (!old || old.rawFields.date !== date || !old.rawFields.value || draft.read().dirty === 'yes') return;
      const fields = old.rawFields;
      draft.replace({ ...defaults(), value: fields.value, unit: fields.unit, condition: fields.condition || 'unspecified', targetId: fields.targetId || '', targetBinding: fields.targetId && fields.targetRevision ? JSON.stringify(observed({ type: 'weight_entry', id: fields.targetId, revision: Number(fields.targetRevision) })) : '', dirty: 'yes' });
      await draft.flush(); await runtime.database.removeDraft('weight-form'); setEditing(true);
    }).catch(() => setMessage('storageFailed')).finally(() => setRestored(true));
  }, [draft.ready]);
  useEffect(() => { if (editing && requestedFocus.current) { requestedFocus.current = false; input.current?.focus({ preventScroll: true }); } }, [editing]);
  useEffect(() => { const commit = (event: Event) => (event as CustomEvent<Array<() => Promise<unknown>>>).detail.push(() => handler.current()); window.addEventListener('lowkkey:commit-editing', commit); return () => window.removeEventListener('lowkkey:commit-editing', commit); }, []);
  useEffect(() => {
    if (action?.state !== 'committed' || action.mutation.kind !== 'day-weight.create' || (action.receipt?.dataRevision ?? Infinity) > ledger.dataRevision) return;
    if (undoAnnounced.current === action.operationId) return; undoAnnounced.current = action.operationId;
    setUndoId(action.operationId); const timer = setTimeout(() => setUndoId(null), 10000); return () => clearTimeout(timer);
  }, [action?.operationId, action?.state, (action?.receipt?.dataRevision ?? Infinity) <= ledger.dataRevision]);
  function change(key: string, value: string) {
    const fields = draft.read();
    draft.replace({ ...fields, [key]: value, dirty: 'yes', targetId: fields.targetId || current?.id || '', targetBinding: fields.targetBinding || (current ? JSON.stringify(observed({ type: 'weight_entry', id: current.id, revision: current.revision })) : '') });
    setMessage(null); setOutlier(null);
  }
  async function save(confirmReference?: Weight, reviewed?: QueuedCommand) {
    return serializeTraining(runtime.database, async () => {
      if (!draft.ready || (draft.read().dirty !== 'yes' && !reviewed)) return;
      const fields = { ...draft.read() };
      let value: string, unit: 'kg' | 'lb', mass: number;
      try { value = normalizeManualDecimal(fields.value); unit = unitSchema.parse(fields.unit); mass = normalizeMass(value, unit, 1, 500).kgMicros; if (date > today) throw Error(); }
      catch { await draft.flush(); setMessage('daily:invalidWeight'); return; }
      setBusy(true);
      try {
        const token = await draft.flush(), fresh = await runtime.database.readLedger(); if (!fresh) throw Error('Storage');
        const queued = await runtime.database.listCommands(), visible = weightProjection(fresh, queued), latest = visible.find(item => item.isPrimary && item.localDate === date);
        if (problems.length && !reviewed) { setMessage('conflict'); return; }
        const target = reviewed ? latest : fields.targetId ? visible.find(item => item.id === fields.targetId) : undefined;
        if (fields.targetId && !target && !reviewed) { setMessage('weight:missingTarget'); return; }
        // Do not convert a concurrent first write into an update without review.
        const reference = visible.find(item => item.isPrimary && item.localDate <= date && item.id !== target?.id);
        if (reference && Math.abs(mass - reference.kgMicros) * 100 > reference.kgMicros * 5 && (confirmReference?.id !== reference.id || confirmReference.revision !== reference.revision)) { setOutlier(reference); return; }
        if (target && value === target.value && unit === target.unit && fields.condition === target.condition && !reviewed) { if (JSON.stringify(draft.read()) === JSON.stringify(fields) && await draft.clear(defaults(target))) setEditing(false); return; }
        const confirmation = { confirmedOutlier: !!confirmReference, ...(confirmReference ? { outlierReference: { id: confirmReference.id, revision: confirmReference.revision } } : {}) };
        const binding = target ? reviewed ? versionFor({ type: 'weight_entry', id: target.id, revision: target.revision }, queued.filter(command => command.operationId !== reviewed.operationId)) : fields.targetBinding ? advanceOwnBinding(versionBindingSchema.parse(JSON.parse(fields.targetBinding)), queued) : versionFor({ type: 'weight_entry', id: target.id, revision: target.revision }, queued) : null;
        const id = target?.id ?? fields.newId;
        const mutation: ManualMutation = binding ? { kind: 'day-weight.update', localDate: date, target: { ...binding, type: 'weight_entry' }, input: dailyWeightEditSchema.parse({ value, unit, condition: fields.condition, ...confirmation }) }
          : { kind: 'day-weight.create', input: dailyWeightCreateSchema.parse({ id, localDate: date, entryTimezone: timezone, timePrecision: 'date', occurredAt: null, value, unit, condition: fields.condition, ...confirmation }) };
        const command = commandFor(fresh, mutation, id, date, target?.entryTimezone ?? timezone);
        if (reviewed) { const previous = await runtime.database.readCommand(reviewed.operationId); if (!previous) throw Error(); await runtime.database.resolveCommand(previous.operationId, previous.localRevision, command, token); }
        else await runtime.database.enqueueCommand(command, token);
        const next = { ...draft.read(), targetId: id, targetBinding: JSON.stringify({ type: 'weight_entry', id, source: { kind: 'receipt', operationId: command.operationId } }) };
        if (JSON.stringify(draft.read()) === JSON.stringify(fields)) { draft.resetAfterSubmit({ ...next, dirty: 'no' }); setEditing(false); } else draft.replace(next);
        setLastId(command.operationId); setMessage(null); setOutlier(null); setReviewing(null); void runtime.queue.flush();
      } catch { setMessage('storageFailed'); throw Error('Weight save failed'); }
      finally { setBusy(false); }
    });
  }
  handler.current = () => save();
  async function remove() {
    if (!deleting || busy) return; setBusy(true);
    try { await serializeTraining(runtime.database, async () => {
      const fresh = await runtime.database.readLedger(); if (!fresh) throw Error();
      const queued = await runtime.database.listCommands(), binding = advanceOwnBinding(observed({ type: 'weight_entry', id: deleting.id, revision: deleting.revision }), queued);
      const command = commandFor(fresh, { kind: 'day-weight.delete', localDate: date, target: { ...binding, type: 'weight_entry' } }, deleting.id, date, deleting.entryTimezone);
      if (reviewing) await runtime.database.resolveCommand(reviewing.operationId, reviewing.localRevision, command); else await runtime.database.enqueueCommand(command);
      await draft.clear(defaults(null)); setLastId(command.operationId); setDeleting(null); setReviewing(null); setDetails(false); setEditing(false); void runtime.queue.flush();
    }); } catch { setMessage('storageFailed'); } finally { setBusy(false); }
  }
  function review(command: QueuedCommand) {
    if (command.mutation.kind === 'day-weight.delete' || command.mutation.kind === 'weight.delete') { if (current) { setReviewing(command); setDeleting(current); } return; }
    if ('input' in command.mutation && 'value' in command.mutation.input) {
      const proposed = command.mutation.input; draft.replace({ ...draft.read(), value: proposed.value ?? draft.read().value, unit: 'unit' in proposed ? proposed.unit ?? draft.read().unit : draft.read().unit, dirty: 'yes' }); setReviewing(command);
    }
  }
  async function undo() {
    if (!undoId) return; const id = undoId; setUndoId(null);
    try { const command = commandFor(ledger, { kind: 'operation.undo', originalId: id }, id, date, timezone); await runtime.database.enqueueCommand(command); setLastId(command.operationId); void runtime.queue.flush(); } catch { setMessage('storageFailed'); }
  }
  const dateLabel = (value: string) => formatDate(new Date(value + 'T12:00:00Z'), locale, 'UTC');
  return <div className="weight-view daily-weight" data-weight-date={date} data-draft-ready={restored}>
    <div className="daily-heading"><h1>{t('weight:title')}</h1><input aria-label={t('date')} type="date" value={date} max={today} onChange={event => { if (event.target.value && event.target.value <= today) void navigate('/weight?date=' + event.target.value); }}/></div>
    <section className="weight-hero" aria-label={t('weight:value')}>
      <div className="weight-reading" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !document.hidden && document.hasFocus() && !details && !outlier && !reviewing) void save().catch(() => undefined); }}>
        {editing ? <><input ref={input} id="weight-value" aria-label={t('weight:value')} inputMode="decimal" autoComplete="off" value={draft.fields.value} disabled={!draft.ready} onChange={event => change('value', event.target.value)} aria-invalid={!!message} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save().catch(() => undefined); } }}/><select aria-label={t('unit')} value={draft.fields.unit} onChange={event => change('unit', event.target.value)}><option>kg</option><option>lb</option></select></>
        : <button className="weight-number quiet" data-testid="weight-reading" disabled={!restored} onClick={() => { requestedFocus.current = true; setEditing(true); }} aria-label={t('daily:editWeight')}><span className="numeric">{current ? displayMass(current.kgMicros, profile.bodyWeightUnit, locale) : '—'}</span><span className="unit">{profile.bodyWeightUnit}</span></button>}
        <button className="quiet weight-more" aria-label={t('details')} onClick={() => setDetails(true)}>···</button>
      </div>
      <div className="weight-feedback" data-testid="weight-feedback" data-result-state={action?.state}><SaveStatus command={action} dataRevision={ledger.dataRevision}/>{undoId && <button className="quiet" data-testid="quick-undo" onClick={() => { void undo(); }}>{t('undo')}</button>}</div>
      {(message || draft.error) && <p role="alert">{t(draft.error ? 'storageFailed' : message!)}</p>}
      {problems.map(command => <div className="row-status" key={command.operationId} data-command-state={command.state}><span>{t(command.mutation.kind === 'operation.undo' ? 'weight:undoBlocked' : queueStateKey[command.state])}</span>{command.mutation.kind !== 'operation.undo' && <button className="quiet" onClick={() => review(command)}>{t('review')}</button>}<button className="quiet" onClick={() => { void runtime.database.resolveCommand(command.operationId, command.localRevision).catch(() => setMessage('storageFailed')); }}>{t('discard')}</button></div>)}
    </section>
    <WeightTrend records={records} date={date} unit={profile.bodyWeightUnit}/>
    <section className="weight-history"><h2>{t('weight:history')}</h2><ul className="record-list">{records.filter(record => record.localDate <= date).slice(0, 28).map(record => <li key={record.id} data-weight-id={record.id}><button className="quiet weight-history-row" onClick={() => { void navigate('/weight?date=' + record.localDate); }}><time dateTime={record.localDate}>{dateLabel(record.localDate)}</time><span className="numeric">{record.value}<span className="unit"> {record.unit}</span></span></button></li>)}</ul>{!records.length && <p className="muted">{t('noRecords')}</p>}</section>
    {details && <ConfirmDialog title={t('details')} onCancel={() => { setDetails(false); void save().catch(() => undefined); }}>
      {current && <p>{t('weight:original', { value: current.value, unit: current.unit })}</p>}
      <label>{t('weight:condition')}<select aria-label={t('weight:condition')} value={draft.fields.condition} onChange={event => change('condition', event.target.value)}>{['unspecified','fasted','other'].map(value => <option key={value} value={value}>{t('weight:' + value)}</option>)}</select></label>
      {current && <button className="quiet danger" onClick={() => { setDetails(false); setDeleting({ ...current }); }}>{t('remove')}</button>}
      <button className="secondary" onClick={() => { setDetails(false); void save().catch(() => undefined); }}>{t('training:done')}</button>
    </ConfirmDialog>}
    {outlier && <ConfirmDialog title={t('errors:needsConfirmation')} onCancel={() => setOutlier(null)}><p>{t('weight:outlier', { date: dateLabel(outlier.localDate), value: outlier.value, unit: outlier.unit })}</p><button onClick={() => { void save(outlier, reviewing ?? undefined).catch(() => undefined); }}>{t('weight:confirmOutlier')}</button><button className="secondary" onClick={() => setOutlier(null)}>{t('cancel')}</button></ConfirmDialog>}
    {reviewing && !deleting && !outlier && <ConfirmDialog title={t('review')} onCancel={() => setReviewing(null)}><p>{t('weight:current', { value: current?.value ?? '—', unit: current?.unit ?? '' })}</p><p>{t('weight:candidate', { value: draft.fields.value, unit: draft.fields.unit })}</p><button onClick={() => { void save(undefined, reviewing).catch(() => undefined); }}>{t('training:applyEdit')}</button><button className="secondary" onClick={() => setReviewing(null)}>{t('cancel')}</button></ConfirmDialog>}
    {deleting && <ConfirmDialog title={t('weight:confirmDelete')} onCancel={() => setDeleting(null)}><p>{t('daily:deleteWeight', { date: dateLabel(date), value: deleting.value, unit: deleting.unit })}</p><button className="danger" disabled={busy} onClick={() => { void remove(); }}>{t('remove')}</button><button className="secondary" onClick={() => setDeleting(null)}>{t('cancel')}</button></ConfirmDialog>}
  </div>;
}
function WeightTrend({ records, date, unit }: { records: Weight[]; date: string; unit: 'kg' | 'lb' }) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage), from = addDays(date, -27), trend = weightTrend(records, from, date);
  const raw = records.filter(record => record.localDate >= from && record.localDate <= date), values = [...raw.map(record => record.kgMicros), ...trend.trend.flatMap(point => point.meanKgMicros === null ? [] : [point.meanKgMicros])];
  const minimum = values.length ? Math.min(...values) : 60_000_000, maximum = values.length ? Math.max(...values) : 80_000_000, padding = Math.max((maximum - minimum) * .15, 500000), lo = minimum - padding, hi = maximum + padding;
  const y = (value: number) => 148 - (value - lo) / (hi - lo) * 126, x = (value: string) => 50 + (Date.parse(value) - Date.parse(from)) / 86400000 * 8.7;
  return <section className="weight-trend" aria-label={t('daily:trend')}><div className="trend-heading"><h2>{t('daily:trend')}</h2><span className="muted">{t('daily:days28')}</span></div>
    <svg className="trend-chart" viewBox="0 0 300 180" role="img" aria-label={t('daily:chartDescription')}><line x1="50" y1="22" x2="285" y2="22" className="chart-axis"/><line x1="50" y1="148" x2="285" y2="148" className="chart-axis"/><text x="45" y="26" textAnchor="end">{values.length ? displayMass(hi, unit, locale) : '—'}</text><text x="45" y="152" textAnchor="end">{values.length ? displayMass(lo, unit, locale) : '—'}</text><text x="50" y="174">{from.slice(5)}</text><text x="285" y="174" textAnchor="end">{date.slice(5)}</text>
      {trend.trend.map((point,index) => { const previous = trend.trend[index - 1]; return point.meanKgMicros != null && previous?.meanKgMicros != null ? <line key={point.localDate} x1={x(previous.localDate)} x2={x(point.localDate)} y1={y(previous.meanKgMicros)} y2={y(point.meanKgMicros)} className="trend-line"/> : null; })}
      {raw.map(record => <circle key={record.id} data-measurement={record.id} cx={x(record.localDate)} cy={y(record.kgMicros)} r="3" className="raw-point"><title>{record.localDate}: {record.value} {record.unit}</title></circle>)}
    </svg><p className="chart-caption">{t(trend.trend.some(point => point.meanKgMicros !== null) ? 'daily:chartDescription' : 'daily:insufficient')}</p>
  </section>;
}
