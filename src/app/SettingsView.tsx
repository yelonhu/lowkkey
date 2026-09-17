import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { Locale } from '../domain/primitives.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../domain/profile.ts';
import type { QueuedCommand } from '../domain/manual-commands.ts';
import { commandReceiptSchema } from '../domain/command-receipt.ts';
import type { WorkspaceRuntime } from './workspace-state.ts';
import { flushDrafts } from './use-draft.ts';

const pending = (commands: QueuedCommand[]) => commands.filter(command => !['committed', 'discarded'].includes(command.state));
export function SettingsView({ runtime, ledger, profile, commands, preference, onSignedOut }: { runtime: WorkspaceRuntime; ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[]; preference: (input: { locale?: Locale; bodyWeightUnit?: 'kg' | 'lb' }) => Promise<void>; onSignedOut: () => void }) {
  const { t } = useTranslation(), [exit, setExit] = useState(false), [downloaded, setDownloaded] = useState(false), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), logoutKey = useRef(crypto.randomUUID()), logoutDisposition = useRef<'synced' | 'exported' | 'discarded' | null>(null);
  async function exportLocal() {
    try {
      await flushDrafts(); const payload = { schemaVersion: 1, ownerId: ledger.ownerId, exportedAt: new Date().toISOString(), commands: pending(await runtime.database.listCommands()), drafts: await runtime.database.listDrafts() };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `lowkkey-local-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); setDownloaded(true);
    } catch { setError('storageFailed'); }
  }
  async function logout(disposition: 'synced' | 'exported' | 'discarded') {
    setBusy(true); setError(null);
    try {
      await flushDrafts(); runtime.queue.stop(); runtime.synchronizer.stop();
      logoutDisposition.current ??= disposition;
      const response = await fetch('/api/v1/session/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': logoutKey.current, 'X-Account-Id': ledger.ownerId }, body: JSON.stringify({ localDataDisposition: logoutDisposition.current }) });
      if (!response.ok) throw new Error('Logout failed');
      const receipt = z.object({ data: commandReceiptSchema }).parse(await response.json()).data, logoutUrl = z.string().parse(receipt.result.logoutUrl);
      if (new URL(logoutUrl, location.origin).origin !== location.origin || !logoutUrl.startsWith('/cdn-cgi/access/logout')) throw new Error('Invalid logout path');
      await runtime.database.clearOwnerData(); localStorage.removeItem('lowkkey.last-owner'); onSignedOut(); location.assign(logoutUrl);
    } catch { setError('errors:temporaryFailure'); setBusy(false); }
  }
  async function requestLogout() {
    try { await flushDrafts(); const drafts = await runtime.database.listDrafts(), commands = await runtime.database.listCommands(); if (pending(commands).length || drafts.length) setExit(true); else await logout('synced'); }
    catch { setError('storageFailed'); }
  }
  return <><div className="page-heading"><h1>{t('settings:title')}</h1></div><section className="panel settings-panel"><h2>{t('settings:profile')}</h2><p>{profile.displayName}</p><p>{profile.timezone}</p><label htmlFor="weight-display-unit">{t('settings:units')}</label><select id="weight-display-unit" value={profile.bodyWeightUnit} onChange={event => { void preference({ bodyWeightUnit: event.target.value as 'kg' | 'lb' }); }}><option value="kg">kg</option><option value="lb">lb</option></select><p className="muted">{t('settings:pending')}</p>{pending(commands).some(command => command.mutation.kind === 'profile.update') && <p role="status">{t('savedLocally')}</p>}</section><section className="panel"><h2>{t('settings:exportTitle')}</h2><button className="quiet" onClick={() => { void exportLocal(); }}>{t('auth:exportLocal')}</button>{downloaded && <p role="status">{t('auth:localExported')}</p>}</section><section className="panel"><h2>{t('settings:logoutTitle')}</h2><button className="quiet" disabled={busy} onClick={() => { void requestLogout(); }}>{t('auth:signOut')}</button>{exit && <div className="notice warning"><p>{t('auth:pendingExit')}</p><p>{t('auth:exitExplanation')}</p><div className="actions"><button className="quiet" onClick={() => { setExit(false); runtime.synchronizer.start(); runtime.queue.start(); void runtime.queue.retry(); }}>{t('auth:syncFirst')}</button><button className="quiet" onClick={() => { void exportLocal(); }}>{t('auth:exportLocal')}</button>{downloaded && <button disabled={busy} onClick={() => { void logout('exported'); }}>{t('auth:exportThenExit')}</button>}<button className="quiet danger" disabled={busy} onClick={() => { void logout('discarded'); }}>{t('auth:discardThenExit')}</button></div></div>}{error && <p role="alert">{t(error)}</p>}</section></>;
}
