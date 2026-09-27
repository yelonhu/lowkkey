import { expect, test } from '@playwright/test';

test('first-load unit confirmation preserves the raw unit and converts the next-set rule',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const weekday=new Date(`${original.today}T12:00:00Z`).getUTCDay();
  const program={...original.program,days:[{id:'unit_day',name:'单位确认日',weekday,items:[{exerciseId:'hack_squat',sets:2,repMin:8,repMax:12,startLoad:null}]}]};
  try{
    await page.evaluate(async value=>{const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});if(!response.ok)throw new Error(await response.text());},program);
    await page.reload();await page.locator('[data-action="start-session"]').click();
    const session=page.locator('.screen[data-screen="Session"]');
    await expect(session.getByRole('spinbutton',{name:'首次重量'})).toBeVisible();
    await session.getByRole('spinbutton',{name:'首次重量'}).fill('90');
    await session.getByRole('button',{name:'确认重量单位 kg'}).click();
    await session.getByRole('button',{name:'重量单位已确认 kg，点按切换'}).click();
    await expect(session.getByRole('button',{name:'重量单位已确认 lb，点按切换'})).toBeVisible();
    await session.getByRole('radio',{name:'2'}).click();
    await session.getByRole('button',{name:'完成本组'}).click();
    await expect(session).toContainText('上一组 90 × 8 lb');
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    const set=state.entries.findLast((entry:{kind:string;exerciseId?:string})=>entry.kind==='set'&&entry.exerciseId==='hack_squat');
    expect(set.load).toBe(90);expect(set.unit).toBe('lb');
    expect(state.derived['next.hack_squat'].unit).toBe('kg');
    expect(state.derived['next.hack_squat'].formula).toContain('90 lb →');
    await session.locator('[data-action="end-session"]').click();
  }finally{
    await page.evaluate(async value=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});},original.program);
  }
});
