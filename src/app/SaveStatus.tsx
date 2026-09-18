import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand } from '../domain/manual-commands.ts';

/** Success means both the receipt and its ledger batch are locally applied. */
export function SaveStatus({ command, dataRevision }: { command?: QueuedCommand; dataRevision: number }) {
  const { t } = useTranslation(), [visible, setVisible] = useState(false), [online, setOnline] = useState(navigator.onLine);
  const done = command?.state === 'committed' && (command.receipt?.dataRevision ?? Infinity) <= dataRevision;
  useEffect(() => {
    const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => { setVisible(!!command); if (done) { const timer = setTimeout(() => setVisible(false), 2200); return () => clearTimeout(timer); } }, [command?.operationId, done]);
  if (!command || !visible || command.state === 'discarded') return null;
  const key = done ? 'synced' : ['conflict','needs_review','rejected'].includes(command.state) ? 'conflict' : !online ? 'daily:local' : command.state === 'uncertain' ? 'daily:retrying' : 'syncing';
  return <span className="save-status" role="status" data-save-state={done ? 'synced' : command.state}>{t(key)}</span>;
}
