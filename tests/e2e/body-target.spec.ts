import { expect, test } from '@playwright/test';

test('the body chart uses the account target and clears source-example labels',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const original=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  try{
    if(!original.entries.some((entry:{kind:string})=>entry.kind==='weight')){
      const input=page.getByLabel('今天发生了什么？');await input.fill('体重 62.3kg');await input.press('Enter');await expect(page.getByRole('status')).toContainText('已记录');
    }
    const program={...original.program,targets:{...original.program.targets,bodyweightKg:77.7}};
    await page.evaluate(async value=>{const response=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});if(!response.ok)throw new Error(await response.text());},program);
    await page.goto('/#Body');
    const chart=page.locator('.screen[data-screen="Body"] svg[role="img"]');
    await expect(chart.locator('[data-bind="body-goal-label"]')).toHaveText('目标 77.7 kg');
    await expect(chart).not.toContainText('目标 75 kg');
    await expect(chart.locator('[data-bind="body-goal-grid"]')).toHaveAttribute('visibility','visible');
  }finally{
    await page.evaluate(async value=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});},original.program);
  }
});
