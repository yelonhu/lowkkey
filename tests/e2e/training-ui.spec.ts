import { test, expect, openWorkspace } from './fixtures.ts';
import type { Page, Locator } from '@playwright/test';
import { trainingLocale } from '../../src/i18n/training-resources.ts';
type Copy = Record<string, string>;
const labels = (locale: string) => trainingLocale(locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2);
const benchId = 'bdeba6ce-c5ba-4a1b-9910-000000000004';
async function ready(page: Page, locale: string) {
  const account = await openWorkspace(page, locale, '/training');
  await page.evaluate(async () => {
    const list = (await (await fetch('/api/v1/training/sessions?status=in_progress')).json()).data;
    for (const row of list.items ?? []) {
      const response = await fetch('/api/v1/training/sessions/' + row.id + '/pause', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"' + row.revision + '"' }, body: '{}' });
      if (!response.ok) throw Error('Fixture pause failed');
    }
  });
  await page.locator('.app-footer button').click();
  await expect(page.locator('#training-title')).toBeEnabled();
  return account;
}
async function start(page: Page, text: Copy) {
  await page.locator('#training-title').fill('Quick training fixture');
  await page.getByRole('button', { name: text.start, exact: true }).click();
  await expect(page.locator('.training-session')).toBeVisible();
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  return (await page.locator('.training-session').getAttribute('data-session-id'))!;
}
async function addBench(page: Page, text: Copy) {
  await page.locator('#exercise-choice').selectOption(benchId);
  await page.locator('#setup-instance').fill('Fixture rack ' + crypto.randomUUID());
  await page.locator('#setup-semantics').selectOption('external_total');
  await page.locator('#setup-unit').selectOption('lb');
  await page.locator('#setup-includes-bar').selectOption('yes');
  await page.locator('#setup-bar').fill('45');
  await page.locator('.exercise-picker button[type=submit]').click();
  const card = page.locator('.training-exercise').last();
  await expect(card).toBeVisible();
  await expect(card).toContainText(text.barRule);
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  return card;
}
async function saveSet(card: Locator, value: string, reps: string) {
  const before = await card.locator('[data-set-id]').count();
  await card.locator('input[id$="-load"]').fill(value);
  await card.locator('input[id$="-reps"]').fill(reps);
  await card.locator('button[type=submit]').click();
  await expect(card.locator('[data-set-id]')).toHaveCount(before + 1);
}
async function tree(page: Page, sessionId: string) {
  return page.evaluate(async id => (await (await fetch('/api/v1/training/sessions/' + id + '?limit=100')).json()).data, sessionId);
}
test('training quick recording preserves drafts and queues consecutive offline sets before finishing', async ({ page, context }, info) => {
  const text = labels(info.project.name);
  await ready(page, info.project.name); const id = await start(page, text), card = await addBench(page, text);
  await card.locator('input[id$="-load"]').fill('１１０．');
  await page.locator('.chat-button').click(); await page.locator('.conversation .back-link').click();
  await expect(card).toBeVisible(); await page.reload();
  await expect(card.locator('input[id$="-load"]')).toHaveValue('１１０．');
  await context.setOffline(true); await expect(page.locator('[data-sync-state=offline]')).toBeVisible();
  await saveSet(card, '110', '10'); await expect(card.locator('[data-set-id]')).toHaveCount(1);
  await saveSet(card, '110', '8'); await expect(card.locator('[data-set-id]')).toHaveCount(2);
  await page.getByRole('button', { name: text.finish, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: text.keepAndFinish }).click();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed_pending_sync');
  await context.setOffline(false); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed');
  const data = await tree(page, id);
  const sets = data.items.filter((row: { type: string }) => row.type === 'workout_set').map((row: { value: unknown }) => row.value);
  expect(sets).toHaveLength(2);
  expect(sets).toEqual(expect.arrayContaining([expect.objectContaining({ loadDecimal: '110', kgMicros: 49_895_161, unit: 'lb', rpeHalfUnits: null, setType: 'unknown', reps: 10 }), expect.objectContaining({ reps: 8 })]));
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('training-completed.png'), fullPage: true });
});
test('editing, deleting, pause and cancel preserve actual sets and require explicit conflict review', async ({ page }, info) => {
  const text = labels(info.project.name);
  await ready(page, info.project.name); const id = await start(page, text), card = await addBench(page, text);
  await saveSet(card, '110', '10'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const row = card.locator('[data-set-id]').first(), setId = (await row.getAttribute('data-set-id'))!;
  await row.getByRole('button', { name: text.edit, exact: true }).click();
  await card.locator('input[id$="-reps"]').fill('8');
  await page.evaluate(async ({ id, setId }) => {
    const data = (await (await fetch('/api/v1/training/sessions/' + id)).json()).data;
    const current = data.items.find((row: { id: string }) => row.id === setId).value;
    const response = await fetch('/api/v1/training/sessions/' + id + '/sets/' + setId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"' + data.session.revision + '"' }, body: JSON.stringify({ expectedRevision: current.revision, reps: 9 }) });
    if (!response.ok) throw Error('Concurrent set edit failed');
  }, { id, setId });
  await page.locator('.app-footer button').click(); await expect(row.locator('.record-value')).toContainText('9');
  await expect(card.locator('input[id$="-reps"]')).toHaveValue('8');
  await card.locator('button[type=submit]').click();
  await expect(page.locator('[data-command-state=conflict]')).toHaveCount(1);
  await page.locator('[data-command-state=conflict]').getByRole('button', { name: text.review }).click();
  await expect(card.locator('input[id$="-reps"]')).toHaveValue('8');
  await expect(card.locator('button[type=submit]')).toBeEnabled(); await card.locator('button[type=submit]').click();
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible(); await expect(row.locator('.record-value')).toContainText('8');
  await page.getByRole('button', { name: text.pause, exact: true }).click(); await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'paused');
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.getByRole('button', { name: text.resume, exact: true }).click(); await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'in_progress');
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await saveSet(card, '95', '10'); await expect(card.locator('[data-set-id]')).toHaveCount(2); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await card.locator('[data-set-id]').last().getByRole('button', { name: text.remove, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: text.remove, exact: true }).click(); await expect(card.locator('[data-set-id]')).toHaveCount(1); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.getByRole('button', { name: text.cancelWorkout, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(text.cancelHasSets);
  expect((await tree(page, id)).session.status).toBe('in_progress');
  await page.getByRole('dialog').getByRole('button', { name: text.keepAndFinish }).click();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed');
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  expect((await tree(page, id)).session.status).toBe('completed');
  await row.getByRole('button', { name: text.remove, exact: true }).click();
  await expect(card.getByRole('alert')).toContainText(text.deleteCompleted); await expect(card.locator('[data-set-id]')).toHaveCount(1);
});
test('personal bodyweight and standard per-side setups keep unknowns and history units intact', async ({ page }, info) => {
  const text = labels(info.project.name);
  await ready(page, info.project.name); const id = await start(page, text);
  await page.locator('#exercise-choice').selectOption('custom');
  await page.locator('#exercise-name').fill('我的自重 ' + info.project.name);
  await page.locator('#exercise-equipment').selectOption('bodyweight');
  await page.locator('#setup-semantics').selectOption('bodyweight_only');
  await page.locator('.exercise-picker button[type=submit]').click();
  const body = page.locator('.training-exercise').first();
  await expect(body).toBeVisible(); await expect(body.locator('input[id$="-load"]')).toHaveCount(0);
  await body.locator('input[id$="-reps"]').fill('12'); await body.locator('button[type=submit]').click(); await expect(body.locator('[data-set-id]')).toHaveCount(1);
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.locator('#exercise-choice').selectOption('bdeba6ce-c5ba-4a1b-9910-000000000005');
  await page.locator('#setup-semantics').selectOption('per_side'); await page.locator('#setup-unit').selectOption('lb');
  await page.locator('.exercise-picker button[type=submit]').click();
  const side = page.locator('.training-exercise').last(); await expect(page.locator('.training-exercise')).toHaveCount(2);
  await saveSet(side, '35', '10'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const data = await tree(page, id), sets = data.items.filter((row: { type: string }) => row.type === 'workout_set').map((row: { value: unknown }) => row.value);
  expect(sets).toEqual(expect.arrayContaining([expect.objectContaining({ loadDecimal: null, unit: null, kgMicros: null, rpeHalfUnits: null }), expect.objectContaining({ loadDecimal: '35', kgMicros: 15_875_733, unit: 'lb', loadSemantics: 'per_side' })]));
  const nextLocale = info.project.name === 'en' ? 'zh-Hans' : 'en';
  await page.getByTestId('language').selectOption(nextLocale); await expect(page.locator('html')).toHaveAttribute('lang', nextLocale);
  await expect(side.locator('.record-value')).toContainText('35'); await expect(body).toContainText('我的自重');
  await page.getByTestId('language').selectOption(info.project.name);
  await page.getByRole('button', { name: text.finish, exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: text.keepAndFinish }).click();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed');
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
});

test('same-setup history prefill and explicit unit preference never rewrite previous sets or load increments', async ({ page }, info) => {
  const text = labels(info.project.name);
  await ready(page, info.project.name); const first = await start(page, text), card = await addBench(page, text);
  await saveSet(card, '110', '10'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const before = await tree(page, first);
  const exercise = before.items.find((row: { type: string }) => row.type === 'session_exercise').value;
  await page.evaluate(async setupId => {
    const response = await fetch('/api/v1/exercise-setups/' + setupId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"1"' }, body: JSON.stringify({ incrementDecimal: '5', incrementUnit: 'lb', availableLoads: { schemaVersion: 1, unit: 'lb', values: ['95', '110'] } }) });
    if (!response.ok) throw Error('Fixture increment failed');
  }, exercise.setupId);
  await page.getByRole('button', { name: text.finish, exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: text.keepAndFinish }).click();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.getByRole('button', { name: text.back, exact: true }).click();
  const second = await start(page, text);
  await page.locator('#exercise-choice').selectOption(benchId); await page.locator('#training-setup').selectOption(exercise.setupId); await page.locator('.exercise-picker button[type=submit]').click();
  await expect(card.locator('input[id$="-load"]')).toHaveValue('110'); await expect(card.locator('input[id$="-reps"]')).toHaveValue('10');
  expect((await tree(page, second)).items.filter((row: { type: string }) => row.type === 'workout_set')).toHaveLength(0);
  await card.locator('.joined-input select').selectOption('kg'); await saveSet(card, '50', '8'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const after = await tree(page, first);
  expect(after.items.find((row: { type: string }) => row.type === 'workout_set').value).toMatchObject({ loadDecimal: '110', unit: 'lb', kgMicros: 49_895_161, reps: 10 });
  const setup = await page.evaluate(async setupId => {
    const data = (await (await fetch('/api/v1/exercise-setups?limit=100')).json()).data;
    return data.items.find((row: { id: string }) => row.id === setupId);
  }, exercise.setupId);
  expect(setup).toMatchObject({ loadUnit: 'kg', incrementDecimal: '5', incrementUnit: 'lb', availableLoads: { unit: 'lb', values: ['95', '110'] } });
  await page.getByRole('button', { name: text.finish, exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: text.keepAndFinish }).click();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
});
