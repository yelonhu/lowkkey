export function applyPageTheme() {
  document.documentElement.style.colorScheme='light dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
}
