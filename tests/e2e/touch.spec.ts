import { expect, test } from '@playwright/test';

// Gesture assertions complement (rather than substitute for) real iPhone QA.
test('phone shells stay fixed while only designated content scrolls',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  for(const size of [{width:390,height:520},{width:844,height:390}]){
    await page.setViewportSize(size);
    for(const screen of ['Main','Body','Progress','Ledger','Connect','Session','Debrief']){
      await page.goto(`/#${screen}`);const board=page.locator(`.screen[data-screen="${screen}"]`);await expect(board).toBeVisible();
      await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
      const result=await board.evaluate(board=>{
        const region=board.querySelector<HTMLElement>('[data-scroll-region]')!,header=board.firstElementChild!.firstElementChild!;
        const top=header.getBoundingClientRect().top;
        region.scrollTop=100;window.scrollTo(0,200);
        return {page:window.scrollY,headerMoved:header.getBoundingClientRect().top-top,region:region.scrollTop,overflow:region.scrollHeight-region.clientHeight,
          nested:[...region.parentElement!.querySelectorAll<HTMLElement>('*')].filter(el=>el!==region&&!region.contains(el)&&el.scrollHeight>el.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(el).overflowY)).length};
      });
      expect(result.page,screen).toBe(0);expect(result.headerMoved,screen).toBe(0);expect(result.nested,screen).toBe(0);
      if(result.overflow>1)expect(result.region,screen).toBeGreaterThan(0);
      const bounds=await board.boundingBox();expect(bounds!.height).toBeCloseTo(size.height,0);
    }
  }
});

test('press feedback follows one control and cancels when the finger starts moving',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  const trigger=page.getByRole('button',{name:'查看完整训练计划'}),box=await trigger.boundingBox();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();
  await expect(page.locator('[data-pressed]')).toHaveCount(1);
  await expect.poll(()=>trigger.evaluate(el=>getComputedStyle(el).scale)).toBe('0.97');
  await page.mouse.move(box!.x+box!.width/2+25,box!.y+box!.height/2);await expect(page.locator('[data-pressed]')).toHaveCount(0);
  await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();
  await expect.poll(()=>trigger.evaluate(el=>getComputedStyle(el).scale)).toBe('1');
  expect(await trigger.evaluate(el=>getComputedStyle(el).opacity)).toBe('0.7');
  await trigger.dispatchEvent('pointercancel',{pointerId:1});await expect(page.locator('[data-pressed]')).toHaveCount(0);await page.mouse.up();
});

test('noneditable text cannot be selected while capture preserves native text editing',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  const input=page.getByLabel('今天发生了什么？');await input.fill('保留系统文字编辑');await input.focus();
  await input.evaluate(el=>(el as HTMLInputElement).setSelectionRange(1,4));
  expect(await input.evaluate(el=>({select:getComputedStyle(el).userSelect,start:(el as HTMLInputElement).selectionStart,end:(el as HTMLInputElement).selectionEnd}))).toEqual({select:'text',start:1,end:4});
  expect(await page.locator('[data-screen="Main"] h1').evaluate(el=>getComputedStyle(el).userSelect)).toBe('none');

});

test('sheet dismissal continues from the drag position and reopening survives old completion callbacks',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  const trigger=page.getByRole('button',{name:'查看完整训练计划'});await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await dialog.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));const handle=await dialog.elementHandle();
  const grip=await dialog.locator('[data-sheet-handle]').boundingBox();
  await page.mouse.move(grip!.x+grip!.width/2,grip!.y+grip!.height/2);await page.mouse.down();
  await page.mouse.move(grip!.x+grip!.width/2,grip!.y+grip!.height/2+110,{steps:5});
  await expect.poll(()=>dialog.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeCloseTo(110,0);
  await page.mouse.up();
  await expect.poll(()=>handle!.evaluate(el=>{const a=el.getAnimations()[0];return a?(a.effect as KeyframeEffect).getKeyframes()[0].transform:null;})).toBe('matrix(1, 0, 0, 1, 0, 110)');
  await trigger.click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.sheet-layer')).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(page.locator('.sheet-layer')).toHaveCount(0);
});

test('visual viewport keyboard changes restore the fixed shell and safe areas are counted once',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'visualViewport',{configurable:true,value:Object.assign(new EventTarget(),{height:844,offsetTop:0,scale:1})}));
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  const input=page.getByLabel('今天发生了什么？');await input.fill('键盘草稿');await input.focus();
  await page.evaluate(()=>{Object.assign(window.visualViewport!,{height:500,offsetTop:10});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect(page.locator('.prototype-shell')).toHaveAttribute('data-keyboard','true');
  await expect.poll(async()=>{const box=await input.boundingBox();return box!.y+box!.height;}).toBeLessThanOrEqual(510);
  await input.blur();await page.evaluate(()=>{Object.assign(window.visualViewport!,{height:844,offsetTop:0});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect(page.locator('.prototype-shell')).toHaveAttribute('data-keyboard','false');await expect(input).toHaveValue('键盘草稿');
  await expect.poll(()=>page.locator('.prototype-shell').evaluate(el=>el.getBoundingClientRect().top)).toBe(0);
  await page.goto('/#Session');await page.locator('[data-screen="Session"]').waitFor();
  await page.addStyleTag({content:':root{--safe-top:47px;--safe-bottom:34px}'});
  await expect.poll(()=>page.locator('[data-screen="Session"]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,pageHeight:el.getBoundingClientRect().height,innerHeight:el.firstElementChild!.getBoundingClientRect().height,top:el.firstElementChild!.getBoundingClientRect().top}))).toEqual({background:'rgb(0, 0, 0)',pageHeight:844,innerHeight:763,top:47});
});


test('phone artboards use the viewport width and sheet depth restores after dismissal',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  for(const width of [375,390,393,402,430,440]){
    await page.setViewportSize({width,height:844});
    const board=page.locator('[data-screen="Main"]');
    await expect.poll(async()=>(await board.boundingBox())!.width).toBe(width);
    expect(await board.evaluate(el=>getComputedStyle(el.querySelector('h1')!).fontSize)).toBe('27px');
  }
  await page.getByRole('button',{name:'查看完整训练计划'}).click();
  await expect.poll(()=>page.locator('[data-screen="Main"]').evaluate(el=>getComputedStyle(el).scale)).toBe('0.96');
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.locator('[data-screen="Main"]').evaluate(el=>getComputedStyle(el).scale)).toBe('1');
});
