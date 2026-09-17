import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, localeSchema, localDateAt, unitSchema, uuidSchema } from '../domain/primitives.ts';
import { normalizeManualDecimal, normalizeMass } from '../domain/numbers.ts';
import { formatDate, formatNumber } from '../i18n/locale.ts';
import { createWeightSchema, patchWeightSchema, weightTrend } from '../domain/weight.ts';
import type { Weight } from '../domain/weight.ts';
import type { ProfileSnapshot } from '../domain/profile.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import { visibleLedgerEntities } from '../domain/local-ledger.ts';
import { observed } from '../domain/manual-commands.ts';
import type { ManualMutation, QueuedCommand } from '../domain/manual-commands.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { useDraft } from './use-draft.ts';
import { commandFor } from './workspace-state.ts';
import type { WorkspaceRuntime } from './workspace-state.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { NumericText } from './NumericText.tsx';

export function displayMass(kgMicros: number, unit: 'kg' | 'lb', locale: ReturnType<typeof localeSchema.parse>) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(kgMicros / 1000000 / (unit === 'lb' ? 0.45359237 : 1));
}
export const queueStateKey: Record<QueuedCommand['state'], string> = { queued: 'savedLocally', sending: 'syncing', uncertain: 'syncFailed', committed: 'synced', conflict: 'conflict', needs_review: 'needsReview', rejected: 'rejected', discarded: 'discard' };

export function WeightView({ runtime, ledger, profile, commands }: { runtime: WorkspaceRuntime; ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[] }) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage), timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const records = useMemo(() => visibleLedgerEntities(ledger).flatMap(item => item.kind === 'weight_entry' ? [item.value] : []).sort((a, b) => b.localDate.localeCompare(a.localDate) || (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt)), [ledger]);
  const defaults = { value: '', unit: profile.bodyWeightUnit, date: today, condition: 'unspecified', targetId: '', targetRevision: '', replacementOperation: '', primaryChoice: 'extra', primaryId: '', primaryRevision: '' };
  const draft = useDraft(runtime.database, 'weight-form', 'weight', defaults, timezone), fields = draft.fields;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [outlierAccepted, setOutlierAccepted] = useState<string | null>(null), [deleteTarget, setDeleteTarget] = useState<Weight | null>(null), [limit, setLimit] = useState(20);
  const [latestActionId, setLatestActionId] = useState<string | null>(null), [quickUndoId, setQuickUndoId] = useState<string | null>(null), [deleteReview, setDeleteReview] = useState<QueuedCommand | null>(null);
  const submitting = useRef(false), undoing = useRef(new Set<string>());
  const form = useRef<HTMLFormElement>(null);
  const action = commands.find(command => command.operationId === latestActionId);
  // Start the ten-second affordance when this tab receives the successful
  // create receipt. Old receipts loaded from disk do not restart the window.
  useEffect(() => {
    if (action?.state !== 'committed' || action.mutation.kind !== 'weight.create') return;
    setQuickUndoId(action.operationId);
    const timer = setTimeout(() => setQuickUndoId(null), 10000);
    return () => clearTimeout(timer);
  }, [action?.operationId, action?.state, action?.mutation.kind]);
  const editing = records.find(record => record.id === fields.targetId), primary = records.find(record => record.localDate === fields.date && record.isPrimary && record.id !== fields.targetId), reference = records.find(record => record.localDate <= fields.date && record.isPrimary && record.id !== fields.targetId);
  let normalized: number | null = null;
  try { normalized = normalizeMass(normalizeManualDecimal(fields.value), unitSchema.parse(fields.unit), 1, 500).kgMicros; } catch { /* Raw partial input remains a draft. */ }
  const outlier = reference && normalized !== null && Math.abs(normalized - reference.kgMicros) * 100 > reference.kgMicros * 5;
  const outlierKey = reference ? `${reference.id}:${reference.revision}:${fields.value}:${fields.unit}:${fields.date}` : null;
  const dateLabel = (date: string) => formatDate(new Date(`${date}T12:00:00Z`), locale, 'UTC');
  const from = addDays(today, -27), trend = weightTrend(records, from, today), points = trend.trend.flatMap((point, index) => point.meanKgMicros === null ? [] : [{ x: index, y: point.meanKgMicros }]);
  // Draw primary points last so an equal-valued extra cannot hide their fill.
  const rawPoints = records.filter(record => record.localDate >= from && record.localDate <= today).sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));
  const values = [...points.map(point => point.y), ...rawPoints.map(record => record.kgMicros)];
  const minimum = values.length ? Math.min(...values) : 0, maximum = values.length ? Math.max(...values) : 0, padding = Math.max((maximum - minimum) * 0.1, 500000), lo = minimum - padding, hi = maximum + padding;
  const plotY = (value: number) => 132 - (value - lo) / (hi - lo) * 112, plotX = (date: string) => 54 + (Date.parse(date) - Date.parse(from)) / 86400000 * 8.5;
  const primaryChanged = fields.primaryChoice === 'replace' && (!primary || fields.primaryId !== primary.id || fields.primaryRevision !== String(primary.revision));
  const weightOperations = new Set(commands.filter(command => command.mutation.kind.startsWith('weight.')).map(command => command.operationId));
  const pending = commands.filter(command => (command.mutation.kind.startsWith('weight.') || (command.mutation.kind === 'operation.undo' && weightOperations.has(command.mutation.originalId))) && !['committed', 'discarded'].includes(command.state));
  const undoPending = (id: string) => commands.some(command => command.mutation.kind === 'operation.undo' && command.mutation.originalId === id && command.state !== 'discarded');
  const feedbackKey = action?.state === 'committed' ? action.mutation.kind === 'weight.create' ? 'weight:created' : action.mutation.kind === 'weight.update' ? 'weight:updated' : action.mutation.kind === 'weight.delete' ? 'weight:deleted' : 'weight:undone' : action ? queueStateKey[action.state] : null;
  const replacementId = action?.state === 'committed' ? action.receipt?.result.replacementPrimaryId : null;
  const replacement = records.find(record => record.id === replacementId);
  async function submit() {
    if (submitting.current) return; submitting.current = true; setBusy(true); setMessage(null);
    try {
      const id = fields.targetId ? uuidSchema.parse(fields.targetId) : crypto.randomUUID();
      normalizeMass(normalizeManualDecimal(fields.value), unitSchema.parse(fields.unit), 1, 500);
      if (primaryChanged) { setMessage('weight:primaryChanged'); return; }
      const confirmation = { primaryChoice: fields.primaryChoice as 'extra' | 'replace', ...(primary && fields.primaryChoice === 'replace' ? { expectedPrimary: { id: fields.primaryId, revision: Number(fields.primaryRevision) } } : {}), confirmedOutlier: outlierAccepted !== null && outlierAccepted === outlierKey, ...(reference ? { outlierReference: { id: reference.id, revision: reference.revision } } : {}) };
      const raw = { localDate: fields.date, entryTimezone: fields.targetId && editing?.localDate === fields.date ? editing.entryTimezone : timezone, occurredAt: fields.targetId && editing?.localDate === fields.date ? editing.occurredAt : fields.date === today ? new Date().toISOString() : null, timePrecision: fields.targetId && editing?.localDate === fields.date ? editing.timePrecision : fields.date === today ? 'instant' : 'date', value: normalizeManualDecimal(fields.value), unit: unitSchema.parse(fields.unit), condition: fields.condition, ...confirmation };
      const mutation: ManualMutation = fields.targetId ? { kind: 'weight.update', target: { type: 'weight_entry', id, source: { kind: 'observed', revision: Number(fields.targetRevision) } }, input: patchWeightSchema.parse(raw) } : { kind: 'weight.create', input: createWeightSchema.parse({ id, ...raw }) };
      if (fields.date > today) { setMessage('errors:invalidInput'); return; }
      if (outlier && outlierAccepted !== outlierKey) { setMessage('errors:needsConfirmation'); return; }
      const submitted = await draft.flush(), command = commandFor(ledger, mutation, id, fields.date, raw.entryTimezone);
      if (fields.replacementOperation) {
        const previous = await runtime.database.readCommand(fields.replacementOperation);
        if (!previous) throw new Error('Previous command missing');
        await runtime.database.resolveCommand(previous.operationId, previous.localRevision, command, submitted);
      } else await runtime.database.enqueueCommand(command, submitted);
      draft.resetAfterSubmit(defaults); setOutlierAccepted(null); setLatestActionId(command.operationId); void runtime.queue.flush();
    } catch (error) { setMessage(error instanceof Error && (error.name === 'ZodError' || error.message.includes('MASS_')) ? 'errors:invalidInput' : 'storageFailed'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function edit(record: Weight) {
    draft.replace({ ...defaults, value: record.value, unit: record.unit, date: record.localDate, condition: record.condition, targetId: record.id, targetRevision: String(record.revision) }); setMessage(null); form.current?.scrollIntoView({ block: 'start' }); form.current?.querySelector<HTMLInputElement>('#weight-value')?.focus({ preventScroll: true });
  }
  async function review(command: QueuedCommand) {
    if (command.mutation.kind === 'weight.delete') {
      const targetId = command.mutation.target.id, current = records.find(record => record.id === targetId);
      if (!current) { setMessage('weight:missingTarget'); return; }
      setDeleteReview(command); setDeleteTarget(current); return;
    }
    if (command.mutation.kind !== 'weight.create' && command.mutation.kind !== 'weight.update') return;
    const mutation = command.mutation, current = mutation.kind === 'weight.update' ? records.find(record => record.id === mutation.target.id) : null;
    if (mutation.kind === 'weight.update' && !current) { setMessage('weight:missingTarget'); return; }
    draft.replace({ ...defaults, value: mutation.input.value ?? current?.value ?? '', unit: mutation.input.unit ?? current?.unit ?? profile.bodyWeightUnit, date: mutation.input.localDate ?? current?.localDate ?? command.localDate, condition: mutation.input.condition ?? current?.condition ?? 'unspecified', targetId: current?.id ?? '', targetRevision: current ? String(current.revision) : '', replacementOperation: command.operationId });
    setOutlierAccepted(null); setMessage(current ? 'weight:editingBaseline' : null); form.current?.scrollIntoView({ block: 'start' }); form.current?.querySelector<HTMLInputElement>('#weight-value')?.focus({ preventScroll: true });
  }
  async function remove() {
    if (!deleteTarget || submitting.current) return; submitting.current = true; setBusy(true); setMessage(null);
    try {
      const command = commandFor(ledger, { kind: 'weight.delete', target: observed({ type: 'weight_entry', id: deleteTarget.id, revision: deleteTarget.revision }) }, deleteTarget.id, deleteTarget.localDate, deleteTarget.entryTimezone);
      if (deleteReview) await runtime.database.resolveCommand(deleteReview.operationId, deleteReview.localRevision, command);
      else await runtime.database.enqueueCommand(command);
      setLatestActionId(command.operationId); setDeleteTarget(null); setDeleteReview(null); void runtime.queue.flush();
    } catch { setMessage('storageFailed'); } finally { submitting.current = false; setBusy(false); }
  }
  async function undo(operationId: string) {
    if (undoing.current.has(operationId) || undoPending(operationId)) return;
    undoing.current.add(operationId); setMessage(null);
    try {
      const command = commandFor(ledger, { kind: 'operation.undo', originalId: operationId }, operationId, today, timezone);
      await runtime.database.enqueueCommand(command); setLatestActionId(command.operationId); setQuickUndoId(null); void runtime.queue.flush();
    } catch { setMessage('storageFailed'); } finally { undoing.current.delete(operationId); }
  }
  return <div className="weight-view">
    <div className="page-heading"><h1>{t('weight:title')}</h1><p>{t('weight:subtitle')}</p></div>
    <div className="detail-grid"><section className="panel"><h2>{t(fields.targetId ? 'weight:editTitle' : 'weight:new')}</h2>
      <form ref={form} onSubmit={event => { event.preventDefault(); void submit(); }} onBlur={() => { void draft.flush().catch(() => {}); }}>
        <fieldset disabled={!draft.ready || busy}>
          <label htmlFor="weight-value">{t('weight:value')}</label><div className="joined-input"><input id="weight-value" inputMode="decimal" autoComplete="off" value={fields.value} onChange={event => { draft.change('value', event.target.value); setMessage(null); }} aria-invalid={message === 'errors:invalidInput' || undefined} aria-describedby="weight-input-status weight-feedback" required/><select aria-label={t('unit')} value={fields.unit} onChange={event => draft.change('unit', event.target.value)}><option value="kg">kg</option><option value="lb">lb</option></select></div>
          <label htmlFor="weight-date">{t('date')}</label><input id="weight-date" type="date" value={fields.date} max={today} required onChange={event => draft.change('date', event.target.value)}/>
          <label htmlFor="weight-condition">{t('weight:condition')}</label><select id="weight-condition" value={fields.condition} onChange={event => draft.change('condition', event.target.value)}>{['unspecified', 'fasted', 'other'].map(condition => <option key={condition} value={condition}>{t(`weight:${condition}`)}</option>)}</select>
          {primary && <div className="notice"><p>{t('weight:sameDay')} <span className="numeric">{primary.value}</span> {primary.unit}</p><label htmlFor="weight-primary">{t('weight:primaryChoice')}</label><select id="weight-primary" value={primaryChanged ? '' : fields.primaryChoice} onChange={event => draft.replace({ ...fields, primaryChoice: event.target.value, primaryId: primary.id, primaryRevision: String(primary.revision) })}>{primaryChanged && <option value="" disabled>{t('weight:primaryChanged')}</option>}<option value="extra">{t('weight:extra')}</option><option value="replace">{t('weight:replace')}</option></select></div>}
          {primaryChanged && <p role="alert">{t('weight:primaryChanged')}{!primary && <button type="button" className="quiet" onClick={() => draft.replace({ ...fields, primaryChoice: 'extra', primaryId: '', primaryRevision: '' })}>{t('review')}</button>}</p>}
          {outlier && reference && <div className="notice warning"><p><NumericText>{t('weight:outlier', { date: dateLabel(reference.localDate), value: reference.value, unit: reference.unit })}</NumericText></p><label className="check-label"><input type="checkbox" checked={outlierAccepted === outlierKey} onChange={event => setOutlierAccepted(event.target.checked ? outlierKey : null)}/>{t('weight:confirmOutlier')}</label></div>}
          {fields.targetId && <p className="muted">{t('weight:editingBaseline')}</p>}
          <div className="actions"><button type="submit">{t('save')}</button>{(fields.targetId || fields.replacementOperation) && <button className="quiet" type="button" onClick={() => { void draft.clear(defaults).catch(() => setMessage('storageFailed')); }}>{t('cancel')}</button>}</div>
        </fieldset>
        <p id="weight-input-status" role="status" className={draft.error ? 'error' : 'muted'}>{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p>
        {message && <p role="alert">{t(message)}</p>}
        <div id="weight-feedback" data-testid="weight-feedback" data-result-state={action?.state}>
          {feedbackKey && <p role="status">{t(feedbackKey)}</p>}
          {replacementId && <p role="status" data-testid="replacement-primary"><NumericText>{replacement ? t('weight:primaryPromoted', { date: dateLabel(replacement.localDate), value: replacement.value, unit: replacement.unit }) : t('weight:primaryPromotedPending')}</NumericText></p>}
          {action?.operationId === quickUndoId && action.state === 'committed' && !undoPending(action.operationId) && <button type="button" className="quiet" data-testid="quick-undo" onClick={() => { void undo(action.operationId); }}>{t('weight:undoNew')}</button>}
        </div>
      </form>
    </section><section className="panel"><h2><NumericText>{t('weight:trend')}</NumericText></h2>
      {rawPoints.length > 0 && <><svg className="trend-chart" viewBox="0 0 300 162" role="img" aria-label={t('weight:chartDescription')}><path d="M54 16V136H288" className="chart-axis"/><text x="49" y="24" textAnchor="end">{displayMass(hi, profile.bodyWeightUnit, locale)}</text><text x="49" y="134" textAnchor="end">{displayMass(lo, profile.bodyWeightUnit, locale)}</text><text x="54" y="156">{from.slice(5)}</text><text x="284" y="156" textAnchor="end">{today.slice(5)}</text>{trend.trend.map((point, index) => { const previous = trend.trend[index - 1]; return point.meanKgMicros !== null && previous?.meanKgMicros !== null && previous?.meanKgMicros !== undefined ? <line key={point.localDate} x1={plotX(previous.localDate)} x2={plotX(point.localDate)} y1={plotY(previous.meanKgMicros)} y2={plotY(point.meanKgMicros)} className="trend-line"/> : null; })}{rawPoints.map(record => <circle key={record.id} data-measurement={record.id} cx={plotX(record.localDate)} cy={plotY(record.kgMicros)} r="3" className={record.isPrimary ? 'raw-point' : 'extra-point'}><title>{dateLabel(record.localDate)}: {record.value} {record.unit}</title></circle>)}</svg><p className="muted"><NumericText>{t('weight:chartDescription')}</NumericText> · {profile.bodyWeightUnit}</p></>}
      {trend.trend.at(-1)?.meanKgMicros != null ? <p className="metric">{displayMass(trend.trend.at(-1)!.meanKgMicros!, profile.bodyWeightUnit, locale)} <span className="unit">{profile.bodyWeightUnit}</span></p> : <p><NumericText>{t('weight:insufficient')}</NumericText></p>}
      <p className="muted"><NumericText>{t('weight:samples', { count: trend.currentSampleDays })}</NumericText></p>
    </section></div>
    {pending.length > 0 && <section className="panel pending-list"><h2>{t('weight:pending')}</h2>{pending.map(command => {
      const mutation = command.mutation, value = 'input' in mutation && 'value' in mutation.input ? mutation.input.value : null, unit = 'input' in mutation && 'unit' in mutation.input ? mutation.input.unit : null, current = 'target' in mutation ? records.find(record => record.id === mutation.target.id) : null;
      const requiresReview = ['conflict', 'needs_review', 'rejected'].includes(command.state);
      return <article key={command.operationId} data-command-state={command.state}>
        <p>{t(queueStateKey[command.state])}</p>
        {mutation.kind === 'weight.delete' && <p>{t('weight:deleteAction')}</p>}{mutation.kind === 'operation.undo' && <p>{t(requiresReview ? 'weight:undoBlocked' : 'weight:undoAction')}</p>}
        {value && <p><NumericText>{t('weight:candidate', { value, unit })}</NumericText></p>}{current && <p><NumericText>{t('weight:current', { value: current.value, unit: current.unit })}</NumericText></p>}
        {requiresReview && <div className="actions">{mutation.kind !== 'operation.undo' && <button className="quiet" onClick={() => { void review(command); }}>{t('review')}</button>}<button className="quiet" onClick={() => { void runtime.database.resolveCommand(command.operationId, command.localRevision).catch(() => setMessage('storageFailed')); }}>{t('discard')}</button></div>}
        {command.state === 'uncertain' && <button className="quiet" onClick={() => { void runtime.queue.retry(); }}>{t('retry')}</button>}
      </article>;
    })}</section>}
    <section className="panel"><h2>{t('weight:history')}</h2>{records.length === 0 && <p>{t('weight:noHistory')}</p>}
      <ul className="record-list">{records.slice(0, limit).map(record => <li key={record.id} data-weight-id={record.id}>
        <div><p className="record-value">{displayMass(record.kgMicros, profile.bodyWeightUnit, locale)} <span className="unit">{profile.bodyWeightUnit}</span></p><p><time dateTime={record.localDate}>{dateLabel(record.localDate)}</time> · {t(record.isPrimary ? 'weight:primary' : 'weight:additional')}</p><p className="muted"><NumericText>{t('weight:original', { value: record.value, unit: record.unit })}</NumericText>{record.timePrecision === 'date' && ` · ${t('weight:dateOnly')}`}</p></div>
        <div className="actions"><button className="quiet" onClick={() => edit(record)}>{t('edit')}</button><button className="quiet danger" onClick={() => { setDeleteReview(null); setDeleteTarget(record); }}>{t('remove')}</button>
          {commands.some(command => command.operationId === record.operationId && command.receipt?.undoAvailable && new Date(command.receipt.committedAt).getTime() + 30 * 86400000 >= Date.now()) && !undoPending(record.operationId) && <button className="quiet" onClick={() => { void undo(record.operationId); }}>{t('undo')}</button>}
        </div>
      </li>)}</ul>{limit < records.length && <button className="quiet" data-testid="weight-load-more" onClick={() => setLimit(limit + 20)}>{t('weight:loadMore')}</button>}
    </section>
    {deleteTarget && <ConfirmDialog title={t('weight:confirmDelete')} onCancel={() => { if (!busy) { setDeleteTarget(null); setDeleteReview(null); } }}>
      <p><NumericText>{t('weight:deleteConfirm', { date: dateLabel(deleteTarget.localDate), value: formatNumber(Number(deleteTarget.value), locale), unit: deleteTarget.unit })}</NumericText></p>
      {deleteTarget.isPrimary && <p>{t('weight:deletePrimaryEffect')}</p>}
      <div className="actions"><button className="quiet" autoFocus disabled={busy} onClick={() => { setDeleteTarget(null); setDeleteReview(null); }}>{t('cancel')}</button><button className="danger" disabled={busy} onClick={() => { void remove(); }}>{t('remove')}</button></div>
    </ConfirmDialog>}
  </div>;
}
