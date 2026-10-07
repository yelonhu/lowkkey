import {expect,test} from '@playwright/test';

// Synthetic visualViewport events exercise our layout, not the iOS keyboard itself.
test('training remains reachable in a keyboard-sized viewport and restores its draft',async({page},info)=>{
  await page.addInitScript(()=>Object.defineProperty(window,'visualViewport',{configurable:true,value:Object.assign(new EventTarget(),{height:852,offsetTop:0,scale:1})}));
  await page.setViewportSize({width:393,height:852});
  await page.goto('/');await page.locator('.screen,.access-gate button').first().waitFor();
  const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  try{
    await page.evaluate(async original=>{
      const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...original.program,days:[{id:'keyboard_day',name:'键盘回归',weekday:new Date(`${original.today}T12:00:00Z`).getUTCDay(),items:[{exerciseId:'bench_press',sets:2,repMin:5,repMax:8,startLoad:125}]}]})});
      if(!response.ok)throw new Error(await response.text());
    },original);
    await page.reload();await page.addStyleTag({content:':root{--safe-top:59px;--safe-bottom:34px}'});
    await page.locator('[data-action="start-session"]').click();
    const board=page.locator('[data-screen="Session"]'),input=board.locator('[data-action="load-input"]');
    await input.fill('-1');await expect(board.getByRole('button',{name:'请填写 0–1000 的有效重量'})).toBeDisabled();
    await input.fill('');await input.pressSequentially('-');await expect(board.getByRole('button',{name:'请填写 0–1000 的有效重量'})).toBeDisabled();
    await input.fill('127.25');await input.focus();
    expect(await input.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const scrollBefore=await board.locator('[data-scroll-region]').evaluate(el=>el.scrollTop);
    for(const offsetTop of [0,24,70,0]){
      await page.evaluate(offsetTop=>{Object.assign(window.visualViewport!,{height:420,offsetTop});window.visualViewport!.dispatchEvent(new Event('resize'));window.visualViewport!.dispatchEvent(new Event('scroll'));},offsetTop);
      await expect(page.locator('.prototype-shell')).toHaveAttribute('data-keyboard','true');
      await expect.poll(()=>page.locator('.prototype-shell').evaluate(el=>el.getBoundingClientRect().top)).toBe(0);
      await expect.poll(()=>board.locator('[data-page-frame]').evaluate(el=>el.getBoundingClientRect().top)).toBe(offsetTop);
      expect(await page.evaluate(()=>window.scrollY)).toBe(0);
      await expect(input).toHaveValue('127.25');
    }
    const reps=await board.getByRole('spinbutton',{name:'本组次数'}).inputValue();
    const save=board.getByRole('button',{name:`记录 127.25 lb × ${reps}`});
    await expect.poll(async()=>{const box=await save.boundingBox();return box!.y+box!.height;}).toBeLessThanOrEqual(420);
    await input.blur();await page.evaluate(()=>{Object.assign(window.visualViewport!,{height:852,offsetTop:0});window.visualViewport!.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('pageshow'));});
    await expect(page.locator('.prototype-shell')).toHaveAttribute('data-keyboard','false');
    await expect.poll(()=>board.locator('[data-scroll-region]').evaluate(el=>el.scrollTop)).toBe(scrollBefore);
    await expect(input).toHaveValue('127.25');
    const header=board.locator(':scope > div > div').first();
    await expect(header.getByRole('link',{name:'今日',exact:true})).toBeInViewport();
    await expect(header.getByRole('button',{name:'动作清单'})).toBeInViewport();
    await expect.poll(()=>header.evaluate(el=>el.getBoundingClientRect().top)).toBe(59);
    await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    await board.screenshot({animations:'disabled',path:`.artifacts/playwright/${info.project.name}/iphone-training.png`});
    await save.click();await expect(board).toContainText(`上一组 127.25 × ${reps} lb`);
    await expect(board.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');
    await board.locator('a[data-action="end-session"]').click();
  }finally{
    await page.evaluate(async program=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},original.program);
  }
});
