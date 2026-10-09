import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { seedShowroom, fixturePlans, fixtureSessions, fixtureToday, fixtureWeek } from '../../scripts/rehearsal/fixtures.mjs';

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

test('empty → seven tools → four pages, all themes, narrow layout, refresh and settings', async ({page,baseURL},testInfo) => {
  test.setTimeout(150000);
  const errors:string[] = []; page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.goto('/');
  await page.getByRole('button',{name:'打开我的展厅',exact:true}).click();
  await expect(page.getByText('还没有训练安排。和 Claude 聊好之后，会出现在这里。')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(4);
  await page.getByRole('link',{name:'log',exact:true}).click();
  await expect(page.getByText('还没有训练记录。')).toBeVisible();
  await page.getByRole('link',{name:'body',exact:true}).click();
  await expect(page.getByText('还没有体重记录。')).toBeVisible();
  const tool = await connect(page.request,baseURL!);
  await seedShowroom(tool);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.bw')).toBeVisible();
  for (const colorScheme of ['light','dark'] as const) {
    await page.emulateMedia({colorScheme});
    for (const theme of ['ink','gold','pearl']) {
      await page.locator(`[data-t="${theme}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      for (const width of [320,390,1280]) {
        await page.setViewportSize({width,height:844});
        for (const screen of ['next','recap','body','log']) {
          await page.getByRole('link',{name:screen,exact:true}).click();
          await expect(page.locator('main')).toHaveAttribute('id','v-'+screen);
          await expect(page.locator('main input,main textarea,main form')).toHaveCount(0);
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${theme} ${screen} ${width}`).toBe(true);
          await page.screenshot({path:`.artifacts/playwright/${testInfo.project.name}/${screen}-${theme}-${colorScheme}-${width}.png`,animations:'disabled'});
        }
      }
    }
  }
  await expect(page.locator('.ses')).toHaveCount(9);
  await page.locator('.lifts .row').first().click();
  await expect(page.locator('.lifts .open .detail')).toContainText('借力 2');
  await expect(page.locator('.lifts .open .detail')).toContainText('没做完整');
  const note = '<script>literal, never executed</script>\n'+ '保留原话与换行。'.repeat(12);
  await tool('log_session',{...fixtureSessions.at(-1),note});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.said').first()).toHaveText(note,{useInnerText:false});
  await expect(page.locator('main script')).toHaveCount(0);
  await page.goto('/#Gallery?date='+fixtureToday);
  await expect(page.locator('[id="log-'+fixtureToday+'"]').first()).toBeInViewport();
  await page.goto('/#Plan?day='+encodeURIComponent(fixturePlans[1].title));
  await expect(page.locator('details').filter({hasText:fixturePlans[1].title}).first()).toHaveAttribute('open','');
  await tool('set_plan',{...fixturePlans[0],items:Array.from({length:12},(_,index)=>({...fixturePlans[0].items[index%3],note:'动作保持稳定，不急于增加重量。'.repeat(12)})),coach:'较长的教练备注。'.repeat(80)});
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.items').first().locator('li')).toHaveCount(12);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('link',{name:'recap',exact:true}).click();
  await page.locator('.lift[data-ex="back_squat"]').click();
  await expect(page.locator('.lift[data-ex="back_squat"]')).toHaveAttribute('aria-pressed','true');
  const chart=page.locator('.chartbox svg').first();
  await chart.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tip.on')).toBeVisible();
  // Deleting referenced data hides the pick instead of rendering stale readings.
  await tool('delete',{kind:'session',date:fixtureToday});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.pick')).toHaveCount(0);
  await tool('curate',{week:fixtureWeek,recap:{picks:null},theme:null});
  await page.getByRole('button',{name:'lowkkey，打开设置',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'设置'})).toBeVisible();
  await expect(page.getByRole('button',{name:'完成',exact:true})).toBeFocused();
  await expect(page.locator('.showroom-content')).toHaveAttribute('inert','');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'lowkkey，打开设置',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'lowkkey，打开设置',exact:true}).click();
  await expect(page.locator('.client-row').filter({hasText:'Showroom E2E'})).toBeVisible();
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.getByText('正在读取…',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'撤销授权',exact:true}).click();
  await expect(page.getByText('已撤销',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.locator('.showroom-content')).toHaveCount(0);
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
