import { test, expect, type Page } from '@playwright/test';
import {
  fixtureCuration,
  fixturePlans,
  fixtureSessions,
  fixtureWeek,
  fixtureWeights,
} from '../../scripts/rehearsal/fixtures.mjs';

// The state pod: ambient theme light, the one voice, the status line, press feedback,
// pull-to-sync and the phone settings sheet. Facts are routed, so the account stays empty.
async function open(page: Page, baseURL: string, curations: unknown[] = []) {
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.request.post('/api/local/session', { headers: { Origin: baseURL } });
  const state = await (await page.request.get('/v1/state')).json(),
    stamp = new Date().toISOString();
  const theme = (curations as { theme?: { id: string; why: string } }[]).find(c => c.theme)?.theme;
  let reads = 0;
  await page.route('**/v1/state', r => {
    reads++;
    return r.fulfill({
      json: {
        ...state,
        sessions: fixtureSessions.map(s => ({ ...s, updated_at: stamp })),
        plans: fixturePlans.map(p => ({ ...p, updated_at: stamp, coach: p.coach ?? null })),
        weights: fixtureWeights.map(w => ({ ...w, updated_at: stamp })),
        curations,
        theme_state: {
          user: 'ink',
          active: theme?.id ?? 'ink',
          manual_this_week: false,
          source_week: theme ? fixtureWeek : null,
          reason: theme?.why ?? null,
        },
      },
    });
  });
  await page.route('**/v1/onboarding', async r => {
    const response = await r.fetch();
    await r.fulfill({ json: { ...(await response.json()), hasContent: true, completedAt: stamp } });
  });
  await page.goto('/#next');
  await expect(page.locator('#v-next .bd-next')).toBeVisible();
  return { today: state.today as string, reads: () => reads };
}

test('status line, ambient sky, mood whisper and the single voice', async ({ page, baseURL }) => {
  await open(page, baseURL!, [
    {
      week: fixtureWeek,
      next: fixtureCuration.next,
      board: fixtureCuration.board,
      revision: 1,
      updated_at: new Date().toISOString(),
    },
  ]);
  const status = page.locator('#v-next .status');
  await expect(status).toContainText('week');
  await expect(status).toContainText('本周');
  await expect(status).toContainText('lb');
  await expect(page.locator('.sky')).toHaveCount(1);
  await expect(page.locator('.mood')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  // Every AI passage carries the mark; the user's own words stay in brackets.
  await page.getByRole('link', { name: 'log', exact: true }).click();
  await expect(page.locator('#v-log .said').first()).toBeVisible();
  const mark = await page
    .locator('#v-next .cl')
    .first()
    .evaluate(el => getComputedStyle(el, '::before').borderRadius);
  expect(mark).toBe('50%');
});

test('a weekly theme becomes light, a whisper and a reason', async ({ page, baseURL }) => {
  await open(page, baseURL!, [
    {
      week: fixtureWeek,
      theme: { id: 'gold', why: '主项稳步前进' },
      revision: 1,
      updated_at: new Date().toISOString(),
    },
  ]);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gold');
  await expect(page.locator('.mood')).toContainText('鎏金');
  await expect(page.locator('.mood')).toContainText('主项稳步前进');
  const sky = await page.locator('.sky').evaluate(el => getComputedStyle(el).backgroundImage);
  expect(sky).toContain('radial-gradient');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('press feedback follows the finger and pulling past the top syncs', async ({ page, baseURL }) => {
  const { reads } = await open(page, baseURL!);
  await page.getByRole('link', { name: 'log', exact: true }).click();
  const row = page.locator('#v-log .row').first();
  await expect(row).toBeVisible();
  await row.evaluate(el =>
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        pointerId: 21,
        isPrimary: true,
        button: 0,
        clientX: 100,
        clientY: 300,
      }),
    ),
  );
  await expect(row).toHaveAttribute('data-pressed', '');
  await page.evaluate(() =>
    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 21, clientX: 100, clientY: 340 }),
    ),
  );
  await expect(row).not.toHaveAttribute('data-pressed', '');
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 21 })),
  );
  const before = reads();
  const supported = await page.evaluate(() => {
    try {
      return !!new Touch({ identifier: 1, target: document.body });
    } catch {
      return false;
    }
  });
  test.skip(!supported, 'Synthetic Touch events are unavailable in this engine');
  await page.evaluate(async () => {
    const touch = (y: number) => new Touch({ identifier: 7, target: document.body, clientX: 180, clientY: y });
    const fire = (type: string, y: number) =>
      window.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          touches: type === 'touchend' ? [] : [touch(y)],
          changedTouches: [touch(y)],
        }),
      );
    scrollTo(0, 0);
    fire('touchstart', 200);
    for (const y of [220, 260, 300, 340]) {
      await new Promise(r => setTimeout(r, 20));
      fire('touchmove', y);
    }
    fire('touchend', 340);
  });
  await expect(page.locator('#pull')).toHaveAttribute('data-state', /syncing|done/);
  await expect.poll(reads).toBeGreaterThan(before);
  await expect(page.locator('#pull')).not.toHaveAttribute('data-state', /./, { timeout: 5000 });
});

test('phone settings rise from the bottom edge and close on a downward drag', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'lowkkey，打开设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return box ? Math.round(box.y + box.height) : 0;
    })
    .toBe(844);
  const heading = page.locator('.settings-heading');
  await heading.evaluate(el => {
    const emit = (type: string, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'touch',
          pointerId: 31,
          isPrimary: true,
          clientX: 200,
          clientY: y,
        }),
      );
    emit('pointerdown', 300);
    emit('pointermove', 360);
    emit('pointermove', 420);
    emit('pointerup', 420);
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'lowkkey，打开设置' })).toBeFocused();
});
