import {expect,test} from '@playwright/test';

test('actual load persists; arrangement is explicit; controls fit without scrolling',async({page},info)=>{
  await page.setViewportSize({width:393,height:852});await page.goto('/');
  await page.locator('.screen,.access-gate button').first().waitFor();const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  const before=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const restore=async()=>page.evaluate(async program=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},before.program);
  try{
    await page.evaluate(async state=>{
      const r=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...state.program,days:[{id:'actual_first',name:'上肢 A',weekday:new Date(`${state.today}T12:00:00Z`).getUTCDay(),items:[{exerciseId:'back_squat',sets:4,repMin:6,repMax:8,startLoad:175}]}]})});if(!r.ok)throw new Error(await r.text());
    },before);
    await page.reload();await page.addStyleTag({content:':root{--safe-top:59px;--safe-bottom:34px}'});await page.locator('[data-action="start-session"]').click();
    const board=page.locator('[data-screen="Session"]'),weight=board.locator('[data-action="load-input"]'),reps=board.getByRole('spinbutton',{name:'本组次数'}),rir=board.getByRole('radio',{name:'2'});
    await weight.fill('165');await reps.fill('8');await rir.click();await expect(rir).toHaveAttribute('aria-checked','true');await rir.click();await expect(rir).toHaveAttribute('aria-checked','false');await rir.click();
    const submit=board.getByRole('button',{name:'记录 165 lb × 8'});
    await submit.click();await expect(weight).toHaveValue('165');await expect(rir).toHaveAttribute('aria-checked','false');
    await expect(board.locator('[data-session-weight]')).toHaveAttribute('data-load-edited','false');
    await expect(weight).toHaveCSS('color','rgb(168, 168, 172)');
    await expect(board.getByRole('button',{name:'重量来源与组别'})).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(board).not.toContainText('点按修改');await expect(board).not.toContainText('沿用上组');
    await expect(board.getByRole('button',{name:'杠铃与配片设置'})).toHaveText('每侧 45 + 10 + 5 lb ›');
    await weight.click();await expect(weight).toHaveCSS('outline-style','none');
    await expect(weight).toHaveCSS('color','rgb(168, 168, 172)');
    await weight.press('Enter');await expect(weight).not.toBeFocused();
    await board.getByRole('button',{name:'重量单位 lb，点按切换'}).focus();await page.keyboard.press('Shift+Tab');await expect(weight).toBeFocused();
    await expect(weight).toHaveCSS('outline-width','2px');
    await expect(board.locator('[data-session-weight]')).toHaveCSS('outline-style','none');
    await weight.blur();
    await board.getByRole('button',{name:'重量来源与组别'}).click();
    const detail=page.getByRole('dialog',{name:'本组详情'});await expect(detail).toContainText('本场上一组');await expect(detail).toContainText('165 lb × 8');
    await detail.getByRole('button',{name:'完成',exact:true}).click();
    await expect(board.getByRole('button',{name:'安排 175 lb · 采用'})).toBeVisible();
    await expect(board.locator('[data-session-part="progress"],[data-session-part="caption"]')).toHaveCount(0);
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    expect(state.derived['next.back_squat']).toMatchObject({value:165,ruleVersion:'2.0.0',trainingReference:{source:'session',load:165,arrangement:{load:175,unit:'lb'}}});
    for(const [width,height] of [[375,667],[390,844],[393,852],[402,874],[430,932],[440,956],[852,393]]){
      await page.setViewportSize({width,height});await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
      await expect.poll(()=>submit.evaluate((el,height)=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=height-34&&[r.top+2,r.bottom-2].every(y=>el.contains(document.elementFromPoint(r.left+r.width/2,y)));},height)).toBe(true);
      if(height>=800){
        const svg=await board.locator('svg[role="img"]').boundingBox(),field=await weight.boundingBox();expect(svg!.y+svg!.height).toBeLessThan(field!.y);
        await expect(rir).toBeInViewport({ratio:1});
      }
    }
    await page.setViewportSize({width:393,height:852});
    await board.screenshot({animations:'disabled',path:`.artifacts/playwright/${info.project.name}/training-actual-reference.png`});
    await board.getByRole('button',{name:'安排 175 lb · 采用'}).click();await expect(weight).toHaveValue('175');await expect(weight).toHaveCSS('color','rgb(242, 242, 240)');
    await expect(board.getByRole('button',{name:'记录 175 lb × 8'})).toBeVisible();
    await weight.fill('165.5');await expect(weight).toHaveCSS('color','rgb(242, 242, 240)');await expect(board.getByRole('button',{name:'记录 165.5 lb × 8'})).toBeVisible();
    await board.getByRole('button',{name:'重量单位 lb，点按切换'}).click();await expect(weight).toHaveValue('165.5');await expect(board.getByRole('button',{name:'记录 165.5 kg × 8'})).toBeVisible();
    await weight.fill('165');
    const large=await page.addStyleTag({content:'[data-session-part="title"]{font-size:30px!important;line-height:1.4!important}[data-session-part="submit"]{font-size:30px!important}[data-session-part="rir"] button{font-size:24px!important}'});
    await board.locator('[data-session-part="title"]').evaluate(el=>{el.textContent='用户确认的长动作名称：杠铃深蹲（暂停两秒） ›';});
    const enlarged=board.locator('[data-session-part="submit"]');
    await expect.poll(()=>enlarged.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=818&&r.top>=0&&el.scrollHeight<=el.clientHeight+1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.bottom-2));})).toBe(true);
    expect(await board.locator('[data-session-part="header"]').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
    await large.evaluate(el=>el.parentNode?.removeChild(el));
    await board.locator('a[data-action="end-session"]').click();
  }finally{await restore();}
});
