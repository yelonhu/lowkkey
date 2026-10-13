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

test('empty → eight tools → five pages, all themes, narrow layout, refresh and settings', async ({page,baseURL},testInfo) => {
  test.setTimeout(150000);
  const errors:string[] = []; page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.goto('/');
  await page.getByRole('button',{name:'打开我的展厅',exact:true}).click();
  await expect(page.getByRole('heading',{name:'你习惯和谁聊？'})).toBeVisible();
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/onboarding-${width}.png`});
  }
  await page.getByRole('button',{name:'ChatGPT',exact:true}).click();
  await expect(page.getByRole('button',{name:'复制地址并打开 ChatGPT'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'复制地址并打开 ChatGPT'})).toBeVisible();
  await page.getByRole('button',{name:'稍后连接',exact:true}).click();
  await expect(page.getByText('还没有训练安排。和你的 AI 聊好之后，会出现在这里。')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(5);
  await page.getByRole('link',{name:'log',exact:true}).click();
  await expect(page.getByText('还没有训练记录。')).toBeVisible();
  await page.getByRole('link',{name:'body',exact:true}).click();
  await expect(page.getByText('还没有体重记录。')).toBeVisible();
  const tool = await connect(page.request,baseURL!);
  await seedShowroom(tool);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/#next\?title=/);
  await page.goto('/#start');
  await expect(page.getByRole('heading',{name:'接下来，和你的 AI 聊聊。'})).toBeVisible();
  await page.getByRole('button',{name:'返回上一步'}).click();
  await expect(page.getByRole('button',{name:'Claude',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'稍后连接',exact:true}).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.goto('/#body');
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
          await page.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/${screen}-${theme}-${colorScheme}-${width}.png`});
        }
      }
    }
  }
  await expect(page.locator('.ses')).toHaveCount(9);
  await page.locator('.lifts .row').first().click();
  await expect(page.locator('.lifts .open .detail')).toContainText('借力 2');
  await expect(page.locator('.lifts .open .detail')).toContainText('没做完整');
  const note = '<script>literal, never executed</script>\n'+ '保留原话与换行。'.repeat(12);
  await tool('log_session',{...fixtureSessions.at(-1),title:'AReallyLongUnbrokenTrainingDayTitle',note});
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
  await expect(page.locator('main')).toHaveAttribute('id','v-recap');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('.lift[data-ex="back_squat"]').click();
  await expect(page.locator('.lift[data-ex="back_squat"]')).toHaveAttribute('aria-pressed','true');
  const chart=page.locator('.chartbox[tabindex]').first();
  if(testInfo.project.name==='webkit')await chart.tap();else await chart.click();
  await expect(chart).toHaveCSS('outline-style','none');
  await expect(chart.locator('svg')).toHaveCSS('outline-style','none');
  await chart.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tip.on')).toBeVisible();
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await expect(chart).toBeFocused();
  await expect(chart).toHaveCSS('outline-style','solid');
  // Deleting referenced data hides the pick instead of rendering stale readings.
  await tool('delete',{kind:'session',date:fixtureToday});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.pick')).toHaveCount(0);
  await tool('curate',{week:fixtureWeek,recap:{picks:null},theme:null});
  await page.route('**/api/auth/config',async route=>{
    const response=await route.fetch();
    await route.fulfill({json:{...await response.json(),aiConnection:true}});
  });
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
  for(const [width,height] of [[390,844],[320,568]]){
    await page.setViewportSize({width,height});
    const card=await page.getByRole('dialog').boundingBox();
    expect(card!.y).toBeGreaterThanOrEqual(40);
    expect(card!.y+card!.height).toBeLessThanOrEqual(height-40);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/settings-${width}.png`});
  }
  await page.getByText('连接新的 AI',{exact:true}).click();
  await expect(page.getByRole('button',{name:'复制连接地址'})).toBeVisible();
  await page.getByRole('button',{name:'退出登录',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'完成',exact:true})).toBeInViewport();
  await page.getByText('连接新的 AI',{exact:true}).click();
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
  const authRequests:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(privacy\/intent|auth\/sign-in)/.test(request.url()))authRequests.push(new URL(request.url()).pathname);});
  await page.route('**/api/auth/sign-in/social',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{url:'/#Login'}});});
  await page.goto('/#Gallery?date=2026-10-08');
  await expect(page.getByRole('button',{name:'使用 Google 继续'})).toBeVisible();
  await expect(page.locator('input[type=email]')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(authRequests).toEqual([]);
  await page.getByRole('button',{name:'使用 Google 继续'}).press('Enter');
  await expect.poll(()=>body?.callbackURL).toBe('/#Gallery?date=2026-10-08');
  expect(authRequests).toEqual(['/api/privacy/intent','/api/auth/sign-in/social']);
  await expect(page).toHaveURL(/\/#Login$/);
  await page.goto('/?returnTo='+encodeURIComponent('/authorize?client_id=test')+'#Login');
  await page.getByRole('button',{name:'使用 Google 继续'}).click();
  await expect.poll(()=>body?.callbackURL).toBe('/authorize?client_id=test');
});

test('welcome, public privacy and consent recovery preserve the authorization destination',async({page},testInfo)=>{
  test.setTimeout(90000); // Includes 18 theme/viewport screenshots before the auth assertions.
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.route('**/api/auth/config',route=>route.fulfill({json:{mode:'customer',google:true,email:false}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/每一次训练，\s*都有下文。/})).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const login=page.getByRole('button',{name:'使用 Google 继续'});
  await expect(login).toBeInViewport({ratio:1});
  await expect(page.getByText('继续即代表同意《隐私政策》')).toBeInViewport({ratio:1});
  for(const colorScheme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme});
    for(const theme of ['ink','gold','pearl']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      for(const width of [320,390,1280]){
        await page.setViewportSize({width,height:844});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/welcome-${theme}-${colorScheme}-${width}.png`});
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'light'});
  await page.evaluate(()=>{
    document.documentElement.dataset.theme='ink';
    const sizes=[...document.querySelectorAll<HTMLElement>('.journey *')].map(element=>({element,size:parseFloat(getComputedStyle(element).fontSize)}));
    for(const {element,size} of sizes)element.style.fontSize=(size*2)+'px';
  });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({animations:'disabled',fullPage:true,path:`.artifacts/playwright/${testInfo.project.name}/welcome-large-text.png`});
  await page.reload();
  await expect(page.getByRole('button',{name:'使用邮箱',exact:true})).toHaveCount(0);
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'《隐私政策》'}).click();const policy=await popupPromise;
  await expect(policy.getByRole('heading',{name:'你的档案，由你掌握。'})).toBeVisible();
  await policy.close();await page.bringToFront();
  await expect(login).toBeVisible();
  await page.route('**/v1/state',route=>route.fulfill({status:403,json:{error:{code:'privacy_required'}}}));
  await page.route('**/v1/account',route=>route.fulfill({json:{accountId:'consent-owner',email:'invited@example.com',mode:'customer',timezone:'America/Chicago',timezoneInitialized:true,providers:['google'],fresh:true,privacy:{version:'2026-10-12-notes',acceptedAt:null}}}));
  let accepted=false;
  await page.route('**/v1/account/consent',route=>{expect(route.request().headers()['x-lowkkey-account']).toBe('consent-owner');expect(route.request().postDataJSON()).toEqual({version:'2026-10-12-notes',accepted:true});accepted=true;return route.fulfill({json:{version:'2026-10-12-notes',acceptedAt:new Date().toISOString()}});});
  await page.route('**/authorize?client_id=test',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><h1>继续原授权</h1>'}));
  await page.goto('/?returnTo='+encodeURIComponent('/authorize?client_id=test')+'#consent');
  await expect(page.getByRole('button',{name:'同意并继续'})).toBeDisabled();
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'同意并继续'}).click();
  await expect(page.getByRole('heading',{name:'继续原授权'})).toBeVisible();expect(accepted).toBe(true);
});

test('connection guidance recovers clipboard failure and hands off only after a real authorization event',async({page},testInfo)=>{
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  let setup={ai:null as string|null,entry:null,skippedAt:null,completedAt:null,firstViewUrl:null,hasContent:false,step:'choose',connectionStartedAt:null as string|null,clients:[] as unknown[]};
  await page.route('**/v1/onboarding',route=>{if(route.request().method()==='POST'){const input=route.request().postDataJSON();setup={...setup,...input,...(input.ai?{connectionStartedAt:new Date().toISOString()}: {})};}return route.fulfill({json:setup});});
  await page.goto('/');await page.getByRole('button',{name:'打开我的展厅',exact:true}).click();await page.goto('/#start');
  await page.getByRole('button',{name:'Claude',exact:true}).click();
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/guide-${width}.png`});
  }
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}});window.open=()=>null;});
  await page.getByRole('button',{name:'复制地址并打开 Claude',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('复制没有完成');
  await expect(page.locator('.copy-fallback code')).toBeVisible();
  await expect(page.getByRole('heading',{name:'接下来，和你的 AI 聊聊。'})).toHaveCount(0);
  setup.clients=[{id:'actual-client',name:'Actual Claude client',scopes:['read','write'],status:'active',createdAt:new Date().toISOString(),lastUsedAt:null,firstReadAt:null,firstWriteAt:null}];
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading',{name:'接下来，和你的 AI 聊聊。'})).toBeVisible();
  await expect(page.getByText('已授权：Actual Claude client')).toBeVisible();
  await page.getByRole('textbox',{name:'你的第一句话'}).fill('我有一些旧记录，帮我接着整理。');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.resolve()}}));
  await page.getByRole('button',{name:'复制开场白并打开 Claude'}).click();
  await expect(page.getByRole('status')).toContainText('已复制');
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/handoff-${width}.png`});
  }
  await page.reload();await expect(page.getByRole('heading',{name:'接下来，和你的 AI 聊聊。'})).toBeVisible();
});


test('initial session check stays neutral, recovers network failure, and preview cannot authenticate',async({page})=>{
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  let release:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{release=resolve;});
  let fail=true;
  await page.route('**/v1/state',async route=>{await pending;if(fail)await route.abort();else await route.fulfill({status:401,json:{error:{code:'unauthorized'}}});});
  await page.route('**/api/auth/config',route=>route.fulfill({json:{mode:'customer',google:true,email:false}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('status')).toHaveText('正在打开 lowkkey…');
  await expect(page.getByRole('button',{name:'使用 Google 继续'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'你习惯和谁聊？'})).toHaveCount(0);
  release();
  await expect(page.getByRole('status')).toHaveText('暂时无法打开，请重试。');
  fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.getByRole('button',{name:'使用 Google 继续'})).toBeVisible();
  let privateRequests=0;
  await page.route('**/v1/**',route=>{privateRequests++;return route.abort();});
  await page.route('**/api/**',route=>{privateRequests++;return route.abort();});
  await page.goto('/__preview/login');
  await expect(page.getByText('设计预览',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'使用 Google 继续'}).click();
  await expect(page.getByRole('alert')).toContainText('不会发起 Google 登录或创建账户');
  expect(privateRequests).toBe(0);
});
