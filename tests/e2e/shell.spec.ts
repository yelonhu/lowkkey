import { openDay, enterWeight, saveWeight } from './daily-helpers.ts';
import { test, expect, openWorkspace } from './fixtures.ts';
test('three artifacts and a quiet accessible conversation entrance use no model requests', async ({ page }, info) => {
  const modelRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/assistant/requests')) modelRequests.push(request.url()); });
  await openWorkspace(page, info.project.name);
  await expect(page.locator('[data-artifact]')).toHaveCount(3);
  expect(await page.locator('[data-artifact]').evaluateAll(elements => elements.map(element => element.getAttribute('data-artifact')))).toEqual(['SessionArtifact', 'WeightArtifact', 'DietArtifact']);
  const chat = page.locator('.chat-button');
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await chat.boundingBox(); expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(chat).toHaveCSS('font-size', '14px');
    await page.screenshot({ path: `.artifacts/playwright/${info.project.name}-${width}-overview.png`, fullPage: true });
  }
  await chat.click(); await expect(page.locator('#conversation-draft')).toBeVisible(); await expect(page.locator('#conversation-draft')).not.toBeFocused();
  await page.locator('#conversation-draft').fill('Keep this thought · 不自动发送');
  await page.locator('.conversation .back-link').click(); await expect(page.locator('[data-artifact]').first()).toBeVisible(); await expect(page.locator('[data-artifact]')).toHaveCount(3);
  await chat.click(); await expect(page.locator('#conversation-draft')).toHaveValue('Keep this thought · 不自动发送');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.conversation')).toHaveCSS('animation-name', 'none');
  expect(modelRequests).toEqual([]);
});
test('real weight normalizes full-width input and retains ambiguous drafts across languages',async({page},info)=>{
 const {date}=await openDay(page,info.project.name,2002);await enterWeight(page,'７０．３','kg');await page.locator('.weight-reading select').focus();
 await page.locator('.daily-heading h1').click();await expect(page.getByTestId('weight-reading')).toContainText('70.3');
 await saveWeight(page,info.project.name,date,'70.3');
 await enterWeight(page,'34,3');await page.locator('.daily-heading h1').click();await expect(page.locator('.weight-hero [role=alert]')).toBeVisible();
 for(const locale of ['zh-Hant','en','zh-Hans']){await page.getByTestId('language').selectOption(locale);await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('#weight-value')).toHaveValue('34,3');}
 await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();await expect(page).toHaveURL(/weight\?date=/);await page.reload();await expect(page.locator('#weight-value')).toHaveValue('34,3');
});
test('health is real; unfinished APIs and secrets are inaccessible', async ({ request }) => {
  const health = await request.get('/healthz'); expect(await health.json()).toEqual({ status: 'ok' });
  const me = await request.get('/api/v1/me'); expect(me.status()).toBe(401); expect(me.headers()['cache-control']).toBe('no-store');
  for (const url of ['/.env', '/.data/dev/probe', '/.logs/processes.jsonl']) { const response = await request.get(url); expect(await response.text()).not.toContain('VEYRA_CANARY_DEPLOY_SECRET'); expect(response.status()).not.toBe(200); }
});
test('unsupported browser language falls back to readable English', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'languages', { get: () => ['fr-CA'] }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('select')).toHaveValue('en');
  await expect(page.getByRole('button', { name: 'Open local demo' })).toBeVisible();
});
test('local login activates only its fixture and supports real profile writes and logout', async ({ request }, info) => {
  const baseHeaders = { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' };
  const invalid = await request.post('/api/local/session', { headers: baseHeaders, data: { ownerId: 'another-person' } }); expect(invalid.status()).toBe(400);
  const crossSite = await request.post('/api/local/session', { headers: { ...baseHeaders, Origin: 'https://attacker.invalid' }, data: {} }); expect(crossSite.status()).toBe(403);
  const login = await request.post('/api/local/session', { headers: baseHeaders, data: {} }); expect(login.status()).toBe(200);
  expect(login.headers()['set-cookie']).toContain('HttpOnly');
  const session = await (await request.get('/api/v1/session')).json();
  expect(session.data.email).toBe('local-member@example.invalid');
  if (session.data.status === 'invited') {
    const activated = await request.post('/api/v1/session/activate', { headers: { ...baseHeaders, 'Idempotency-Key': crypto.randomUUID() }, data: { displayName: 'Browser fixture', goalType: 'maintenance', timezone: 'America/Chicago', locale: info.project.name } });
    expect(activated.status()).toBe(201);
  }
  const meResponse = await request.get('/api/v1/me'); expect(meResponse.status()).toBe(200);
  const me = await meResponse.json(); expect(me.data.environment).toBe('test'); expect(me.meta.restoreEpoch).toMatch(/^[a-f0-9-]{36}$/);
  const updated = await request.patch('/api/v1/me', { headers: { ...baseHeaders, 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${me.data.profile.revision}"` }, data: { locale: info.project.name } });
  expect(updated.status()).toBe(200); expect((await updated.json()).data.result.profile.locale).toBe(info.project.name);
  const logout = await request.post('/api/v1/session/logout', { headers: { ...baseHeaders, 'Idempotency-Key': crypto.randomUUID() }, data: { localDataDisposition: 'synced' } });
  expect(logout.status()).toBe(200);
  expect((await request.get('/api/v1/me')).status()).toBe(401);
  const end = await request.get((await logout.json()).data.result.logoutUrl, { maxRedirects: 0 }); expect(end.status()).toBe(303); expect(end.headers()['set-cookie']).toContain('Max-Age=0');
  expect((await request.post('/api/local/session', { headers: baseHeaders, data: {} })).status()).toBe(200);
  expect((await request.get('/api/v1/me')).status()).toBe(200);
});
