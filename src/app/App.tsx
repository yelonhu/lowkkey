import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { activationSchema } from '../domain/profile.ts';
import { localeSchema, uuidSchema } from '../domain/primitives.ts';
import { LanguagePicker, Workspace } from './Workspace.tsx';

declare const __LOCAL_DEVELOPMENT__: boolean;
const sessionSchema = z.object({ data: z.object({ status: z.enum(['active', 'invited']), userId: uuidSchema }) });
export function App() {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage);
  const [session, setSession] = useState<{ status: 'active' | 'invited'; userId: string } | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [name, setName] = useState(''), [goal, setGoal] = useState(''), [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone), activationKey = useRef(crypto.randomUUID());
  useEffect(() => { document.documentElement.lang = locale; document.title = 'lowkkey'; }, [locale]);
  async function load() {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/v1/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      if (!response.ok) { setSession(null); if (response.status !== 401) setError(response.status === 403 ? 'auth:inactive' : 'errors:temporaryFailure'); return; }
      const value = sessionSchema.parse(await response.json()).data; setSession(value);
      if (value.status === 'active') localStorage.setItem('lowkkey.last-owner', value.userId);
    } catch {
      let savedOwner: string | null = null;
      try { savedOwner = localStorage.getItem('lowkkey.last-owner'); } catch { /* Storage may be disabled; show the normal recoverable error. */ }
      const owner = uuidSchema.safeParse(savedOwner);
      if (!navigator.onLine && owner.success) setSession({ status: 'active', userId: owner.data }); else setError('errors:temporaryFailure');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function login() {
    setBusy(true); setError(null);
    try {
      if (__LOCAL_DEVELOPMENT__) { const response = await fetch('/api/local/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('Login failed'); await load(); }
      else location.assign('/cdn-cgi/access/login');
    } catch { setError('errors:temporaryFailure'); } finally { setBusy(false); }
  }
  async function activate() {
    setBusy(true); setError(null);
    try {
      const input = activationSchema.parse({ displayName: name, goalType: goal, locale, timezone });
      const response = await fetch('/api/v1/session/activate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': activationKey.current }, body: JSON.stringify(input) });
      if (!response.ok) { if (response.status < 500) activationKey.current = crypto.randomUUID(); throw new Error('Activation failed'); } await load();
    } catch (error) { setError(error instanceof z.ZodError ? 'errors:invalidRequest' : 'errors:temporaryFailure'); } finally { setBusy(false); }
  }
  if (session?.status === 'active') return <Workspace key={session.userId} ownerId={session.userId} onSignedOut={() => { setSession(null); }}/>;
  return <div className="app-shell"><header className="app-header"><a className="brand" href="/">lowkkey<span aria-hidden="true">.</span></a><LanguagePicker value={locale} onChange={value => { void i18n.changeLanguage(value); }}/></header><main aria-label={t('a11y:main')} className="login-screen"><p className="eyebrow">lowkkey</p><h1>{t(session?.status === 'invited' ? 'auth:activate' : 'auth:title')}</h1><p>{t(session?.status === 'invited' ? 'auth:invitation' : 'auth:intro')}</p>{loading ? <p role="status">{t('loading')}</p> : session?.status === 'invited' ? <form onSubmit={event => { event.preventDefault(); void activate(); }}><fieldset disabled={busy}><label htmlFor="display-name">{t('auth:name')}</label><input id="display-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} autoComplete="nickname"/><label htmlFor="goal-type">{t('auth:goal')}</label><select id="goal-type" value={goal} onChange={event => setGoal(event.target.value)} required><option value="">{t('auth:chooseGoal')}</option>{['lean_bulk', 'fat_loss', 'maintenance'].map(value => <option key={value} value={value}>{t(`auth:${value}`)}</option>)}</select><label htmlFor="entry-timezone">{t('auth:timezone')}</label><input id="entry-timezone" value={timezone} onChange={event => setTimezone(event.target.value)} aria-describedby="timezone-help" required/><p id="timezone-help" className="muted">{t('auth:timezoneHelp')}</p><p className="muted">{t('auth:memoryNotice')}</p><button type="submit">{t('auth:begin')}</button></fieldset></form> : <><button disabled={busy} onClick={() => { void login(); }}>{t(__LOCAL_DEVELOPMENT__ ? 'auth:localSignIn' : 'auth:signIn')}</button>{__LOCAL_DEVELOPMENT__ && <p className="muted">{t('auth:localOnly')}</p>}</>}{error && <p role="alert" className="error">{t(error)}</p>}</main></div>;
}
