import { expect, test } from '@playwright/test';

test('training uses the plan, V5 next set, and a real debrief',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const original=await page.evaluate(async()=>{const response=await fetch('/v1/state');if(!response.ok)throw new Error(String(response.status));return response.json();});
  const weekday=new Date(`${original.today}T12:00:00Z`).getUTCDay();
  const program={...original.program,days:[{id:'test_day',name:'今日训练',weekday,items:[{exerciseId:'romanian_deadlift',sets:2,repMin:5,repMax:8,startLoad:185}]}]};
  try{
    await page.evaluate(async({program})=>{const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});if(!response.ok)throw new Error(await response.text());},{program});
    await page.reload();
    await page.locator('.screen[data-screen="Main"]').waitFor();
    await page.locator('[data-action="start-session"]').click();
    const session=page.locator('.screen[data-screen="Session"]');await expect(session).toBeVisible();
    await expect(session).toContainText('185');
    await session.getByRole('radio',{name:'2'}).click();
    await session.getByRole('button',{name:'完成本组'}).click();
    await expect(session).toContainText('上一组 185 × 8');
    const derived=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    expect(derived.derived['next.romanian_deadlift'].rule).toBe('V5');
    await expect(session).toContainText(String(derived.derived['next.romanian_deadlift'].value));
    await session.locator('[data-action="end-session"]').click();
    const debrief=page.locator('.screen[data-screen="Debrief"]');await expect(debrief).toBeVisible();
    await expect(debrief).toContainText('185 lb × 8');
    await expect(debrief).not.toContainText('训练总结待接入');
  }finally{
    await page.evaluate(async({program})=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},{program:original.program});
  }
});
