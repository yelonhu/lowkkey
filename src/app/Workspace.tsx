import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localeSchema, localDateAt, localDateSchema, uuidSchema } from '../domain/primitives.ts';
import type { Locale } from '../domain/primitives.ts';
import { effectiveTimezone } from '../domain/time.ts';
import { visibleLedgerEntities } from '../domain/local-ledger.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../domain/profile.ts';
import { dietProjection, isDietCommand, pendingCommand } from './nutrition/diet-state.ts';
import { DietView } from './nutrition/DietView.tsx';
import type { ManualMutation, QueuedCommand } from '../domain/manual-commands.ts';
import type { ReturnScene } from '../client/local-database.ts';
import { formatDate, formatNumber } from '../i18n/locale.ts';
import { commandFor, useWorkspace } from './workspace-state.ts';
import type { WorkspaceRuntime } from './workspace-state.ts';
import { flushDrafts, useDraft } from './use-draft.ts';
import { displayMass, WeightView } from './WeightView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { NumericText } from './NumericText.tsx';
import { commitTrainingRows, serializeTraining } from './training/save-coordinator.ts';
import { weightProjection } from './weight-state.ts';
import { trainingProjection, versionFor } from './training/training-state.ts';
import { TrainingView } from './training/TrainingView.tsx';

function currentPath() { return window.location.pathname + window.location.search; }
function scenePath(scene: ReturnScene | null): string {
  if (!scene) return '/today';
  return scene.view === 'session' ? '/training' + (scene.localDate ? '?date=' + scene.localDate : '') : scene.view === 'weight' ? '/weight' + (scene.localDate ? '?date=' + scene.localDate : '') : scene.view === 'diet' ? `/nutrition${scene.localDate ? `?date=${scene.localDate}` : ''}` : scene.view === 'settings' ? '/settings' : '/today';
}
export function pendingCommands(commands: QueuedCommand[]) { return commands.filter(command => !['committed', 'discarded'].includes(command.state)); }
export function LanguagePicker({ value, onChange }: { value: Locale; onChange: (locale: Locale) => void }) {
  const { t } = useTranslation();
  return <select data-testid="language" aria-label={t('changeLanguage')} value={value} onChange={event => onChange(localeSchema.parse(event.target.value))}><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option><option value="en">English</option></select>;
}
export function Workspace({ ownerId, onSignedOut }: { ownerId: string; onSignedOut: () => void }) {
  const { t, i18n } = useTranslation(), state = useWorkspace(ownerId), { runtime, ledger, commands } = state;
  const [path, setPath] = useState(currentPath), [frontPath, setFrontPath] = useState(() => currentPath().startsWith('/assistant') ? '/today' : currentPath()), [notice, setNotice] = useState<string | null>(null), restored = useRef(false);
  const languageIntent = useRef<{ locale: Locale; operationId: string } | null>(null);
  const locale = localeSchema.parse(i18n.resolvedLanguage), entities = ledger ? visibleLedgerEntities(ledger) : [], profile = entities.find(item => item.kind === 'user_profile')?.value;
  const chat = path.startsWith('/assistant'), timezone = profile ? effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()) : 'UTC', today = localDateAt(new Date(), timezone);
  const routeDate = new URL(frontPath, location.origin).searchParams.get('date');
  const legacySessionId = /^\/training\/sessions\/([^/?]+)/.exec(frontPath)?.[1];
  const legacySession = entities.find(item => item.kind === 'workout_session' && item.value.id === legacySessionId);
  const selectedDate = localDateSchema.safeParse(routeDate).success ? routeDate! : legacySession?.kind === 'workout_session' ? legacySession.value.localDate : today;
  useEffect(() => { if (!chat && runtime && ledger && (frontPath === '/training' || frontPath === '/weight' || frontPath === '/nutrition' || legacySession)) { const destination = (frontPath.startsWith('/weight') ? '/weight' : frontPath.startsWith('/nutrition') ? '/nutrition' : '/training') + '?date=' + selectedDate; history.replaceState(null, '', destination); setPath(destination); setFrontPath(destination); } }, [chat, runtime, ledger, frontPath, legacySession, selectedDate]);
  useEffect(() => { const changed = () => { const value = currentPath(); void commitTrainingRows().then(flushDrafts).then(() => { setPath(value); if (!value.startsWith('/assistant')) setFrontPath(value); }).catch(() => setNotice('storageFailed')); }; window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed); }, []);
  useEffect(() => {
    if (!profile) return;
    const intent = languageIntent.current, command = intent ? commands.find(item => item.operationId === intent.operationId) : undefined;
    if (intent && command) {
      if (['conflict','needs_review','rejected','discarded'].includes(command.state)) { languageIntent.current = null; setNotice('errors:recordChanged'); }
      else if (command.state === 'committed' && (command.receipt?.dataRevision ?? Infinity) <= (ledger?.dataRevision ?? -1)) languageIntent.current = null;
    }
    const latest = commands.findLast(item => item.mutation.kind === 'profile.update' && item.mutation.input.locale && !['discarded','rejected','conflict','needs_review'].includes(item.state));
    const pendingLocale = latest?.mutation.kind === 'profile.update' && (latest.state !== 'committed' || (latest.receipt?.dataRevision ?? Infinity) > (ledger?.dataRevision ?? -1)) ? latest.mutation.input.locale : null;
    const next = languageIntent.current?.locale ?? pendingLocale ?? profile.locale;
    if (i18n.resolvedLanguage !== next) void i18n.changeLanguage(next);
  }, [commands, profile, ledger?.dataRevision, i18n]);
  useEffect(() => {
    if (!runtime || !ledger || restored.current) return; restored.current = true;
    if (path === '/') { const destination = '/today'; history.replaceState(null, '', destination); setPath(destination); setFrontPath(destination); }
    else if (path.startsWith('/assistant')) void runtime.database.readScene().then(scene => setFrontPath(scenePath(scene))).catch(() => setNotice('storageFailed'));
  }, [runtime, ledger, path]);
  async function navigate(destination: string) {
    try { await commitTrainingRows(); await flushDrafts(); history.pushState(null, '', destination); setPath(destination); if (!destination.startsWith('/assistant')) setFrontPath(destination); window.scrollTo(0, 0); if (runtime) void runtime.synchronizer.refresh(); }
    catch { setNotice('storageFailed'); }
  }
  async function openChat() {
    if (!runtime) return;
    try {
      await commitTrainingRows(); await flushDrafts(); const previous = await runtime.database.readScene(), selectedSession = /^\/training\/sessions\/([^/?]+)/.exec(frontPath)?.[1];
      const scene: ReturnScene = { ownerId, view: frontPath.startsWith('/training') ? 'session' : frontPath.startsWith('/weight') ? 'weight' : frontPath.startsWith('/nutrition') ? 'diet' : frontPath.startsWith('/settings') ? 'settings' : 'overview', localDate: new URL(frontPath, location.origin).searchParams.get('date') ?? today, sessionId: selectedSession && uuidSchema.safeParse(selectedSession).success ? selectedSession : null, currentGroupId: previous && previous.sessionId === selectedSession ? previous.currentGroupId : null, scrollY: window.scrollY, timerStartedAt: previous && previous.sessionId === selectedSession ? previous.timerStartedAt : null, draftId: frontPath.startsWith('/weight') ? 'weight-day:' + selectedDate : previous && previous.sessionId === selectedSession ? previous.draftId : null, updatedAt: new Date().toISOString() };
      await runtime.database.saveScene(scene); await navigate('/assistant');
    } catch { setNotice('storageFailed'); }
  }
  async function returnToFront() {
    if (!runtime) return;
    try { const scene = await runtime.database.readScene(); await navigate(scenePath(scene)); requestAnimationFrame(() => window.scrollTo(0, scene?.scrollY ?? 0)); }
    catch { setNotice('storageFailed'); }
  }
  async function preference(input: { locale?: Locale; bodyWeightUnit?: 'kg' | 'lb' }) {
    if (!runtime || !profile) return;
    const operationId = crypto.randomUUID();
    if (input.locale) { languageIntent.current = { locale: input.locale, operationId }; void i18n.changeLanguage(input.locale); }
    try {
      await serializeTraining(runtime.database, async () => {
        const fresh = await runtime.database.readLedger(); if (!fresh) throw Error('Storage');
        const latestProfile = visibleLedgerEntities(fresh).find(item => item.kind === 'user_profile')?.value; if (!latestProfile) throw Error('Profile');
        const queued = await runtime.database.listCommands();
        const mutation: ManualMutation = { kind: 'profile.update', target: { ...versionFor({ type: 'user_profile', id: latestProfile.id, revision: latestProfile.revision }, queued), type: 'user_profile' }, input };
        const command = commandFor(fresh, mutation, latestProfile.id, today, timezone); command.operationId = operationId;
        await runtime.database.enqueueCommand(command); void runtime.queue.flush();
      });
    } catch {
      if (languageIntent.current?.operationId === operationId) { languageIntent.current = null; void i18n.changeLanguage(profile.locale); }
      setNotice('storageFailed');
    }
  }
  const denied = state.syncStatus.state === 'auth_required' || state.queueStatus.state === 'auth_required';
  const disconnected = state.syncStatus.state === 'offline' || state.queueStatus.state === 'offline';
  const pendingCount = pendingCommands(commands).length;
  const syncText = disconnected ? 'offline' : commands.some(command => command.state === 'conflict') ? 'conflict' : state.syncStatus.errorCode || state.queueStatus.errorCode ? 'syncFailed' : pendingCount ? 'pendingCount' : state.syncStatus.state === 'current' ? 'synced' : 'syncing';
  return <div className="app-shell" data-sync-state={syncText}>
    <header className="app-header"><button className="brand quiet" onClick={() => { void navigate('/today'); }}>lowkkey<span aria-hidden="true">.</span></button>{!denied && <div className="header-actions"><button className="quiet avatar" aria-label={t('settings')} onClick={() => { void navigate('/settings'); }}>{profile?.displayName.slice(0, 1) ?? '○'}</button><button className="chat-button" aria-label={t(chat ? 'assistant:back' : 'assistant:openLabel')} onClick={() => { void (chat ? returnToFront() : openChat()); }}>{t(chat ? 'assistant:back' : 'assistant:open')}</button></div>}</header>
    {notice && <p role="alert" className="notice">{t(notice)}</p>}{state.error && <div role="alert"><p>{t('storageFailed')}</p>{!denied && <button className="quiet" onClick={() => { void state.retry(); }}>{t('retry')}</button>}</div>}
    {denied ? <section className="panel"><p>{t(state.syncStatus.errorCode === 'MEMBER_SUSPENDED' || state.queueStatus.errorCode === 'MEMBER_SUSPENDED' ? 'auth:inactive' : 'auth:signedOut')}</p><button onClick={onSignedOut}>{t('auth:signIn')}</button></section> : !runtime || !ledger || !profile ? <section className="loading-state" data-testid="initial-load"><p role={state.syncStatus.errorCode || disconnected ? 'alert' : 'status'}>{t(disconnected ? 'offlineUnavailable' : state.syncStatus.errorCode ? 'loadFailed' : 'loading')}</p>{runtime && <button className="quiet" onClick={() => { void state.retry(); }}>{t('retry')}</button>}</section> : <>
      <main id="main-content" aria-label={t('a11y:main')}><div hidden={chat} className="workspace-face" key="front">
        {frontPath !== '/today' && frontPath !== '/' && <button className="quiet back-link" onClick={() => { void navigate('/today'); }}>← {t('today')}</button>}
        {frontPath.startsWith('/weight') ? <WeightView key={selectedDate} runtime={runtime} ledger={ledger} profile={profile} commands={commands} date={selectedDate} navigate={navigate}/> : frontPath.startsWith('/settings') ? <SettingsView runtime={runtime} ledger={ledger} profile={profile} commands={commands} preference={preference} onSignedOut={onSignedOut}/> : frontPath.startsWith('/training') ? <TrainingView key={selectedDate} runtime={runtime} ledger={ledger} profile={profile} commands={commands} date={selectedDate} navigate={navigate}/> : frontPath.startsWith('/nutrition') ? <DietView key={selectedDate} runtime={runtime} ledger={ledger} profile={profile} commands={commands} date={selectedDate} navigate={navigate}/> : <Overview ledger={ledger} profile={profile} commands={commands} navigate={destination => { void navigate(destination); }}/>}
      </div>{chat && <ConversationDraft runtime={runtime} timezone={timezone} back={() => { void returnToFront(); }}/>}</main>
      <footer className="app-footer"><LanguagePicker value={locale} onChange={value => { void preference({ locale: value }); }}/></footer>
    </>}
  </div>;
}
function Overview({ ledger, profile, commands, navigate }: { ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[]; navigate: (destination: string) => void }) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage), timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const latest = weightProjection(ledger, commands).find(item => item.isPrimary && item.localDate === today);
  const model = trainingProjection(ledger, commands), roots = new Set(model.sessions.filter(item => item.localDate === today && !['cancelled','deleted'].includes(item.status)).map(item => item.id)), groups = model.exercises.filter(item => roots.has(item.sessionId)), recorded = model.sets.filter(item => groups.some(group => group.id === item.sessionExerciseId)), actions = new Set(recorded.map(item => item.sessionExerciseId)).size;
  const diet = dietProjection(ledger, commands, today), nutrients = diet.summary;
  const dietPending = commands.some(command => command.localDate === today && isDietCommand(command, commands) && pendingCommand(command, ledger));
  const link = (destination: string) => ({ href: destination, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(destination); } } });
  return <><div className="page-heading overview-heading"><p className="eyebrow"><time dateTime={today}>{formatDate(new Date(), locale, timezone)}</time></p><h1>{t('today:title')}</h1></div><div className="artifact-grid">
    <a {...link('/training?date=' + today)} className="artifact-card training-artifact" data-artifact="SessionArtifact">
      <h2>{t('today:training')}</h2><p className="card-main">{recorded.length ? t('daily:trainingSummary', { actions, sets: recorded.length }) : t('daily:recordTraining')}</p><span className="card-action" aria-hidden="true">↗</span>
    </a>
    <a {...link('/weight')} className="artifact-card" data-artifact="WeightArtifact"><h2>{t('today:weight')}</h2><p className="metric">{latest ? displayMass(latest.kgMicros, profile.bodyWeightUnit, locale) : '—'} <span className="unit">{latest ? profile.bodyWeightUnit : ''}</span></p><p className="muted">{latest ? <time dateTime={latest.localDate}>{formatDate(new Date(latest.localDate + 'T12:00:00Z'), locale, 'UTC')}</time> : t('noRecords')}</p><span className="card-action">{t('today:weigh')}</span></a>
    <a {...link('/nutrition?date=' + today)} className="artifact-card" data-artifact="DietArtifact"><h2>{t('today:nutrition')}</h2><p className="card-main"><NumericText>{diet.records.length ? t('nutrition:count', { count: diet.records.length }) : t('today:recordMeal')}</NumericText></p>
      {nutrients.knownSum.energyMkcal !== null && <p className="muted">{t('nutrition:known')} <span className="numeric">{formatNumber(nutrients.knownSum.energyMkcal / 1000, locale)}</span> kcal</p>}
      {dietPending && <span className="muted">{t('daily:local')}</span>}
      {diet.drafts.length > 0 && <span className="muted"><NumericText>{t('today:pendingMeals', { count: diet.drafts.length })}</NumericText></span>}
      <span className="card-action" aria-hidden="true">↗</span></a>
  </div></>;
}

function ConversationDraft({ runtime, timezone, back }: { runtime: WorkspaceRuntime; timezone: string; back: () => void }) {
  const { t } = useTranslation(), draft = useDraft(runtime.database, 'conversation-unsubmitted', 'conversation', { text: '' }, timezone);
  return <section className="workspace-face conversation"><button className="quiet back-link" onClick={back}>← {t('assistant:back')}</button><h1>{t('assistant:title')}</h1><p>{t('assistant:unavailable')}</p><label htmlFor="conversation-draft">{t('assistant:draft')}</label><textarea id="conversation-draft" disabled={!draft.ready} maxLength={8000} value={draft.fields.text} onChange={event => draft.change('text', event.target.value)} onBlur={() => { void draft.flush().catch(() => {}); }}/><p className="muted">{t('assistant:offline')}</p><p role="status">{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p></section>;
}
