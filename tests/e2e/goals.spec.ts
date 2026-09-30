import {test,expect} from '@playwright/test';

test('goals are optional, user-confirmed and editable in the existing sheet',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('[data-action="goal-setup"]').click();const sheet=page.getByRole('dialog',{name:'设置目标'});
  await expect(sheet).not.toContainText('已记录 5 项');
  await sheet.getByRole('button',{name:'减脂',exact:true}).click();
  await sheet.getByLabel('目标体重 kg',{exact:true}).fill('67');await sheet.getByLabel('每周变化下限 kg').fill('-0.5');await sheet.getByLabel('每周变化上限 kg').fill('-0.2');
  await sheet.getByRole('button',{name:'保存目标'}).click();await expect(sheet).toHaveCount(0);
  const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());expect(state.program.targets.goal.mode).toBe('lose');expect(state.program.targets.goal.confirmedAt).toBeTruthy();expect(state.program.targets.rateKgPerWeek).toEqual({min:-.5,max:-.2});expect(state.program.targets.calorieTrigger).toBeNull();
  await page.locator('[data-action="goal-setup"]').click();await page.getByRole('button',{name:'维持',exact:true}).click();
  await page.getByLabel('维持体重下限 kg').fill('66');await page.getByLabel('维持体重上限 kg').fill('68');await page.getByRole('button',{name:'保存目标'}).click();await expect(sheet).toHaveCount(0);
  const maintained=await page.evaluate(async()=>await (await fetch('/v1/state')).json());expect(maintained.program.targets.goal.maintenanceKg).toEqual({min:66,max:68});expect(maintained.derived['bw.projection']).toBeUndefined();
  await page.locator('[data-action="goal-setup"]').click();await page.getByRole('button',{name:'先只记录',exact:true}).click();await page.getByRole('button',{name:'保存目标'}).click();await expect(sheet).toHaveCount(0);
});

test('typed load overrides a recommendation and survives a concurrent state refresh',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const program={...original.program,days:[{id:'override',name:'本组调整',weekday:new Date(`${original.today}T12:00:00Z`).getUTCDay(),items:[{exerciseId:'calf_raise',sets:2,repMin:10,repMax:15,startLoad:40}]}]};
  try{
    await page.evaluate(async program=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},program);
    await page.reload();await page.locator('[data-action="start-session"]').click();
    const input=page.locator('[data-action="load-input"]');await expect(input).toHaveAttribute('placeholder','40');await input.fill('35');
    await page.evaluate(async()=>{await fetch('/v1/preferences/timezone',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({timeZone:'UTC'})});});
    await expect(input).toHaveValue('35');await page.getByRole('button',{name:'完成本组',exact:true}).click();
    await expect(page.locator('[data-screen="Session"]')).toContainText('上一组 35 × 10');
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());const set=state.entries.findLast((e:{kind:string;exerciseId?:string})=>e.kind==='set'&&e.exerciseId==='calf_raise');expect(set.load).toBe(35);expect(set.setRole).toBe('work');expect(set.recommendation.load).toBe(40);
    await expect(input).toHaveValue('');await expect(input).toHaveAttribute('placeholder','35');
    await page.getByRole('button',{name:'完成本组',exact:true}).click();await expect(page.locator('[data-screen="Session"]')).toContainText('第 3 组');
    await page.locator('[data-action="end-session"]').click();
  }finally{await page.evaluate(async program=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},original.program);}
});

test('macro review is readable, later never applies, and the daily slot does not refill',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  const id=await page.evaluate(async()=>{const response=await fetch('/v1/proposals',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({kind:'program_change',title:'调整目标说明',rationale:'由本人审阅后保存。',patch:{targets:{goal:{mode:'record'},bodyweightKg:null,rateKgPerWeek:null,calorieTrigger:null}}})});if(!response.ok)throw new Error(await response.text());return (await response.json()).id as string;});
  await page.locator('[data-action="decision-view"]').filter({hasText:'查看建议'}).click();
  const sheet=page.getByRole('dialog',{name:'查看建议'});await expect(sheet).toContainText('当前：');await expect(sheet).toContainText('采用后：');await expect(sheet).not.toContainText('bodyweightKg');
  await sheet.getByRole('button',{name:'以后',exact:true}).click();await expect(sheet).toHaveCount(0);
  const snapshot=await page.evaluate(async()=>await (await fetch('/v1/state')).json());expect(snapshot.proposals.find((p:{id:string})=>p.id===id).status).toBe('open');expect(snapshot.decisionSlots[snapshot.today].closed).toBe(true);
  await page.reload();await expect(page.locator('[data-screen="Main"]')).toBeVisible();await expect(page.locator('[data-action="decision-view"]')).toHaveCount(0);
  await page.evaluate(async({id,revision})=>{const response=await fetch(`/v1/proposals/${id}/decision`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({decision:'reject',expectedRevision:revision})});if(!response.ok)throw new Error(await response.text());},{id,revision:snapshot.revision});
});
