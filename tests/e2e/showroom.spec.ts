import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { seedShowroom, fixturePlans, fixtureSessions } from '../../scripts/rehearsal/fixtures.mjs';

async function connect(request: APIRequestContext, origin: string) {
  const verifier = randomBytes(48).toString('base64url'), redirect = origin + '/test-callback';
  const registered = await (await request.post(origin+'/oauth/register',{data:{client_name:'Showroom E2E',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'}})).json();
  const query = new URLSearchParams({response_type:'code',client_id:registered.client_id,redirect_uri:redirect,scope:'read write',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:origin+'/mcp'});
  const consent = await request.get(origin+'/authorize?'+query), html = await consent.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();
  const approval = await request.post(origin+'/authorize',{headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin},data:new URLSearchParams([['handle',handle!],['decision','approve'],['scope','read'],['scope','write']]).toString(),maxRedirects:0});
  expect(approval.status()).toBe(302);
  const code = new URL(approval.headers().location).searchParams.get('code')!;
  const token = await (await request.post(origin+'/oauth/token',{form:{grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:origin+'/mcp'}})).json();
  let sequence = 0;
  const rpc = async (method:string,params:unknown) => {
    const response = await request.post(origin+'/mcp',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},data:{jsonrpc:'2.0',id:++sequence,method,params}});
    expect(response.ok(),await response.text()).toBe(true);
    const value = await response.json(); expect(value.error).toBeUndefined(); expect(value.result.isError).not.toBe(true);
    return value.result;
  };
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'showroom-e2e',version:'1'}});
  return (name:string,args:unknown) => rpc('tools/call',{name,arguments:args}).then(value=>value.structuredContent.result);
}

test('empty showroom → four-tool writes → three screens → focus refresh → account', async ({page,baseURL},testInfo) => {
  test.setTimeout(120000);
  const errors:string[] = []; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'打开我的展厅',exact:true}).click();
  await expect(page.getByText('还没有训练安排')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(3);
  await page.getByRole('link',{name:'训练展厅',exact:true}).click();
  await expect(page.locator('.strength-card')).toHaveCount(0);
  await expect(page.getByText('还没有训练记录')).toBeVisible();
  await page.getByRole('link',{name:'体重',exact:true}).click();
  await expect(page.getByText('还没有体重记录')).toBeVisible();
  await expect(page.locator('.chart-band')).toHaveCount(0);
  const tool = await connect(page.request,baseURL!);
  await seedShowroom(tool);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.weight-number')).not.toContainText('—');
  for (const [screen,label] of [['Plan','下次练什么'],['Gallery','训练展厅'],['Weight','体重']]) {
    await page.getByRole('link',{name:label,exact:true}).click();
    await expect(page.locator('main')).toHaveAttribute('data-screen',screen);
    await expect(page.locator('main input,main textarea,main form')).toHaveCount(0);
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`.artifacts/playwright/${testInfo.project.name}/showroom-${screen}.png`,animations:'disabled'});
    await page.setViewportSize({width:1280,height:960});
    await page.screenshot({path:`.artifacts/playwright/${testInfo.project.name}/showroom-${screen}-desktop.png`,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
  }
  await expect(page.locator('.chart-band')).toHaveCount(1);
  await page.getByRole('link',{name:'训练展厅',exact:true}).click();
  await expect(page.locator('.session-entry')).toHaveCount(9);
  await expect(page.locator('.strength-card .chart-line')).toHaveCount(4);
  await expect(page.locator('.best-label')).toHaveCount(36);
  await page.locator('.session-entry').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:`.artifacts/playwright/${testInfo.project.name}/showroom-records.png`,animations:'disabled'});
  const raw = '  <script>literal, never executed</script>\n'+ '保留原话与换行。'.repeat(100);
  await tool('log_session',{...fixtureSessions[0],date:'2026-10-08',raw_text:raw});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.raw-text').first()).toHaveText(raw,{useInnerText:false});
  expect(await page.locator('.raw-text').first().textContent()).toBe(raw);
  await expect(page.locator('main script')).toHaveCount(0);
  await page.goto('/#Gallery?date=2026-10-08');
  await expect(page.locator('[id="Gallery-2026-10-08"]')).toBeInViewport();
  await page.goto('/#Plan?day='+encodeURIComponent(fixturePlans[0].day));
  await expect(page.locator('.plan-card').filter({hasText:fixturePlans[0].day}).first()).toBeInViewport();
  await page.goto('/#Weight?date=2026-10-01');
  await expect(page.locator('.receipt-note')).toContainText('2026-10-01');
  await expect(page.locator('.sync-status time')).toBeVisible();
  await tool('log_weight',{date:'2026-10-08',lb:170});
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.locator('.last-weight')).toContainText('170.0');
  await tool('set_plan',{...fixturePlans[0],day:'训练安排与恢复要点'.repeat(5),items:Array.from({length:12},(_,index)=>({...fixturePlans[0].items[index%3],note:'动作保持稳定，不急于增加重量。'.repeat(12)})),notes:{coach:'较长的教练备注。'.repeat(80)}});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  // Fallback fonts must retain readable chart labels and unbroken page widths.
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.reload();
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:844});
    for (const label of ['下次练什么','训练展厅','体重']) {
      await page.getByRole('link',{name:label,exact:true}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await expect.poll(()=>page.locator('.trend-chart').evaluateAll(charts=>charts.every(chart=>{
        const bounds=chart.getBoundingClientRect();
        return [...chart.querySelectorAll('text')].every(text=>{
          const label=text.getBoundingClientRect();
          return label.height>=9 && label.left>=bounds.left-1 && label.right<=bounds.right+1;
        });
      }))).toBe(true);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'设置'})).toBeVisible();
  await expect(page.getByRole('button',{name:'完成',exact:true})).toBeFocused();
  await expect(page.locator('.showroom-content')).toHaveAttribute('inert','');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.locator('.client-row').filter({hasText:'Showroom E2E'})).toBeVisible();
  await expect(page.getByText('正在读取…',{exact:true})).toHaveCount(0);
  await page.screenshot({path:`.artifacts/playwright/${testInfo.project.name}/showroom-settings.png`,animations:'disabled'});
  await page.getByRole('button',{name:'撤销授权',exact:true}).click();
  await expect(page.getByText('已撤销',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.locator('.showroom')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'打开我的展厅',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('Google-only sign-in preserves the receipt destination and hides unavailable email input', async ({page}) => {
  // Auth assertions must not depend on the external font service finishing a load.
  await page.route('https://fonts.googleapis.com/**', route=>route.abort());
  await page.route('https://fonts.gstatic.com/**', route=>route.abort());
  await page.route('**/api/auth/config', route=>route.fulfill({json:{mode:'customer',local:false,google:true,email:false,aiConnection:true}}));
  let body:Record<string,string>|undefined;
  await page.route('**/api/auth/sign-in/social',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{url:'/#Login'}});});
  await page.goto('/#Gallery?date=2026-10-08');
  await expect(page.getByRole('button',{name:'使用 Google 继续'})).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  await page.getByRole('button',{name:'使用 Google 继续'}).click();
  await expect.poll(()=>body?.callbackURL).toBe('/#Gallery?date=2026-10-08');
  await expect(page).toHaveURL(/\/#Login$/);
  await page.goto('/?returnTo='+encodeURIComponent('/authorize?client_id=test')+'#Login');
  await page.getByRole('button',{name:'使用 Google 继续'}).click();
  await expect.poll(()=>body?.callbackURL).toBe('/authorize?client_id=test');
});
