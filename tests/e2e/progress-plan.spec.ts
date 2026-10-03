import { expect, test } from '@playwright/test';

test('progress follows recorded exercises and plan order without changing the plan',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const program={...original.program,days:[{id:'row_day',name:'自己的安排',weekday:3,items:[{exerciseId:'seated_row',sets:3,repMin:8,repMax:12,startLoad:null},{exerciseId:'leg_press',sets:2,repMin:8,repMax:12,startLoad:null}]}]};
  try{
    await page.evaluate(async({program,today,hasWeight})=>{
      const write=async(path:string,value:unknown,method='POST')=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});if(!r.ok)throw new Error(await r.text());return r.json();};
      await write('/v1/program',program,'PUT');
      const source={actor:'user',channel:'ui',client:'web'},base={date:today,dateOrigin:'device',source};
      const entries=[...(hasWeight?[]:[{...base,kind:'weight',kg:68,raw:{value:68,unit:'kg'},condition:'unspecified',confidence:1}]),...[
        {exerciseId:'seated_row',load:30,unit:'kg'},{exerciseId:'leg_press',load:70,unit:'kg'},{exerciseId:'lateral_raise',load:10,unit:'lb'},{exerciseId:'incline_db_press',load:25,unit:'lb'},
      ].map(item=>({...base,...item,kind:'set',sessionId:crypto.randomUUID(),setIndex:1,loadKind:'external',reps:8,rir:2,setRole:'work'}))];
      const out=await write('/v1/entries',{entries});if(out.held?.length)throw new Error('Unexpected held fixtures');
    },{program,today:original.today,hasWeight:original.entries.some((entry:{kind:string})=>entry.kind==='weight')});
    await page.goto('/#Progress');await page.reload();
    const progress=page.locator('.screen[data-screen="Progress"]'),rows=progress.locator('[data-bind="progress-chart"] g[data-exercise-id]');
    await expect(rows.first()).toHaveAttribute('data-exercise-id','seated_row');await expect(rows.nth(1)).toHaveAttribute('data-exercise-id','leg_press');
    const ids=await rows.evaluateAll(rows=>rows.map(row=>row.getAttribute('data-exercise-id')));expect(ids.length).toBeGreaterThanOrEqual(4);expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['lateral_raise','incline_db_press']));
    await expect(progress).not.toContainText('加入计划');await expect(progress).not.toContainText('复制');
    await rows.first().click();await expect(page.getByRole('dialog',{name:'计算方式'})).toBeVisible();await page.keyboard.press('Escape');
    await rows.nth(1).focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'计算方式'})).toBeVisible();await page.keyboard.press('Escape');await expect(rows.nth(1)).toBeFocused();
    for(const width of [375,390,393,402,430,440]){await page.setViewportSize({width,height:844});expect(await progress.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
    expect((await page.evaluate(async()=>await (await fetch('/v1/state')).json())).program).toEqual(program);
    // Without estimates, the entire empty chart (including its ruler) disappears.
    await page.route('**/v1/state',async route=>{const response=await route.fetch(),value=await response.json();value.derived={};await route.fulfill({response,json:value});});
    await page.reload();await expect(progress.locator('[data-bind="progress-chart"]')).toBeHidden();
    await expect(progress).toContainText('记录训练后，在这里回看变化。');
  }finally{
    await page.evaluate(async value=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});},original.program);
  }
});
