import { test, expect, type Page } from '@playwright/test';
import { fixturePlans, fixtureSessions } from '../../scripts/rehearsal/fixtures.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

async function open(page: Page, baseURL: string) {
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.request.post('/api/local/session', { headers: { Origin: baseURL } });
  const state = await (await page.request.get('/v1/state')).json(),
    stamp = new Date().toISOString();
  await page.route('**/v1/state', r =>
    r.fulfill({
      json: {
        ...state,
        sessions: fixtureSessions.map(s => ({ ...s, updated_at: stamp })),
        plans: fixturePlans.map(p => ({ ...p, updated_at: stamp, coach: p.coach ?? null })),
      },
    }),
  );
  await page.route('**/v1/onboarding', async r => {
    const response = await r.fetch();
    await r.fulfill({ json: { ...(await response.json()), hasContent: true, completedAt: stamp } });
  });
  await page.goto('/#next');
  await expect(page.locator('#v-next')).toBeVisible();
  await expect(page.locator('#v-next .bd-next')).toBeVisible();
  return state.today as string;
}
// Deterministic pointer routing in both engines; real touch arbitration is separately checked with CDP and on iPhone.
async function gesture(page: Page, points: number[][], selector = '.page-viewport', cancel = false) {
  await page.locator(selector).evaluate(
    async (el, { points, cancel }) => {
      const event = (type: string, p: number[]) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: 'touch',
            pointerId: 11,
            isPrimary: true,
            clientX: p[0],
            clientY: p[1],
          }),
        );
      event('pointerdown', points[0]);
      for (const point of points.slice(1)) {
        await new Promise(r => setTimeout(r, 30));
        event('pointermove', point);
      }
      await new Promise(r => setTimeout(r, 120));
      event(cancel ? 'pointercancel' : 'pointerup', points.at(-1)!);
    },
    { points, cancel },
  );
}
async function settled(page: Page, screen: string) {
  await expect(page).toHaveURL(new RegExp('#' + screen + '$'));
  await expect(page.locator('#v-' + screen)).toBeVisible();
  await expect(page.locator('[data-swiping]')).toHaveCount(0);
}

test('swipe routing, cancellation, protected regions and retained editors', async ({ page, baseURL }) => {
  const today = await open(page, baseURL!);
  await gesture(page, [
    [300, 400],
    [260, 400],
    [110, 400],
  ]);
  await settled(page, 'recap');
  await gesture(page, [
    [250, 400],
    [210, 402],
  ]);
  await settled(page, 'recap');
  await page.locator('.page-viewport').evaluate(async el => {
    const emit = (type: string, x: number, id = 11) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'touch',
          pointerId: id,
          isPrimary: id === 11,
          clientX: x,
          clientY: 400,
        }),
      );
    emit('pointerdown', 250);
    await new Promise(r => setTimeout(r, 15));
    emit('pointermove', 180);
    emit('pointerup', 180);
  });
  await settled(page, 'body');
  await gesture(page, [
    [80, 400],
    [280, 400],
  ]);
  await settled(page, 'recap');
  await page.locator('.page-viewport').evaluate(el => {
    const emit = (type: string, x: number, id = 11) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'touch',
          pointerId: id,
          isPrimary: id === 11,
          clientX: x,
          clientY: 400,
        }),
      );
    emit('pointerdown', 300);
    emit('pointermove', 180);
    emit('pointerdown', 100, 12);
    emit('pointerup', 180);
    emit('pointerup', 100, 12);
  });
  await settled(page, 'recap');
  await gesture(
    page,
    [
      [250, 400],
      [100, 400],
    ],
    '.page-viewport',
    true,
  );
  await settled(page, 'recap');
  await gesture(page, [
    [250, 400],
    [249, 490],
    [80, 510],
  ]);
  await settled(page, 'recap');
  await gesture(page, [
    [5, 400],
    [170, 400],
  ]);
  await settled(page, 'recap');
  await gesture(
    page,
    [
      [300, 400],
      [100, 400],
    ],
    'main:visible .chartbox',
  );
  await settled(page, 'recap');
  await page.getByRole('link', { name: 'board', exact: true }).click();
  await settled(page, 'next');
  await gesture(page, [
    [80, 400],
    [270, 400],
  ]);
  await settled(page, 'next');
  await page.evaluate(() => scrollTo(0, 300));
  const position = await page.evaluate(() => scrollY);
  await gesture(page, [
    [300, 400],
    [80, 400],
  ]);
  await settled(page, 'recap');
  await page.goBack();
  await settled(page, 'next');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  await page.getByRole('link', { name: 'notes', exact: true }).click();
  const editor = page.getByRole('textbox', { name: today + ' 随手记' });
  await expect(editor).toBeVisible();
  await editor.fill('中文组合输入之前\n保留我的草稿');
  await editor.evaluate(el => {
    el.dataset.identity = 'retained';
    (el as HTMLTextAreaElement).setSelectionRange(3, 5);
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await gesture(page, [
    [80, 400],
    [280, 400],
  ]);
  await settled(page, 'notes');
  await expect(editor).toBeFocused();
  await editor.evaluate(el =>
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '输入' })),
  );
  await editor.blur();
  await gesture(
    page,
    [
      [80, 400],
      [280, 400],
    ],
    '.note-text',
  );
  await settled(page, 'notes');
  await gesture(page, [
    [300, 400],
    [80, 400],
  ]);
  await settled(page, 'notes');
  await gesture(page, [
    [80, 400],
    [280, 400],
  ]);
  await settled(page, 'log');
  await gesture(page, [
    [300, 400],
    [80, 400],
  ]);
  await settled(page, 'notes');
  await expect(editor).toHaveAttribute('data-identity', 'retained');
  await expect(editor).toHaveValue('中文组合输入之前\n保留我的草稿');
  await expect(editor).toHaveCSS('user-select', 'text');
  await expect(page.locator('.tabs')).toHaveCSS('user-select', 'none');
  await page.getByRole('link', { name: 'log', exact: true }).click();
  await settled(page, 'log');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gesture(page, [
    [80, 400],
    [280, 400],
  ]);
  await settled(page, 'body');
  await page.goto('/privacy');
  await expect(page.locator('.privacy-document')).toHaveCSS('user-select', 'text');
});

test('swipe interruption, theme widths and measured frames', async ({ page, baseURL }, info) => {
  test.setTimeout(90000);
  await open(page, baseURL!);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const theme of ['ink', 'gold']) {
        await page.evaluate(t => (document.documentElement.dataset.theme = t), theme);
        await gesture(page, [
          [width - 40, 400],
          [40, 400],
        ]);
        await settled(page, 'recap');
        await gesture(page, [
          [40, 400],
          [width - 40, 400],
        ]);
        await settled(page, 'next');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const events: unknown[] = [],
    cdp = info.project.name === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    cdp.on('Tracing.dataCollected', data => events.push(...data.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  }
  const frames = await page.locator('.page-viewport').evaluate(async el => {
    const emit = (type: string, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'touch',
          pointerId: 12,
          isPrimary: true,
          clientX: x,
          clientY: 400,
        }),
      );
    const frames: number[] = [];
    let last = performance.now();
    emit('pointerdown', 300);
    for (let i = 0; i < 45; i++) {
      await new Promise<void>(r =>
        requestAnimationFrame(now => {
          frames.push(now - last);
          last = now;
          emit('pointermove', 300 - i * 4);
          r();
        }),
      );
    }
    emit('pointerup', 124);
    await new Promise(r => setTimeout(r, 55));
    // Catch the settling animation and reverse it without a queued navigation.
    emit('pointerdown', 120);
    emit('pointermove', 290);
    await new Promise(r => setTimeout(r, 30));
    emit('pointerup', 290);
    return frames;
  });
  await settled(page, 'next');
  if (cdp) {
    const done = new Promise<void>(r => cdp.once('Tracing.tracingComplete', () => r()));
    await cdp.send('Tracing.end');
    await done;
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
    for (const x of [270, 230, 170, 100])
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settled(page, 'recap');
    await cdp.detach();
  }
  await mkdir('.artifacts/swipe', { recursive: true });
  await writeFile(`.artifacts/swipe/${info.project.name}.json`, JSON.stringify({ frames, events }));
});
