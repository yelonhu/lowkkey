import { test, expect, type Page } from '@playwright/test';
async function openNotes(page: Page) {
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto('/#notes');
  await page.getByRole('button', { name: '打开我的展厅', exact: true }).click();
  await expect(page.locator('#v-notes')).toBeVisible();
  await expect(page.getByText('正在打开随手记…')).toHaveCount(0);
  const state = await (await page.request.get('/v1/state')).json();
  const date = state.today as string;
  const editor = page.getByRole('textbox', { name: date + ' 随手记', exact: true });
  await expect(editor).toBeVisible();
  return { date, owner: state.accountId as string, editor, section: page.locator('[id="notes-' + date + '"]') };
}
// The server is shared by this engine; leave the following empty-account tests empty.
test.afterEach(async ({ page, baseURL }) => {
  // Logout is part of the test: restore only the isolated local test session for cleanup.
  await page.request.post('/api/local/session', { headers: { Origin: baseURL! } });
  const response = await page.request.get('/v1/state');
  if (!response.ok()) return;
  const { accountId } = await response.json();
  for (;;) {
    const { notes } = await (await page.request.get('/v1/notes?limit=30')).json();
    if (!notes.length) break;
    for (const note of notes)
      expect(
        (
          await page.request.put('/v1/notes/' + note.date, {
            headers: { Origin: baseURL!, 'X-Lowkkey-Account': accountId },
            data: { text: '', revision: note.revision },
          })
        ).ok(),
      ).toBe(true);
  }
});
test('free writing: IME, autosave, route changes, offline draft recovery and conflict', async ({ page, baseURL }) => {
  const { date, owner, editor, section } = await openNotes(page);
  await page.goto('/#start');
  await page.getByRole('button', { name: '先随手记', exact: true }).click();
  await expect(page.locator('#v-notes')).toBeVisible();
  const text = '  深蹲 空杆 × 10\n135lb * 8，今天状态不错 🙂！\n\n<script>只当原文</script>  ';
  let writes = 0;
  page.on('request', r => {
    if (r.method() === 'PUT' && r.url().includes('/v1/notes/')) writes++;
  });
  await editor.click();
  await expect(editor).toHaveCSS('outline-style', 'none');
  await expect(editor).toHaveCSS('box-shadow', 'none');
  await editor.dispatchEvent('compositionstart');
  await editor.fill(text);
  await page.waitForTimeout(1100);
  expect(writes).toBe(0);
  await editor.dispatchEvent('compositionend');
  await expect(section.getByRole('status')).toHaveText('已保存');
  expect((await (await page.request.get('/v1/notes/' + date)).json()).text).toBe(text);
  await editor.fill(text + '\n切页前的一行');
  await page.getByRole('link', { name: 'log', exact: true }).click();
  await page.getByRole('link', { name: 'notes', exact: true }).click();
  await expect(editor).toHaveValue(text + '\n切页前的一行');
  await expect(section.getByRole('status')).toHaveText('已保存');
  await page
    .context()
    .route('**/v1/notes/*', route =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 503, json: { error: { code: 'offline' } } })
        : route.continue(),
    );
  const offline = text + '\n断网也留下';
  await editor.fill(offline);
  await expect(section.getByRole('status')).toContainText('未能同步');
  await page.reload();
  await expect(editor).toHaveValue(offline);
  await expect(section.getByRole('status')).toContainText('未能同步');
  await page.context().unroute('**/v1/notes/*');
  await page.unroute('**/v1/notes/*');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(section.getByRole('status')).toHaveText('已保存');
  const prior = await (await page.request.get('/v1/notes/' + date)).json();
  const updated = await page.request.put('/v1/notes/' + date, {
    headers: { Origin: baseURL!, 'X-Lowkkey-Account': owner },
    data: { text: '另一台设备的文字', revision: prior.revision },
  });
  expect(updated.ok()).toBe(true);
  await editor.fill('我的新文字，不能被覆盖');
  await expect(section.getByRole('region', { name: '选择保留的内容' })).toBeVisible();
  await expect(section.locator('pre')).toHaveText('另一台设备的文字');
  await section.getByRole('button', { name: '保留我的内容' }).click();
  await expect(section.getByRole('status')).toHaveText('已保存');
  expect((await (await page.request.get('/v1/notes/' + date)).json()).text).toBe('我的新文字，不能被覆盖');
  await editor.fill('🙂'.repeat(20001));
  await expect(section.getByRole('status')).toContainText('超过 20,000 字');
  expect(await editor.inputValue()).toBe('🙂'.repeat(20001));
  await editor.fill('完成');
  await expect(section.getByRole('status')).toHaveText('已保存');
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('lowkkey-note:')).length),
  ).toBe(0);
});
test('continuous pages, theme layouts, clear history and rollover without moving active text', async ({
  page,
  baseURL,
}, info) => {
  const { date, owner } = await openNotes(page);
  for (let i = 1; i <= 33; i++) {
    const past = new Date(date + 'T12:00:00Z');
    past.setUTCDate(past.getUTCDate() - i);
    const day = past.toISOString().slice(0, 10);
    const previous = await (await page.request.get('/v1/notes/' + day)).json();
    expect(
      (
        await page.request.put('/v1/notes/' + day, {
          headers: { Origin: baseURL!, 'X-Lowkkey-Account': owner },
          data: {
            text: `记录 ${i}\n哑铃推肩 40lb × 10\n自由记录，保留每一行。\n` + '今天的感受。'.repeat(20),
            revision: previous.revision,
          },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.reload();
  await expect(page.getByRole('button', { name: '更早的记录' })).toBeVisible();
  await page.getByRole('button', { name: '更早的记录' }).click();
  await expect(page.getByRole('button', { name: '更早的记录' })).toHaveCount(0);
  await expect(page.locator('.note-day')).toHaveCount(34);
  const linkedDate = await page.locator('.note-day').first().locator('time').getAttribute('datetime');
  await page.goto('/#notes?date=' + linkedDate);
  await page.reload();
  await expect(page.locator('[id="notes-' + linkedDate + '"]')).toBeInViewport();
  await page.getByRole('button', { name: '更早的记录' }).click();
  await expect(page.locator('.note-day')).toHaveCount(34);
  const old = page.locator('.note-text').first();
  await old.fill('');
  await old.blur();
  await expect(page.locator('.note-day').first()).toBeHidden();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const theme of ['ink', 'gold', 'pearl']) {
      await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.getByRole('textbox', { name: date + ' 随手记', exact: true }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.note-day').nth(31).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.artifacts/playwright/${info.project.name}/notes-${theme}-${colorScheme}.png` });
    }
  }
  const tomorrow = new Date(date + 'T12:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const next = tomorrow.toISOString().slice(0, 10);
  const editor = page.getByRole('textbox', { name: date + ' 随手记', exact: true });
  await editor.fill('跨午夜仍属于原日期');
  await editor.focus();
  await page.route('**/v1/state', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), today: next } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('textbox', { name: next + ' 随手记', exact: true })).toHaveValue('');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('跨午夜仍属于原日期');
});
test('pending notes remain visible when logout is cancelled', async ({ page }) => {
  const { editor, section } = await openNotes(page);
  await page.route('**/v1/notes/*', r => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
  await editor.fill('离线草稿，不能退出时丢失');
  await expect(section.getByRole('status')).toContainText('未能同步');
  await page.getByRole('button', { name: 'lowkkey，打开设置' }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  const warning = page.getByRole('region', { name: '未同步的随手记' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(editor).toHaveValue('离线草稿，不能退出时丢失');
  await page.context().unroute('**/v1/notes/*');
  await page.unroute('**/v1/notes/*');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(section.getByRole('status')).toHaveText('已保存');
  await page.route('**/v1/notes/*', r =>
    r.request().method() === 'PUT' ? r.fulfill({ status: 503, json: { error: { code: 'offline' } } }) : r.continue(),
  );
  await editor.fill('导出后安全退出');
  await expect(section.getByRole('status')).toContainText('未能同步');
  await page.getByRole('button', { name: 'lowkkey，打开设置' }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出草稿并继续', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('lowkkey-notes-drafts.json');
  await expect(page.getByRole('button', { name: '打开我的展厅', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('lowkkey-note:')).length),
  ).toBe(0);
});
