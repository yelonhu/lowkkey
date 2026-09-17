import { test, expect, openWorkspace } from './fixtures.ts';
import type * as Storage from '../../src/client/local-database.ts';

test('offline manual weight persists, then a concurrent edit is explicitly resolved', async ({ page, context }, info) => {
  const account = await openWorkspace(page, info.project.name, '/weight');
  const date = `2003-01-${info.project.name === 'en' ? '03' : info.project.name === 'zh-Hant' ? '02' : '01'}`;
  await page.locator('#weight-value').fill('７０．'); await page.locator('#weight-date').fill(date);
  await page.locator('.chat-button').click(); await page.locator('.conversation .back-link').click();
  // Returning flushes drafts asynchronously. A hidden input can still satisfy
  // toHaveValue, so observe the completed navigation before refreshing.
  await expect(page).toHaveURL(/\/weight$/); await expect(page.locator('#weight-value')).toBeVisible();
  await page.reload(); await expect(page.locator('#weight-value')).toBeVisible(); await expect(page.locator('#weight-value')).toHaveValue('７０．');
  await expect(page.locator('#weight-date')).toHaveValue(date);
  await context.setOffline(true); await expect(page.locator('[data-sync-state=offline]')).toBeVisible();
  await page.locator('#weight-value').fill('70.4'); await page.locator('form button[type=submit]').click();
  await expect(page.locator('[data-command-state=queued]')).toContainText('70.4');
  const command = await page.evaluate(async ({ account, date }) => {
    const path = '/src/client/local-database.ts', { LocalDatabase } = await import(path) as typeof Storage;
    const db = await LocalDatabase.open(account.ownerId), commands = await db.listCommands(), draft = await db.readDraft('weight-form'); db.close();
    const command = commands.find(command => command.mutation.kind === 'weight.create' && command.localDate === date);
    if (!command || draft) throw new Error('Submit did not atomically consume the draft');
    return { id: command.clientEntityId, operationId: command.operationId };
  }, { account, date });
  await expect(page.locator(`[data-weight-id="${command.id}"]`)).toHaveCount(0);
  await context.setOffline(false);
  const row = page.locator(`[data-weight-id="${command.id}"]`);
  await expect(row).toBeVisible(); await expect(page.locator('[data-command-state=queued]')).toHaveCount(0);
  await row.locator('button').first().click(); await page.locator('#weight-value').fill('70.8');
  await page.evaluate(async id => {
    const record = (await (await fetch(`/api/v1/weights/${id}`)).json()).data;
    const response = await fetch(`/api/v1/weights/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${record.revision}"` }, body: JSON.stringify({ value: '70.6' }) });
    if (!response.ok) throw new Error('Concurrent fixture edit failed');
  }, command.id);
  await page.locator('.app-footer button').click(); await expect(row.locator('.record-value')).toContainText('70.6');
  await expect(page.locator('#weight-value')).toHaveValue('70.8');
  await page.locator('form button[type=submit]').click();
  const conflict = page.locator('[data-command-state=conflict]'); await expect(conflict).toContainText('70.8'); await expect(conflict).toContainText('70.6');
  await conflict.locator('button').first().click();
  await expect(page.locator('#weight-value')).toHaveValue('70.8');
  await page.locator('form button[type=submit]').click(); await expect(row.locator('.record-value')).toContainText('70.8'); await expect(conflict).toHaveCount(0);
  const stored = await page.evaluate(async id => (await (await fetch(`/api/v1/weights/${id}`)).json()).data, command.id);
  expect(stored).toMatchObject({ value: '70.8', revision: 3 });
});

test('replacing a primary requires confirmation of the actual displayed revision', async ({ page }, info) => {
  await openWorkspace(page, info.project.name, '/weight');
  const date = `2004-01-${info.project.name === 'en' ? '03' : info.project.name === 'zh-Hant' ? '02' : '01'}`;
  await page.locator('#weight-date').fill(date); await page.locator('#weight-value').fill('70');
  const response = page.waitForResponse(response => response.url().endsWith('/api/v1/weights') && response.request().method() === 'POST');
  await page.locator('form button[type=submit]').click(); const id = (await (await response).json()).data.result.id;
  await expect(page.locator(`[data-weight-id="${id}"]`)).toBeVisible();
  await page.locator('#weight-date').fill(date); await page.locator('#weight-value').fill('70.2'); await page.locator('#weight-primary').selectOption('replace');
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/weights/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"1"' }, body: JSON.stringify({ value: '70.1' }) });
    if (!response.ok) throw new Error('Concurrent primary edit failed');
  }, id);
  await page.locator('.app-footer button').click(); await expect(page.locator('#weight-primary')).toHaveValue('');
  let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/v1/weights') && request.method() === 'POST') writes++; });
  await page.locator('form button[type=submit]').click(); await expect(page.locator('#weight-value')).toHaveValue('70.2'); expect(writes).toBe(0);
  await page.locator('#weight-primary').selectOption('replace');
  const replacement = page.waitForResponse(response => response.url().endsWith('/api/v1/weights') && response.request().method() === 'POST');
  await page.locator('form button[type=submit]').click(); const result = await replacement; expect(result.status()).toBe(201);
  expect(result.request().postDataJSON().expectedPrimary).toEqual({ id, revision: 2 });
});
