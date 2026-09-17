import type { Page, Request } from '@playwright/test';
import { test, expect, openWorkspace, localLogin } from './fixtures.ts';
import { workspaceLocale } from '../../src/i18n/workspace-resources.ts';
import { addDays } from '../../src/domain/primitives.ts';

function words(locale: string) { return workspaceLocale(locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2); }
function dateFor(year: number, locale: string) { return `${year}-01-${locale === 'en' ? '03' : locale === 'zh-Hant' ? '02' : '01'}`; }
async function showHistory(page: Page) {
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  while (await page.getByTestId('weight-load-more').isVisible()) await page.getByTestId('weight-load-more').click();
}
async function saveWeight(page: Page, value: string, date: string, unit = 'kg', replace = false) {
  await page.locator('#weight-date').fill(date); await page.locator('.joined-input select').selectOption(unit); await page.locator('#weight-value').fill(value);
  if (replace && await page.locator('#weight-primary').isVisible()) await page.locator('#weight-primary').selectOption('replace');
  const confirmation = page.locator('.check-label input'); if (await confirmation.isVisible()) await confirmation.check();
  const response = page.waitForResponse(response => response.url().endsWith('/api/v1/weights') && response.request().method() === 'POST');
  await page.locator('form button[type=submit]').click(); const write = await response; expect(write.status()).toBe(201);
  const receipt: { operationId: string; result: { id: string } } = (await write.json()).data;
  await showHistory(page);
  await expect(page.locator(`[data-weight-id="${receipt.result.id}"]`)).toBeVisible();
  await expect(page.getByTestId('weight-feedback')).toHaveAttribute('data-result-state', 'committed');
  return receipt;
}
async function readWeight(page: Page, id: string) { return page.evaluate(async id => (await (await fetch(`/api/v1/weights/${id}`)).json()).data, id); }

test('home to 110 lb, unit changes and reload keep the original measurement', async ({ page }, info) => {
  const text = words(info.project.name); await openWorkspace(page, info.project.name);
  await page.locator('[data-artifact=WeightArtifact]').click(); await expect(page).toHaveURL(/\/weight$/);
  const receipt = await saveWeight(page, '110', dateFor(1990, info.project.name), 'lb'), id = receipt.result.id;
  await expect(page.getByTestId('weight-feedback')).toContainText(text.weight.created);
  await expect(page.locator(`[data-weight-id="${id}"] .record-value`)).toContainText('49.9');
  expect(await readWeight(page, id)).toMatchObject({ value: '110', unit: 'lb', kgMicros: 49895161, occurredAt: null, timePrecision: 'date', revision: 1 });
  await page.locator('.avatar').click(); await page.locator('#weight-display-unit').selectOption('lb');
  await expect(page.locator('#weight-display-unit')).toHaveValue('lb'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.locator('.brand').click(); await page.locator('[data-artifact=WeightArtifact]').click();
  await showHistory(page);
  await expect(page.locator(`[data-weight-id="${id}"] .record-value`)).toContainText('110');
  await page.reload(); await showHistory(page); await expect(page.locator(`[data-weight-id="${id}"]`)).toBeVisible();
  expect(await readWeight(page, id)).toMatchObject({ value: '110', unit: 'lb', kgMicros: 49895161, revision: 1 });
  await page.locator('.avatar').click(); await page.locator('#weight-display-unit').selectOption('kg');
  await expect(page.locator('#weight-display-unit')).toHaveValue('kg'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
});

test('quick undo expires after ten seconds, can undo a new record, and cannot overwrite a later edit', async ({ page }, info) => {
  const text = words(info.project.name); await openWorkspace(page, info.project.name, '/weight');
  await page.clock.install();
  await saveWeight(page, '70', dateFor(1991, info.project.name));
  await expect(page.getByTestId('quick-undo')).toBeVisible();
  await page.clock.fastForward(8000); await expect(page.getByTestId('quick-undo')).toBeVisible();
  await page.clock.fastForward(2100); await expect(page.getByTestId('quick-undo')).toHaveCount(0);
  const added = await saveWeight(page, '70.1', dateFor(1991, info.project.name));
  await page.getByTestId('quick-undo').click();
  await expect(page.locator(`[data-weight-id="${added.result.id}"]`)).toHaveCount(0);
  await expect(page.getByTestId('weight-feedback')).toContainText(text.weight.undone);
  const later = await saveWeight(page, '70.2', dateFor(1991, info.project.name));
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/weights/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"1"' }, body: JSON.stringify({ value: '70.3' }) });
    if (!response.ok) throw new Error('Concurrent edit failed');
  }, later.result.id);
  await page.getByTestId('quick-undo').click();
  await expect(page.locator('[data-command-state=conflict]')).toContainText(text.weight.undoBlocked);
  expect(await readWeight(page, later.result.id)).toMatchObject({ value: '70.3', revision: 2 });
});

test('same-day choices, anomaly confirmation, editing and deleting the primary have real receipts', async ({ page }, info) => {
  const text = words(info.project.name), date = dateFor(1992, info.project.name); await openWorkspace(page, info.project.name, '/weight');
  const primary = await saveWeight(page, '70', date), extra = await saveWeight(page, '70.2', date);
  expect(await readWeight(page, primary.result.id)).toMatchObject({ isPrimary: true }); expect(await readWeight(page, extra.result.id)).toMatchObject({ isPrimary: false });
  await page.locator('#weight-date').fill(date); await page.locator('#weight-value').fill('80');
  let unconfirmedWrites = 0;
  const watch = (request: Request) => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/weights')) unconfirmedWrites++; };
  page.on('request', watch);
  await page.locator('form button[type=submit]').click(); await expect(page.locator('form [role=alert]')).toBeVisible(); expect(unconfirmedWrites).toBe(0); page.off('request', watch);
  await page.locator('.check-label input').check(); await page.locator('#weight-primary').selectOption('replace');
  const response = page.waitForResponse(response => response.url().endsWith('/api/v1/weights') && response.request().method() === 'POST');
  await page.locator('form button[type=submit]').click(); const confirmed = await response; expect(confirmed.status()).toBe(201);
  const id = (await confirmed.json()).data.result.id as string, row = page.locator(`[data-weight-id="${id}"]`);
  await expect(row).toBeVisible(); expect(await readWeight(page, primary.result.id)).toMatchObject({ isPrimary: false });
  await row.getByRole('button', { name: text.common.edit, exact: true }).click(); await expect(page.locator('#weight-value')).toBeFocused();
  await page.locator('#weight-value').fill('79.8');
  if (await page.locator('.check-label input').isVisible()) await page.locator('.check-label input').check();
  await page.locator('form button[type=submit]').click();
  await expect(row.locator('.record-value')).toContainText('79.8'); await expect(page.getByTestId('weight-feedback')).toContainText(text.weight.updated);
  const remove = row.getByRole('button', { name: text.common.remove, exact: true }); await remove.click();
  await expect(page.getByRole('dialog')).toContainText(text.weight.deletePrimaryEffect);
  await expect(page.getByRole('dialog').getByRole('button', { name: text.common.cancel, exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(remove).toBeFocused();
  await remove.click(); await page.getByRole('dialog').getByRole('button', { name: text.common.remove, exact: true }).click();
  await expect(row).toHaveCount(0); await expect(page.getByTestId('weight-feedback')).toContainText(text.weight.deleted);
  await expect(page.getByTestId('replacement-primary')).toContainText('70 kg');
  expect(await readWeight(page, primary.result.id)).toMatchObject({ isPrimary: true }); expect(await readWeight(page, extra.result.id)).toMatchObject({ isPrimary: false });
  // A delete confirmation binds what was shown, even if another device changes
  // the measurement while the modal is open. Review creates a new operation.
  const extraRow = page.locator(`[data-weight-id="${extra.result.id}"]`);
  await extraRow.getByRole('button', { name: text.common.remove, exact: true }).click();
  await page.evaluate(async id => {
    const record = (await (await fetch(`/api/v1/weights/${id}`)).json()).data;
    const response = await fetch(`/api/v1/weights/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${record.revision}"` }, body: JSON.stringify({ value: '70.3' }) });
    if (!response.ok) throw new Error('Concurrent edit before delete failed');
  }, extra.result.id);
  await page.getByRole('dialog').getByRole('button', { name: text.common.remove, exact: true }).click();
  const conflict = page.locator('[data-command-state=conflict]'); await expect(conflict).toContainText('70.3');
  await conflict.getByRole('button', { name: text.common.review, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('70.3');
  await page.getByRole('dialog').getByRole('button', { name: text.common.remove, exact: true }).click();
  await expect(extraRow).toHaveCount(0); await expect(conflict).toHaveCount(0);
});

test('a failed write stays local and retry uses the same operation before showing synced', async ({ page }, info) => {
  await openWorkspace(page, info.project.name, '/weight'); let failing = true; const keys: string[] = [];
  await page.route('**/api/v1/weights', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (failing) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY_FAILURE' } }) });
    return route.continue();
  });
  await page.locator('#weight-date').fill(dateFor(1993, info.project.name)); await page.locator('#weight-value').fill('70');
  if (await page.locator('.check-label input').isVisible()) await page.locator('.check-label input').check();
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('[data-command-state=uncertain]')).toContainText('70'); await expect(page.getByTestId('weight-feedback')).toHaveAttribute('data-result-state', 'uncertain');
  await expect(page.getByTestId('quick-undo')).toHaveCount(0);
  failing = false; await page.locator('[data-command-state=uncertain] button').click();
  await expect(page.getByTestId('weight-feedback')).toHaveAttribute('data-result-state', 'committed');
  expect(keys.length).toBeGreaterThanOrEqual(2); expect(new Set(keys).size).toBe(1);
  const receipt = await page.evaluate(async id => (await (await fetch(`/api/v1/operations/${id}`)).json()).data, keys[0]);
  expect(await readWeight(page, receipt.result.id)).toMatchObject({ value: '70', revision: 1 });
});

test('initial snapshot failure exposes a working retry without losing the session', async ({ page }, info) => {
  const text = words(info.project.name); await localLogin(page); let failing = true;
  await page.route('**/api/v1/sync/snapshot?*', route => failing ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY_FAILURE' } }) }) : route.continue());
  await page.goto('/weight');
  const initial = page.getByTestId('initial-load'); await expect(initial.locator('[role=alert]')).toBeVisible();
  // The server preference may be from a preceding test until its first snapshot.
  expect(await initial.innerText()).not.toBe(''); failing = false; await initial.getByRole('button').click();
  await expect(page.locator('#weight-value')).toBeVisible(); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.getByTestId('language').selectOption(info.project.name); await expect(page.locator('html')).toHaveAttribute('lang', info.project.name);
  await expect(page.locator('.weight-view h1')).toHaveText(text.weight.title);
});

test('seven-day trend, narrow layouts and conversation reload preserve the editing scene', async ({ page }, info) => {
  const account = await openWorkspace(page, info.project.name, '/weight');
  for (const [offset, value] of [[-2, '70'], [-1, '70.4'], [0, '70.2']] as const) await saveWeight(page, value, addDays(account.localDate, offset), 'kg', true);
  await expect(page.locator('.detail-grid section').last().locator('.metric')).toContainText('70.2');
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of ['#weight-value', '.joined-input select', 'form button[type=submit]']) {
      const bounds = await page.locator(selector).boundingBox(); expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `.artifacts/playwright/${info.project.name}-${width}-weight-delivery.png`, fullPage: true });
    await page.locator('.detail-grid').screenshot({ path: `.artifacts/playwright/${info.project.name}-${width}-weight-form.png` });
  }
  const input = page.locator('#weight-value'); await input.fill('７０．'); await page.locator('#weight-date').fill('1994-01-01');
  await page.evaluate(() => window.scrollTo(0, 500));
  const scroll = await page.evaluate(() => window.scrollY);
  // Reload on the conversation face deliberately, then use its explicit return.
  await page.locator('.chat-button').click(); await expect(page).toHaveURL(/\/assistant$/);
  await page.locator('#conversation-draft').fill('Keep my note'); await page.locator('#conversation-draft').blur();
  await expect(page.locator('.conversation [role=status]')).not.toBeEmpty(); await page.reload();
  await expect(page.locator('#conversation-draft')).toHaveValue('Keep my note');
  await page.locator('.conversation .back-link').click(); await expect(input).toBeVisible(); await expect(input).toHaveValue('７０．'); await expect(page.locator('#weight-date')).toHaveValue('1994-01-01');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(input).not.toBeFocused();
  await page.locator('.record-list button').first().click(); await expect(input).toBeFocused();
  const inputBox = await input.boundingBox(), headerBox = await page.locator('.app-header').boundingBox();
  expect(inputBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
});
