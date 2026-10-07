import { expect, test } from '@playwright/test';

test('training uses the plan, V5 next set, and a real debrief',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
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
    await expect(session.locator('[data-action="load-input"]')).toHaveValue('185');
    await session.getByRole('radio',{name:'2'}).click();
    await session.getByRole('button',{name:/^记录 .* × /}).click();
    await expect(session).toContainText('沿用上组 185 lb × 5');
    const derived=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    expect(derived.derived['next.romanian_deadlift'].rule).toBe('V5');
    await expect(session.locator('[data-action="load-input"]')).toHaveValue(String(derived.derived['next.romanian_deadlift'].value));
    await session.locator('a[data-action="end-session"]').click();
    const debrief=page.locator('.screen[data-screen="Debrief"]');await expect(debrief).toBeVisible();
    await expect(debrief).toContainText('185 lb × 5');
    await expect(debrief).not.toContainText('训练总结待接入');
  }finally{
    await page.evaluate(async({program})=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},{program:original.program});
  }
});

test('a question captured during training waits for the completion sheet',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  for(const held of original.held){
    await page.evaluate(async id=>{const response=await fetch(`/v1/held/${id}/resolve`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({skip:true})});if(!response.ok)throw new Error(await response.text());},held.id);
  }
  const weekday=new Date(`${original.today}T12:00:00Z`).getUTCDay();
  const program={...original.program,days:[{id:'deferred_day',name:'延后确认训练',weekday,items:[{exerciseId:'bench_press',sets:4,repMin:5,repMax:8,startLoad:null}]}]};
  try{
    await page.evaluate(async value=>{const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});if(!response.ok)throw new Error(await response.text());},program);
    await page.reload();await page.locator('[data-action="start-session"]').click();
    await page.locator('.screen[data-screen="Session"]').waitFor();
    await page.getByRole('link',{name:'今日'}).click();
    const input=page.getByLabel('今天发生了什么？');
    await input.fill('卧推 105lb*5+115lb*8+125lb*7+125lb*5，125那组rir0');await input.press('Enter');
    await expect(page.locator('.screen[data-screen="Main"]')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('已记录');
    const during=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    expect(during.held.some((item:{deferUntilSessionEnd:boolean})=>item.deferUntilSessionEnd)).toBe(true);
    await expect(page.getByRole('dialog',{name:'确认'})).toHaveCount(0);
    await page.locator('[data-action="resume-session"]').click();
    await page.locator('a[data-action="end-session"]').click();
    const debrief=page.locator('.screen[data-screen="Debrief"]');
    await expect(debrief).toContainText('需要确认');
    await debrief.locator('a[href="#Capture"]').click();
    const review=page.getByRole('dialog',{name:'确认'});
    await expect(review).toContainText('RIR');
    await review.locator('[data-held-option]').first().click();
    await expect(debrief).toBeVisible();
    await expect(review).toHaveCount(0);
    expect((await page.evaluate(async()=>await (await fetch('/v1/state')).json())).held).toHaveLength(0);
  }finally{
    await page.evaluate(async value=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});},original.program);
  }
});
