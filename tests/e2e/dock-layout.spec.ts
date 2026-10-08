import {expect,test,type Locator} from '@playwright/test';

async function fullyVisible(control:Locator,bottom:number){
  await expect.poll(()=>control.evaluate((el,bottom)=>{
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>=44&&r.top>=0&&r.bottom<=bottom+.5&&
      [r.top+2,r.bottom-2].every(y=>el.contains(document.elementFromPoint(r.left+r.width/2,y)));
  },bottom)).toBe(true);
}

test('cold launch ignores stale visual height; both docks stay complete above the safe area',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'visualViewport',{configurable:true,value:Object.assign(new EventTarget(),{height:690,offsetTop:0,scale:1})}));
  await page.setViewportSize({width:393,height:852});await page.goto('/');
  await page.locator('.screen,.access-gate button').first().waitFor();const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await page.addStyleTag({content:':root{--safe-top:59px;--safe-bottom:34px}'});
  for(const [width,height] of [[375,812],[390,844],[393,852],[402,874],[430,932],[440,956],[852,393]]){
    await page.setViewportSize({width,height});
    for(const screen of ['Main','Session','Main']){
      await page.evaluate(screen=>{location.hash=screen;},screen);
      const board=page.locator(`.screen[data-screen="${screen}"]:not(.motion-outgoing)`);await expect(board).toBeVisible();
      await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
      await expect.poll(()=>page.locator('.prototype-shell').evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
      const dock=board.locator('[data-bottom-dock]'),bottomControl=screen==='Main'?dock.locator('[data-action="capture-or-voice"]'):dock.locator(':scope > button:last-child');
      await fullyVisible(bottomControl,height-34);
      if(screen==='Main')await expect.poll(()=>dock.locator(':scope > :last-child').evaluate(el=>el.getBoundingClientRect().bottom)).toBe(height-34-12);
      await expect.poll(()=>board.locator('[data-page-frame]').evaluate(el=>el.firstElementChild!.getBoundingClientRect().top)).toBe(59);
      await expect.poll(()=>dock.evaluate(el=>el.getBoundingClientRect().bottom)).toBe(height-34);
      if(screen==='Main')await fullyVisible(dock.locator('[data-training-action]'),height-34);
      expect(await page.evaluate(()=>window.scrollY)).toBe(0);
    }
  }
  await page.setViewportSize({width:393,height:852});
  const input=page.getByLabel('今天发生了什么？');await input.fill('键盘不会改变外壳');await input.focus();
  await page.evaluate(()=>{Object.assign(window.visualViewport!,{height:400,offsetTop:24});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect(page.locator('.prototype-shell')).toHaveAttribute('data-keyboard','true');
  await expect(page.locator('[data-training-action]')).toBeHidden();
  await fullyVisible(page.locator('[data-action="capture-or-voice"]'),424);
  await expect.poll(()=>page.locator('.prototype-shell').evaluate(el=>el.getBoundingClientRect().height)).toBe(852);
  await input.blur();await page.evaluate(()=>{window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect(page.locator('[data-training-action]')).toBeVisible();await expect(input).toHaveValue('键盘不会改变外壳');
  await expect.poll(()=>page.locator('[data-bottom-dock]').evaluate(el=>el.getBoundingClientRect().bottom)).toBe(818);
});
