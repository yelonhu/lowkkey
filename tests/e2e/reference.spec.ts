import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { StateResponse, Facts } from '@lowkkey/protocol';
import { themeState } from '@lowkkey/core';
const file = '.local/v5/reference-facts.json';
test('private reference: fixed October 8, exact type, tokens, content and expansion', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  test.skip(!existsSync(file), 'Private user data is never supplied to CI');
  const facts = Facts.parse(JSON.parse(readFileSync(file, 'utf8'))),
    today = '2026-10-08';
  const state = StateResponse.parse({
    ...facts,
    accountId: 'private-reference',
    protocol: '5.0.0',
    today,
    theme_state: themeState(facts, today),
  });
  await page.route('**/v1/state', route => route.fulfill({ json: state }));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const nextCard = page.locator('#v-next .bd-next');
  await expect(nextCard.locator('.bd-kind')).toContainText('明天');
  await expect(nextCard.locator('.bd-kind')).toContainText('周五 10.09');
  await expect(nextCard.locator('h3')).toHaveText('肩');
  await expect(page.locator('.items').first().locator('.it')).toHaveCount(4);
  const styles = await page.locator('main:visible').evaluate(el => ({
    width: el.getBoundingClientRect().width,
    font: getComputedStyle(el).fontFamily,
    body: getComputedStyle(document.body).backgroundColor,
  }));
  expect(styles.font).toContain('Inter');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const theme of ['ink', 'gold']) {
      state.curations[0].theme = { id: theme as 'ink' | 'gold', why: '主题验收' };
      state.theme_state = themeState(state, today);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const screen of ['next', 'recap', 'body', 'log']) {
          await page.getByRole('link', { name: screen === 'next' ? 'board' : screen, exact: true }).click();
          await expect(page.locator('main:visible')).toHaveAttribute('id', 'v-' + screen);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (screen === 'next')
            await page.locator('details').evaluateAll(items =>
              items.forEach(item => {
                (item as HTMLDetailsElement).open = true;
              }),
            );
          if (screen === 'recap') await expect(page.locator('.letter h1')).toHaveText(facts.curations[0].recap!.title!);
          if (screen === 'log') {
            await expect(page.locator('.ses')).toHaveCount(16);
            await page.locator('.lifts .row').first().click();
            for (const session of facts.sessions)
              if (session.note)
                await expect(page.locator('[id="log-' + session.date + '"] .said')).toHaveText(session.note);
          }
          await page.evaluate(
            () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          );
          await page.screenshot({
            path: `.artifacts/private-reference/${testInfo.project.name}/${screen}-${theme}-${colorScheme}-${width}.png`,
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
    }
  }
});
