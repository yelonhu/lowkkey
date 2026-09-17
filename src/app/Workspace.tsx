import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localeSchema, localDateAt, uuidSchema } from '../domain/primitives.ts';
import type { Locale } from '../domain/primitives.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { visibleLedgerEntities } from '../domain/local-ledger.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../domain/profile.ts';
import { summarizeNutrients } from '../domain/nutrition.ts';
import { observed } from '../domain/manual-commands.ts';
import type { ManualMutation, QueuedCommand } from '../domain/manual-commands.ts';
import type { ReturnScene } from '../client/local-database.ts';
import { formatDate, formatNumber } from '../i18n/locale.ts';
import { commandFor, useWorkspace } from './workspace-state.ts';
import type { WorkspaceRuntime } from './workspace-state.ts';
import { flushDrafts, useDraft } from './use-draft.ts';
import { displayMass, WeightView } from './WeightView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { NumericText } from './NumericText.tsx';

function currentPath() { return window.location.pathname + window.location.search; }
function scenePath(scene: ReturnScene | null): string {
  if (!scene) return '/today';
  return scene.view === 'session' ? scene.sessionId ? `/training/sessions/${scene.sessionId}` : '/training' : scene.view === 'weight' ? '/weight' : scene.view === 'diet' ? `/nutrition${scene.localDate ? `?date=${scene.localDate}` : ''}` : scene.view === 'settings' ? '/settings' : '/today';
}
export function pendingCommands(commands: QueuedCommand[]) { return commands.filter(command => !['committed', 'discarded'].includes(command.state)); }
export function LanguagePicker({ value, onChange }: { value: Locale; onChange: (locale: Locale) => void }) {
  const { t } = useTranslation();
  return <select data-testid="language" aria-label={t('changeLanguage')} value={value} onChange={event => onChange(localeSchema.parse(event.target.value))}><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option><option value="en">English</option></select>;
}
export function Workspace({ ownerId, onSignedOut }: { ownerId: string; onSignedOut: () => void }) {
  const { t, i18n } = useTranslation(), state = useWorkspace(ownerId), { runtime, ledger, commands } = state;
  const [path, setPath] = useState(currentPath), [frontPath, setFrontPath] = useState(() => currentPath().startsWith('/assistant') ? '/today' : currentPath()), [notice, setNotice] = useState<string | null>(null), restored = useRef(false);
  const locale = localeSchema.parse(i18n.resolvedLanguage), entities = ledger ? visibleLedgerEntities(ledger) : [], profile = entities.find(item => item.kind === 'user_profile')?.value;
  const chat = path.startsWith('/assistant'), timezone = profile ? effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()) : 'UTC', today = localDateAt(new Date(), timezone);
  const active = entities.filter(item => item.kind === 'workout_session').find(item => item.value.status === 'in_progress');
  useEffect(() => { const changed = () => { const value = currentPath(); setPath(value); if (!value.startsWith('/assistant')) setFrontPath(value); }; window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed); }, []);
  useEffect(() => { if (profile) void i18n.changeLanguage(profile.locale); }, [profile?.locale, i18n]);
  useEffect(() => {
    const rejected = commands.findLast(command => command.mutation.kind === 'profile.update' && command.mutation.input.locale === locale && ['conflict', 'needs_review', 'rejected'].includes(command.state));
    if (rejected && profile && locale !== profile.locale) { void i18n.changeLanguage(profile.locale); setNotice('errors:recordChanged'); }
  }, [commands, locale, profile, i18n]);
  useEffect(() => {
    if (!runtime || !ledger || restored.current) return; restored.current = true;
    if (path === '/' || path === '/today') { const destination = active ? `/training/sessions/${active.value.id}` : '/today'; history.replaceState(null, '', destination); setPath(destination); setFrontPath(destination); }
    else if (path.startsWith('/assistant')) void runtime.database.readScene().then(scene => setFrontPath(scenePath(scene))).catch(() => setNotice('storageFailed'));
  }, [runtime, ledger, path, active]);
  async function navigate(destination: string) {
    try { await flushDrafts(); history.pushState(null, '', destination); setPath(destination); if (!destination.startsWith('/assistant')) setFrontPath(destination); window.scrollTo(0, 0); if (runtime) void runtime.synchronizer.refresh(); }
    catch { setNotice('storageFailed'); }
  }
  async function openChat() {
    if (!runtime) return;
    try {
      await flushDrafts(); const previous = await runtime.database.readScene(), selectedSession = /^\/training\/sessions\/([^/?]+)/.exec(frontPath)?.[1];
      const scene: ReturnScene = { ownerId, view: frontPath.startsWith('/training') ? 'session' : frontPath.startsWith('/weight') ? 'weight' : frontPath.startsWith('/nutrition') ? 'diet' : frontPath.startsWith('/settings') ? 'settings' : 'overview', localDate: new URL(frontPath, location.origin).searchParams.get('date') ?? today, sessionId: selectedSession && uuidSchema.safeParse(selectedSession).success ? selectedSession : null, currentGroupId: previous && previous.sessionId === selectedSession ? previous.currentGroupId : null, scrollY: window.scrollY, timerStartedAt: previous && previous.sessionId === selectedSession ? previous.timerStartedAt : null, draftId: frontPath.startsWith('/weight') ? 'weight-form' : null, updatedAt: new Date().toISOString() };
      await runtime.database.saveScene(scene); await navigate('/assistant');
    } catch { setNotice('storageFailed'); }
  }
  async function returnToFront() {
    if (!runtime) return;
    try { const scene = await runtime.database.readScene(); await navigate(scenePath(scene)); requestAnimationFrame(() => window.scrollTo(0, scene?.scrollY ?? 0)); }
    catch { setNotice('storageFailed'); }
  }
  async function preference(input: { locale?: Locale; bodyWeightUnit?: 'kg' | 'lb' }) {
    if (!runtime || !ledger || !profile) return;
    if (input.locale) void i18n.changeLanguage(input.locale);
    try {
      const previous = commands.findLast(command => command.mutation.kind === 'profile.update' && (['queued', 'sending', 'uncertain'].includes(command.state) || (command.state === 'committed' && command.receipt?.recordRefs.some(ref => ref.type === 'user_profile' && ref.id === profile.id && ref.revision > profile.revision))));
      const mutation: ManualMutation = { kind: 'profile.update', target: previous ? { type: 'user_profile', id: profile.id, source: { kind: 'receipt', operationId: previous.operationId } } : observed({ type: 'user_profile', id: profile.id, revision: profile.revision }), input };
      const command = commandFor(ledger, mutation, profile.id, today, timezone); command.dependencies = previous ? [previous.operationId] : [];
      await runtime.database.enqueueCommand(command); void runtime.queue.flush();
    } catch { if (input.locale) void i18n.changeLanguage(profile.locale); setNotice('storageFailed'); }
  }
  const denied = state.syncStatus.state === 'auth_required' || state.queueStatus.state === 'auth_required';
  const disconnected = state.syncStatus.state === 'offline' || state.queueStatus.state === 'offline';
  const pendingCount = pendingCommands(commands).length;
  const syncText = disconnected ? 'offline' : commands.some(command => command.state === 'conflict') ? 'conflict' : state.syncStatus.errorCode || state.queueStatus.errorCode ? 'syncFailed' : pendingCount ? 'pendingCount' : state.syncStatus.state === 'current' ? 'synced' : 'syncing';
  return <div className="app-shell">
    <header className="app-header"><button className="brand quiet" onClick={() => { void navigate('/today'); }}>lowkkey<span aria-hidden="true">.</span></button>{!denied && <div className="header-actions"><button className="quiet avatar" aria-label={t('settings')} onClick={() => { void navigate('/settings'); }}>{profile?.displayName.slice(0, 1) ?? '○'}</button><button className="chat-button" aria-label={t(chat ? 'assistant:back' : 'assistant:openLabel')} onClick={() => { void (chat ? returnToFront() : openChat()); }}>{t(chat ? 'assistant:back' : 'assistant:open')}</button></div>}</header>
    {notice && <p role="alert" className="notice">{t(notice)}</p>}{state.error && <div role="alert"><p>{t('storageFailed')}</p>{!denied && <button className="quiet" onClick={() => { void state.retry(); }}>{t('retry')}</button>}</div>}
    {denied ? <section className="panel"><p>{t(state.syncStatus.errorCode === 'MEMBER_SUSPENDED' || state.queueStatus.errorCode === 'MEMBER_SUSPENDED' ? 'auth:inactive' : 'auth:signedOut')}</p><button onClick={onSignedOut}>{t('auth:signIn')}</button></section> : !runtime || !ledger || !profile ? <section className="loading-state" data-testid="initial-load"><p role={state.syncStatus.errorCode || disconnected ? 'alert' : 'status'}>{t(disconnected ? 'offlineUnavailable' : state.syncStatus.errorCode ? 'loadFailed' : 'loading')}</p>{runtime && <button className="quiet" onClick={() => { void state.retry(); }}>{t('retry')}</button>}</section> : <>
      <div className="sync-bar" role="status" data-sync-state={syncText}><span><NumericText>{t(syncText, { count: pendingCount })}</NumericText></span>{disconnected && pendingCount > 0 && <span><NumericText>{t('pendingCount', { count: pendingCount })}</NumericText></span>}{(state.syncStatus.errorCode || state.queueStatus.errorCode) && <button className="quiet" onClick={() => { void runtime.queue.retry(); }}>{t('retry')}</button>}</div>
      <main id="main-content" aria-label={t('a11y:main')}><div hidden={chat} className="workspace-face" key="front">
        {frontPath !== '/today' && frontPath !== '/' && <button className="quiet back-link" onClick={() => { void navigate('/today'); }}>← {t('today')}</button>}
        {frontPath.startsWith('/weight') ? <WeightView runtime={runtime} ledger={ledger} profile={profile} commands={commands}/> : frontPath.startsWith('/settings') ? <SettingsView runtime={runtime} ledger={ledger} profile={profile} commands={commands} preference={preference} onSignedOut={onSignedOut}/> : frontPath.startsWith('/training') || frontPath.startsWith('/nutrition') ? <section className="panel"><h1>{t(frontPath.startsWith('/training') ? 'today:training' : 'today:nutrition')}</h1><p>{t('unavailableFeature')}</p></section> : <Overview ledger={ledger} profile={profile} navigate={destination => { void navigate(destination); }}/>}
      </div>{chat && <ConversationDraft runtime={runtime} timezone={timezone} back={() => { void returnToFront(); }}/>}</main>
      <footer className="app-footer"><LanguagePicker value={locale} onChange={value => { void preference({ locale: value }); }}/><button className="quiet" onClick={() => { void runtime.synchronizer.refresh(); }}>{t('refresh')}</button></footer>
    </>}
  </div>;
}
function Overview({ ledger, profile, navigate }: { ledger: LocalLedger; profile: ProfileSnapshot; navigate: (destination: string) => void }) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage), timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone), entries = visibleLedgerEntities(ledger);
  const latest = entries.flatMap(item => item.kind === 'weight_entry' && item.value.isPrimary ? [item.value] : []).sort((a, b) => b.localDate.localeCompare(a.localDate))[0];
  const active = entries.filter(item => item.kind === 'workout_session').find(item => item.value.status === 'in_progress'), mealIds = new Set(entries.flatMap(item => item.kind === 'meal' && item.value.localDate === today ? [item.value.id] : []));
  const claim = entries.filter(item => item.kind === 'day_claim').find(item => item.value.localDate === today), pending = entries.filter(item => item.kind === 'import_draft' && item.value.localDate === today && item.value.status !== 'confirmed');
  const nutrients = summarizeNutrients(entries.flatMap(item => item.kind === 'meal_item' && mealIds.has(item.value.mealId) ? [item.value.snapshot.nutrientSnapshot] : []), claim?.value.explicitZeroIntake ?? false);
  const goal = entries.flatMap(item => item.kind === 'goal_version' && item.value.effectiveLocalDate <= today ? [item.value] : []).sort((a, b) => b.effectiveLocalDate.localeCompare(a.effectiveLocalDate) || b.createdDataRevision - a.createdDataRevision)[0];
  const protein = nutrients.knownSum.proteinMg, remaining = goal?.proteinTargetMg !== null && goal?.proteinTargetMg !== undefined && protein !== null ? goal.proteinTargetMg - protein : null;
  return <><div className="page-heading overview-heading"><p className="eyebrow"><time dateTime={today}>{formatDate(new Date(), locale, timezone)}</time></p><h1>{t('today:title')}</h1><p>{t('today:hello', { name: profile.displayName })}</p></div><div className="artifact-grid">
    <section className="artifact-card" data-artifact="SessionArtifact"><p className="card-index">01</p><h2>{t('today:training')}</h2><p className="card-main">{active ? active.value.title ?? t('today:trainingContinue') : t('today:trainingEmpty')}</p><button className={active ? undefined : 'secondary'} onClick={() => navigate(active ? `/training/sessions/${active.value.id}` : '/training')}>{t(active ? 'today:trainingContinue' : 'today:trainingStart')} <span aria-hidden="true">↗</span></button></section>
    <section className="artifact-card" data-artifact="WeightArtifact"><p className="card-index">02</p><h2>{t('today:weight')}</h2><p className="muted">{t('today:latestWeight')}</p><p className="metric">{latest ? displayMass(latest.kgMicros, profile.bodyWeightUnit, locale) : '—'} {latest && <span className="unit">{profile.bodyWeightUnit}</span>}</p><p>{latest ? <time dateTime={latest.localDate}>{formatDate(new Date(`${latest.localDate}T12:00:00Z`), locale, 'UTC')}</time> : t('noRecords')}</p><button onClick={() => navigate('/weight')}>{t('today:weigh')} <span aria-hidden="true">↗</span></button></section>
    <section className="artifact-card" data-artifact="DietArtifact"><p className="card-index">03</p><h2>{t('today:nutrition')}</h2><p className="muted">{t('today:loggedEnergy')}</p><p className="metric">{nutrients.knownSum.energyMkcal === null ? '—' : formatNumber(nutrients.knownSum.energyMkcal / 1000, locale)} <span className="unit">kcal</span></p><p>{t('today:protein')}: {protein === null ? t('unknown') : <><span className="numeric">{formatNumber(protein / 1000, locale)}</span> g</>}</p>{remaining !== null && <p><NumericText>{t(remaining < 0 ? 'today:overProtein' : 'today:remainingProtein', { amount: formatNumber(Math.abs(remaining) / 1000, locale) })}</NumericText></p>}{(!goal || (goal.energyTargetMkcal === null && goal.proteinTargetMg === null)) && <p>{t('today:noGoal')}</p>}<p className="muted">{t(`today:${claim?.value.nutritionCompleteness ?? 'unreviewed'}`)}</p>{nutrients.knownSum.estimated && <p>{t('today:estimated')}</p>}{nutrients.unknownCounts.energy > 0 && <p><NumericText>{t('today:unknownEnergy', { count: nutrients.unknownCounts.energy })}</NumericText></p>}{nutrients.unknownCounts.protein > 0 && <p><NumericText>{t('today:unknownProtein', { count: nutrients.unknownCounts.protein })}</NumericText></p>}{pending.length > 0 && <p><NumericText>{t('today:pendingMeals', { count: pending.length })}</NumericText></p>}<button className="secondary" onClick={() => navigate(`/nutrition?date=${today}`)}>{t('today:recordMeal')} <span aria-hidden="true">↗</span></button></section>
  </div></>;
}
function ConversationDraft({ runtime, timezone, back }: { runtime: WorkspaceRuntime; timezone: string; back: () => void }) {
  const { t } = useTranslation(), draft = useDraft(runtime.database, 'conversation-unsubmitted', 'conversation', { text: '' }, timezone);
  return <section className="workspace-face conversation"><button className="quiet back-link" onClick={back}>← {t('assistant:back')}</button><h1>{t('assistant:title')}</h1><p>{t('assistant:unavailable')}</p><label htmlFor="conversation-draft">{t('assistant:draft')}</label><textarea id="conversation-draft" disabled={!draft.ready} maxLength={8000} value={draft.fields.text} onChange={event => draft.change('text', event.target.value)} onBlur={() => { void draft.flush().catch(() => {}); }}/><p className="muted">{t('assistant:offline')}</p><p role="status">{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p></section>;
}
