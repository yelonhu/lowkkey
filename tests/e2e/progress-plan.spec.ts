import { expect, test } from '@playwright/test';

test('progress adds a verified exercise only to the user-selected training day',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const program={...original.program,days:[{id:'row_day',name:'划船日',weekday:3,items:[{exerciseId:'seated_row',sets:3,repMin:8,repMax:12,startLoad:null}]}]};
  try{
    await page.evaluate(async value=>{const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});if(!response.ok)throw new Error(await response.text());},program);
    const input=page.getByLabel('今天发生了什么？');
    const seeds:string[]=[];
    if(!original.entries.some((entry:{kind:string})=>entry.kind==='weight'))seeds.push('体重 60kg');
    if((original.derived['rel.bench_press']?.value??0)<1)seeds.push('卧推 140lb 8次');
    for(const value of seeds){
      await input.fill(value);await input.press('Enter');
      await expect(page.getByRole('status')).toContainText('已记录');
    }
    await page.goto('/#Progress');
    const progress=page.locator('.screen[data-screen="Progress"]');
    await expect(progress.getByRole('button',{name:'加入计划'})).toBeVisible();
    await progress.getByRole('button',{name:'加入计划'}).click();
    const sheet=page.getByRole('dialog',{name:'加入训练计划'});
    await expect(sheet.getByText('确认加入')).toHaveAttribute('aria-disabled','true');
    await sheet.getByRole('button',{name:/划船日/}).click();
    await sheet.getByText('确认加入').click();
    await expect(progress.getByRole('button',{name:'已在计划中'})).toBeDisabled();
    const after=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    expect(after.program.days[0].weekday).toBe(3);
    expect(after.program.days[0].items.map((item:{exerciseId:string})=>item.exerciseId)).toContain('bench_press');
  }finally{
    await page.evaluate(async value=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});},original.program);
  }
});
