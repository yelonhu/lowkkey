import { useCallback, useEffect, useRef, useState } from 'react';
import { StateResponse } from '@lowkkey/protocol';

export function useShowroom() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [auth, setAuth] = useState<'loading' | 'required' | 'ready'>('loading');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [syncedAt, setSyncedAt] = useState<Date | null>(null), [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const clear = useCallback(() => { generation.current++; setState(null); setAuth('required'); setError(''); setSyncedAt(null); setRefreshing(false); }, []);
  const refresh = useCallback(async () => {
    const epoch = ++generation.current;
    setRefreshing(true);
    try {
      const response = await fetch('/v1/state', { credentials: 'same-origin', cache: 'no-store' });
      if (epoch !== generation.current) return;
      if (response.status === 401) { clear(); return; }
      if (!response.ok) throw new Error('暂时无法读取记录。');
      const value = StateResponse.parse(await response.json());
      if (epoch !== generation.current) return;
      setState(value); setAuth('ready'); setError(''); setSyncedAt(new Date());
    } catch {
      if (epoch === generation.current) setError('暂时无法连接。已显示的记录保留在这里，重试即可。');
    } finally { if (epoch === generation.current) setRefreshing(false); }
  }, [clear]);
  useEffect(() => {
    void refresh();
    const resume = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const storage = (event: StorageEvent) => { if (event.key === 'lowkkey-signout') clear(); };
    window.addEventListener('focus', resume); window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume); window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', resume);
    return () => {
      generation.current++;
      window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume); window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh, clear]);
  async function login() {
    if (!import.meta.env.DEV) { location.assign('/cdn-cgi/access/login'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/local/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error();
      await refresh();
    } catch { setError('暂时无法登录，请重试。'); } finally { setBusy(false); }
  }
  async function logout() {
    const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('退出未完成');
    const result = await response.json();
    clear(); localStorage.setItem('lowkkey-signout', String(Date.now()));
    if (result.redirect) location.assign(result.redirect);
  }
  return { state, auth, busy, error, login, logout, refresh, syncedAt, refreshing };
}
