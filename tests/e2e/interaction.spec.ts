import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function enter(page:Page){
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
}
async function state(page:Page){return page.evaluate(async()=>await(await fetch('/v1/state')).json());}
async function notes(page:Page,texts:string[]){
  return page.evaluate(async texts=>{
    const state=await(await fetch('/v1/state')).json();
    const response=await fetch('/v1/entries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({entries:texts.map(text=>({kind:'note',date:state.today,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'},text,confidence:1}))})});
    if(!response.ok)throw new Error(await response.text());return response.json();
  },texts);
}

test('Chinese composition and SSE preserve the live input, selection and draft',async({page})=>{
  await enter(page);const input=page.getByLabel('今天发生了什么？'),original=await input.elementHandle();
  let captures=0;page.on('request',r=>{if(r.url().endsWith('/v1/capture'))captures++;});
  await input.fill('还没有提交的中文输入');await input.focus();
  await input.evaluate(el=>{(el as HTMLInputElement).setSelectionRange(3,6);el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));});
  const before=(await state(page)).revision;
  const refreshed=page.waitForResponse(async response=>response.url().endsWith('/v1/state')&&response.request().method()==='GET'&&(await response.json()).revision>before);
  await notes(page,['验证输入期间的新事件']);
  await refreshed;
  // Give React a paint after the SSE state response, while composition is active.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(input).toBeFocused();
  expect(await input.evaluate(el=>[(el as HTMLInputElement).selectionStart,(el as HTMLInputElement).selectionEnd])).toEqual([3,6]);
  await expect.poll(async()=>(await state(page)).revision).toBeGreaterThan(before);
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await expect(page.getByText('验证输入期间的新事件',{exact:true}).first()).toBeVisible();
  await page.getByRole('link',{name:'今日',exact:true}).click();
  expect(await input.evaluate((el,previous)=>el===previous,original)).toBe(true);
  await expect(input).toHaveValue('还没有提交的中文输入');
  expect(captures).toBe(0);
  await input.focus();await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
});

test('sheets retain the real page, dismiss without writes, and restore focus and browser history',async({page})=>{
  await enter(page);const before=await state(page),trigger=page.getByRole('button',{name:'选择或更换训练模板'}),main=await page.locator('[data-screen="Main"]').elementHandle();
  await trigger.focus();await trigger.press('Enter');
  const dialog=page.getByRole('dialog',{name:'选择训练模板'});await expect(dialog).toBeVisible();
  expect(await page.locator('[data-screen="Main"]').evaluate((el,old)=>el===old,main)).toBe(true);
  await expect(page.locator('[data-screen="Main"]')).toHaveAttribute('inert','');
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();await expect(dialog).toBeVisible();await page.goBack();await expect(dialog).toHaveCount(0);
  await trigger.click();await expect(dialog).toBeVisible();
  const grip=dialog.locator('[data-sheet-handle]');await dialog.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));const box=await grip.boundingBox();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(box!.x+box!.width/2,box!.y+130,{steps:6});await page.mouse.up();
  await expect(dialog).toHaveCount(0);await expect(page.locator('[data-screen="Main"]')).not.toHaveAttribute('inert','');
  expect((await state(page)).revision).toBe(before.revision);
  await expect.poll(()=>page.locator('.sheet-layer').count()).toBe(0);
});

test('a slow write accepts one tap and a lost response retries the exact committed operation',async({page})=>{
  await enter(page);
  const requests:{key:string;body:string}[]=[];
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/v1/program',async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    requests.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()!});
    if(requests.length===1){await gate;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await page.getByRole('button',{name:'选择或更换训练模板'}).click();
  const dialog=page.getByRole('dialog',{name:'选择训练模板'});await dialog.getByRole('button',{name:/上肢 \/ 下肢/}).click();
  const save=dialog.locator('[data-action="program-save"]');await save.click();
  await expect(save).toHaveAttribute('aria-busy','true');await expect(save).toHaveAttribute('aria-disabled','true');
  await save.evaluate(el=>{(el as HTMLElement).click();(el as HTMLElement).click();});expect(requests).toHaveLength(1);release();
  await expect(page.getByRole('status')).toContainText('暂未确认');await expect(dialog).toBeVisible();
  const committedRevision=(await state(page)).revision;
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(dialog).toHaveCount(0);expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  expect((await state(page)).revision).toBe(committedRevision);
});

test('capture keeps text after failure and retries with the original capture clock and key',async({page})=>{
  await enter(page);const seen:{key:string;body:string}[]=[];
  await page.route('**/v1/capture',async route=>{
    seen.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()!});
    if(seen.length===1)await route.abort('failed');else await route.continue();
  });
  const input=page.getByLabel('今天发生了什么？');await input.fill('卧推 121lb 8次');await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('暂未确认');await expect(input).toHaveValue('卧推 121lb 8次');
  await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByRole('status')).toContainText('已记录');
  await expect(input).toHaveValue('');expect(seen).toHaveLength(2);expect(seen[1]).toEqual(seen[0]);
});

test('capture retry sends the failed operation without overwriting a newer draft',async({page})=>{
  await enter(page);const seen:{key:string;body:string}[]=[];
  await page.route('**/v1/capture',async route=>{
    seen.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()!});
    if(seen.length===1)await route.abort('failed');else await route.continue();
  });
  const input=page.getByLabel('今天发生了什么？');await input.fill('卧推 123lb 8次');await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('暂未确认');
  await input.fill('下一条尚未发送');await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已记录');await expect(input).toHaveValue('下一条尚未发送');
  expect(seen).toHaveLength(2);expect(seen[1]).toEqual(seen[0]);
});

test('ledger refresh keeps row identity and scroll, including a round trip to another tab',async({page})=>{
  await enter(page);await notes(page,Array.from({length:28},(_,i)=>`滚动验证 ${i}`));
  await page.getByRole('link',{name:'日志',exact:true}).click();const timeline=page.locator('[data-bind="ledger-timeline"]');
  await expect(timeline).toContainText('滚动验证 27');const first=timeline.locator('[data-entry-id]').first(),id=await first.getAttribute('data-entry-id'),original=await first.elementHandle();
  await timeline.evaluate(el=>{el.scrollTop=240;});const position=await timeline.evaluate(el=>el.scrollTop);expect(position).toBeGreaterThan(0);
  await notes(page,['列表刷新验证']);await expect(timeline).toContainText('列表刷新验证');
  expect(await page.locator(`[data-entry-id="${id}"]`).evaluate((el,old)=>el===old,original)).toBe(true);
  expect(await timeline.evaluate(el=>el.scrollTop)).toBe(position);
  await page.getByRole('link',{name:'体征',exact:true}).click();await page.getByRole('link',{name:'日志',exact:true}).click();
  expect(await timeline.evaluate(el=>el.scrollTop)).toBe(position);
});

test('reduced motion, keyboard focus, compact viewport and copy feedback remain usable',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await enter(page);
  await page.getByRole('button',{name:'选择或更换训练模板'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.setViewportSize({width:390,height:520});const input=page.getByLabel('今天发生了什么？');await input.fill('保留草稿');await input.focus();
  await expect.poll(async()=>{const bounds=await input.boundingBox();return bounds!.y+bounds!.height;}).toBeLessThanOrEqual(520);
  await page.getByRole('link',{name:'接入',exact:true}).click();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));
  await page.locator('[data-action="copy-endpoint"]').click();await expect(page.getByRole('status')).toHaveText('连接地址已复制');
});

test('training motion is interruptible and rapid set taps commit once through a lost response',async({page})=>{
  await page.addInitScript(()=>{
    const animate=Element.prototype.animate;
    const log:{frames:Keyframe[]|PropertyIndexedKeyframes|null;duration:KeyframeAnimationOptions['duration']}[]=[];
    Object.defineProperty(window,'interactionAnimations',{value:log});
    Element.prototype.animate=function(frames,options){log.push({frames,duration:typeof options==='number'?options:options?.duration});return animate.call(this,frames,options);};
  });
  await enter(page);const original=await state(page),weekday=new Date(`${original.today}T12:00:00Z`).getUTCDay();
  await page.evaluate(async({program,weekday})=>{
    const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...program,days:[{id:'motion_day',name:'交互验证',weekday,items:[{exerciseId:'bench_press',sets:3,repMin:5,repMax:8,startLoad:147}]}]})});
    if(!response.ok)throw new Error(await response.text());
  },{program:original.program,weekday});
  await page.reload();await page.locator('[data-action="start-session"]').click();
  const session=page.locator('.screen[data-screen="Session"]');await expect(session).toBeVisible();
  const animations=()=>page.evaluate(()=>Reflect.get(window,'interactionAnimations') as {frames:Keyframe[];duration:number}[]);
  expect((await animations()).some(a=>a.duration===620&&a.frames.some(frame=>'clipPath' in frame))).toBe(true);
  const plus=session.locator('[data-action="reps-plus"]'),control=await plus.elementHandle();
  await plus.click();await plus.evaluate(el=>{for(let i=0;i<4;i++)(el as HTMLElement).click();});
  expect(await plus.evaluate((el,old)=>el===old,control)).toBe(true);
  await expect(page.locator('.motion-outgoing')).toHaveCount(0);
  const attempts:{key:string;body:string}[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/v1/entries',async route=>{
    if(!route.request().postDataJSON().entries.some((entry:{kind:string})=>entry.kind==='set')){await route.continue();return;}
    attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()!});
    if(attempts.length===1){await gate;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  const complete=session.locator('[data-action="complete-set"]');await complete.click();
  await expect(complete).toBeDisabled();await expect(plus).toHaveAttribute('aria-disabled','true');
  await complete.evaluate(el=>{(el as HTMLElement).click();(el as HTMLElement).click();});expect(attempts).toHaveLength(1);release();
  await expect(page.getByRole('status')).toContainText('暂未确认');const committed=await state(page);
  await page.getByRole('button',{name:'重试',exact:true}).click();await expect(complete).toBeEnabled();
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);expect(JSON.parse(attempts[0].body).entries[0].reps).toBe(13);
  expect((await state(page)).revision).toBe(committed.revision);
  await session.locator('[data-action="end-session"]').click();const debrief=page.locator('.screen[data-screen="Debrief"]');const written=JSON.parse(attempts[0].body).entries[0];await expect(debrief).toContainText(`${written.load} ${written.unit} × ${written.reps}`);
  await debrief.getByText('返回今日').click();
  expect((await animations()).some(a=>a.duration===480&&a.frames.some(frame=>'clipPath' in frame))).toBe(true);
  await page.getByRole('link',{name:'体征',exact:true}).click();await expect(page.locator('.motion-outgoing,.sheet-layer')).toHaveCount(0);
  await page.getByRole('link',{name:'今日',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{Reflect.get(window,'interactionAnimations').length=0;});await page.locator('[data-action="start-session"]').click();await expect(session).toBeVisible();
  const reduced=await animations();expect(reduced.some(a=>a.duration===200)).toBe(true);expect(reduced.some(a=>a.frames.some(frame=>'clipPath' in frame||'transform' in frame))).toBe(false);
  await session.locator('[data-action="end-session"]').click();await expect(debrief).toBeVisible();
});
