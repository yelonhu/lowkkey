import type { Page, Locator } from '@playwright/test';
import { expect, openWorkspace } from './fixtures.ts';
import { workspaceLocale } from '../../src/i18n/workspace-resources.ts';
import { trainingLocale } from '../../src/i18n/training-resources.ts';
export const words = (locale: string) => workspaceLocale(locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2);
export const trainingWords = (locale: string) => trainingLocale(locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2);
export const dateFor = (year: number, locale: string) => year + (locale === 'en' ? '-09-01' : locale === 'zh-Hant' ? '-05-01' : '-01-01');
export async function openDay(page: Page, locale: string, year: number, view = 'weight') {
  const date = dateFor(year, locale), account = await openWorkspace(page, locale, '/' + view + '?date=' + date);
  return { ...account, date };
}
export async function readWeightDay(page: Page, date: string) { return page.evaluate(async date => (await (await fetch('/api/v1/weights/days/' + date)).json()).data, date); }
export async function readTrainingDay(page: Page, date: string) { return page.evaluate(async date => (await (await fetch('/api/v1/training/days/' + date)).json()).data, date); }
export async function enterWeight(page: Page, value: string, unit?: string) {
  await expect(page.locator('.daily-weight')).toHaveAttribute('data-draft-ready', 'true');
  if (!await page.locator('#weight-value').isVisible()) await page.getByTestId('weight-reading').click();
  await page.locator('#weight-value').fill(value);
  if (unit) await page.locator('.weight-reading select').selectOption(unit);
}
export async function saveWeight(page: Page, locale: string, date: string, value: string, unit = 'kg') {
  await enterWeight(page, value, unit); await page.locator('.daily-heading h1').click();
  await expect.poll(async () => await page.getByRole('dialog').isVisible() || await page.getByTestId('weight-reading').isVisible()).toBe(true);
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('button', { name: words(locale).weight.confirmOutlier }).click();
  await expect.poll(async () => (await readWeightDay(page, date))?.value).toBe(value);
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  return readWeightDay(page, date);
}
export const load = (row: Locator) => row.locator('.row-load input');
export const reps = (row: Locator) => row.locator('[role=cell]').nth(2).locator('input');
export const rpe = (row: Locator) => row.locator('[role=cell]').nth(3).locator('input');
export async function addExercise(page: Page, locale: string, dumbbell = false) {
  await page.locator('.add-exercise').click();
  const labels = dumbbell ? ['Incline dumbbell press', '哑铃上斜卧推', '啞鈴上斜臥推'] : ['Barbell bench press','杠铃平板卧推','槓鈴平板臥推'];
  await page.getByRole('dialog').locator('.exercise-choice').filter({ hasText: labels[locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2] }).click();
  const card = page.locator('.training-exercise').last(); await expect(card.locator('[data-set-id]')).toHaveCount(1); return card;
}
export async function trainingReady(page: Page, locale: string, year: number) {
  const account = await openDay(page, locale, year, 'training');
  await page.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()).data;
    const response = await fetch('/api/v1/me', { method:'PATCH', headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"' + me.profile.revision + '"'}, body:JSON.stringify({defaultLoadUnit:'lb'}) }); if (!response.ok) throw Error();
    const setups = (await (await fetch('/api/v1/exercise-setups?limit=100')).json()).data.items;
    for (const setup of setups) if (setup.loadUnit !== 'lb') await fetch('/api/v1/exercise-setups/' + setup.id, {method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"' + setup.revision + '"'},body:JSON.stringify({loadUnit:'lb'})});
  });
  await page.reload(); await expect(page.locator('[data-sync-state=synced]')).toBeVisible(); return account;
}
