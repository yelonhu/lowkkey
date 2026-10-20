import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixturePlans,fixtureSessions} from '../../scripts/rehearsal/fixtures.mjs';

test('quiet motion, reading positions, grouped grants and reduced motion',async({page,baseURL},info)=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.request.post('/api/local/session',{headers:{Origin:baseURL!}});
  const state=await (await page.request.get('/v1/state')).json();
  const today=state.today,stamp=new Date().toISOString();
  await page.route('**/v1/state',r=>r.fulfill({json:{...state,sessions:fixtureSessions.map(s=>({...s,updated_at:stamp})),plans:fixturePlans.map(p=>({...p,updated_at:stamp,coach:p.coach??null}))}}));
  await page.route('**/v1/onboarding',async r=>{const response=await r.fetch();await r.fulfill({json:{...await response.json(),hasContent:true,completedAt:stamp}});});
  const clients=[1,2,3].map(n=>({id:'client-'+n,name:'Claude',source:'https://claude.ai/oauth/client-'+n,scopes:n===2?['read']:['read','write'],status:n===3?'revoked':'active',createdAt:stamp,lastUsedAt:stamp,firstReadAt:stamp,firstWriteAt:null}));
  await page.route('**/v1/clients',r=>r.fulfill({json:clients}));
  await page.route('**/v1/clients/*/revoke',r=>{const id=r.request().url().split('/').at(-2);if(id==='client-2')return r.fulfill({status:503,json:{error:{code:'temporary'}}});clients.find(c=>c.id===id)!.status='revoked';return r.fulfill({json:{ok:true}});});
  await page.goto('/#notes');
  const editor=page.getByRole('textbox',{name:today+' 随手记'});
  await editor.click();await expect(editor).toHaveCSS('outline-style','none');
  await page.getByRole('link',{name:'notes',exact:true}).focus();await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();await expect(page.locator('.note-date h2')).toHaveCSS('text-decoration-line','underline');
  await expect(page.getByRole('group',{name:'主题',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'next',exact:true}).click();
  const later=page.locator('#v-next details').first();await expect(later).toBeVisible();
  // A second click reverses the current animation instead of waiting for it.
  await later.locator('summary').evaluate(el=>{(el as HTMLElement).click();setTimeout(()=>(el as HTMLElement).click(),60);});
  await expect(later).not.toHaveAttribute('open');
  await later.locator('summary').click();await expect(later).toHaveAttribute('open','');
  await expect.poll(()=>later.evaluate(el=>el.getAnimations().length)).toBe(0);
  await page.evaluate(()=>window.scrollTo(0,420));const position=await page.evaluate(()=>scrollY);
  await page.getByRole('link',{name:'recap',exact:true}).click();
  await page.getByRole('link',{name:'next',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(position,0);
  await expect(later).toHaveAttribute('open','');
  await page.getByRole('button',{name:'lowkkey，打开设置'}).click();
  await expect(page.locator('.connection-group')).toHaveCount(1);
  await expect(page.getByText('添加到手机主屏幕',{exact:true})).toHaveCount(0);
  await expect(page.locator('.connection-grants summary')).toHaveText('2 项授权');
  await page.getByRole('button',{name:'断开全部授权（2）'}).click();
  await expect(page.getByRole('status')).toContainText('1 项未完成');
  await expect(page.locator('.connection-grants summary')).toHaveText('1 项授权');
  await page.getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'lowkkey，打开设置'})).toBeFocused();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('link',{name:'log',exact:true}).click();
  await page.locator('#v-log .row').first().click();await expect(page.locator('#v-log .open .detail-reveal')).toHaveCSS('transition-duration','0s');
  await page.emulateMedia({reducedMotion:'no-preference'});
  // Record a real browser timeline plus frame intervals while changing tabs.
  const events:unknown[]=[],cdp=info.project.name==='chromium'?await page.context().newCDPSession(page):null;
  if(cdp){cdp.on('Tracing.dataCollected',data=>events.push(...data.value));await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});}
  const frames=await page.evaluate(async()=>{
    const deltas:number[]=[];let last=performance.now(),i=0;
    await new Promise<void>(resolve=>{const tick=(now:number)=>{deltas.push(now-last);last=now;if(i%20===0)(document.querySelectorAll<HTMLAnchorElement>('.tabs a')[Math.floor(i/20)%4]).click();if(++i<120)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});return deltas.slice(1);
  });
  if(cdp){const done=new Promise<void>(resolve=>cdp.once('Tracing.tracingComplete',()=>resolve()));await cdp.send('Tracing.end');await done;await cdp.detach();}
  await mkdir('.artifacts/motion',{recursive:true});
  await writeFile(`.artifacts/motion/${info.project.name}.json`,JSON.stringify({frames,events},null,2));
  // At rest only the brand's infinite heartbeat may run; every finite motion has settled.
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).length)).toBe(0);
});
