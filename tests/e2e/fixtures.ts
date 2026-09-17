import { test as base, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const test = base.extend<{ context: BrowserContext }>({ context: async ({ baseURL }, use, info) => {
  const directory = path.resolve('.local/test-browser', `${info.project.name}-${info.workerIndex}-${crypto.randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const context = await chromium.launchPersistentContext(directory, { headless: true, locale: info.project.use.locale, baseURL, viewport: { width: 1024, height: 1000 }, args: ['--disable-breakpad', '--disable-crash-reporter', '--no-first-run', '--no-default-browser-check', '--disable-component-update', '--disable-background-networking', '--password-store=basic', '--use-mock-keychain'] });
  const outbound: string[] = [];
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname !== '127.0.0.1') { outbound.push(url.hostname); return route.abort(); } return route.continue(); });
  await use(context);
  await context.close();
  expect(outbound).toEqual([]);
} });
export { expect } from '@playwright/test';
export async function localLogin(page: Page) {
  // Storage tests own their coordinators; the application must not start a
  // second queue behind those tests. UI tests navigate into the app afterward.
  await page.goto('/tests/support/storage-harness.html');
  return page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
    const login = await fetch('/api/local/session', { method: 'POST', headers, body: '{}' });
    if (!login.ok) throw new Error('Fixture login failed');
    const session = await (await fetch('/api/v1/session')).json();
    if (session.data.status === 'invited') {
      const response = await fetch('/api/v1/session/activate', { method: 'POST', headers, body: JSON.stringify({ displayName: 'Browser fixture', goalType: 'maintenance', timezone: 'America/Chicago', locale: 'en' }) });
      if (!response.ok) throw new Error('Fixture activation failed');
    }
    const response = await fetch('/api/v1/me');
    if (!response.ok) throw new Error('Fixture profile missing');
    const me = await response.json();
    return { ownerId: String(me.data.profile.ownerId), localDate: String(me.data.localDate), timezone: String(me.data.effectiveTimezone) };
  });
}
export async function openWorkspace(page: Page, locale: string, destination = '/today') {
  const account = await localLogin(page);
  await page.evaluate(async locale => {
    const me = (await (await fetch('/api/v1/me')).json()).data;
    if (me.profile.locale !== locale) {
      const response = await fetch('/api/v1/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${me.profile.revision}"` }, body: JSON.stringify({ locale }) });
      if (!response.ok) throw new Error('Fixture preference failed');
    }
  }, locale);
  await page.goto(destination);
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  return account;
}
