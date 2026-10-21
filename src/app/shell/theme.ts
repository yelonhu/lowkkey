export const themeNames = { ink: '水墨', gold: '鎏金', pearl: '珍珠' } as const;

export function applyPageTheme() {
  document.documentElement.style.colorScheme = 'light dark';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
}
