export type Screen = 'Plan' | 'Gallery' | 'Weight';
export const screens: Screen[] = ['Plan', 'Gallery', 'Weight'];
export function targetFromHash(): string | null {
  const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const screen = screenFromHash();
  const value = query.get(screen === 'Plan' ? 'day' : 'date');
  return value ? screen + '-' + value : null;
}
export function screenFromHash(): Screen {
  const hash = location.hash.slice(1).split('?')[0];
  if (hash === 'Body') return 'Weight';
  if (hash === 'Progress' || hash === 'Ledger') return 'Gallery';
  return screens.includes(hash as Screen) ? hash as Screen : 'Plan';
}
