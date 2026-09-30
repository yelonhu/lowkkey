import { expect, test } from '@playwright/test';

test('a new account chooses a template, starts an unscheduled day, and records its first set',async({page})=>{
  await page.goto('/');
  const login=page.getByRole('button',{name:'进入状态舱'});
  await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  const main=page.locator('.screen[data-screen="Main"]');
  await expect(main).toBeVisible();
  await expect(main.locator('a[data-action="plan-setup"]')).toHaveText('选择计划');
  await main.locator('a[data-action="plan-setup"]').click();
  const sheet=page.getByRole('dialog',{name:'选择训练模板'});
  await expect(sheet).toContainText('上肢 / 下肢');
  await expect(sheet).toContainText('推 / 拉 / 腿');
  await sheet.getByRole('button',{name:/上肢 \/ 下肢/}).click();
  await expect(sheet).toContainText('上肢 A');
  await expect(sheet).toContainText('下肢 B');
  await sheet.getByText('确认并保存').click();
  await expect(main).toBeVisible();

  const before=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  expect(before.program.days).toHaveLength(4);
  const chosen=before.program.days.find((day:{id:string})=>day.id==='upper_a');
  expect(chosen.weekday).toBe(1);
  if(new Date(`${before.today}T12:00:00Z`).getUTCDay()!==1){
    await main.locator('a[data-action="choose-day"]').click();
    const daySheet=page.getByRole('dialog',{name:'选择训练日'});
    await expect(daySheet.getByText('开始训练')).toHaveAttribute('aria-disabled','true');
    await daySheet.getByRole('button',{name:/上肢 A/}).click();
    await daySheet.getByText('开始训练').click();
  }else await main.locator('a[data-action="start-session"]').click();

  const session=page.locator('.screen[data-screen="Session"]');
  await expect(session).toBeVisible();
  const firstLoad=session.getByRole('spinbutton',{name:/首次重量/});
  await expect(firstLoad).toBeVisible();
  await expect(session.getByRole('button',{name:'填写重量后完成本组'})).toBeDisabled();
  await firstLoad.fill('152.5');
  await expect(session.getByRole('button',{name:'确认单位后完成本组'})).toBeDisabled();
  await session.getByRole('button',{name:'确认重量单位 lb'}).click();
  await session.getByRole('radio',{name:'2'}).click();
  await session.getByRole('button',{name:'完成本组'}).click();
  await expect(session).toContainText('上一组 152.5 × 5');
  await expect(session).toContainText('45 + 5 + 2.5');await expect(session).toContainText('2.5 lb 无法配出');await expect(session).not.toContainText('每侧 35 + 5');
  const during=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  expect(during.entries.some((entry:{kind:string;load?:number;sessionId?:string})=>entry.kind==='set'&&entry.load===152.5&&entry.sessionId)).toBe(true);
  expect(during.derived['next.bench_press'].rule).toBe('V5');
  expect(during.program.days.find((day:{id:string})=>day.id==='upper_a').weekday).toBe(1);
  await session.locator('[data-action="end-session"]').click();
  const debrief=page.locator('.screen[data-screen="Debrief"]');
  await expect(debrief).toContainText('152.5 lb × 5');
  await debrief.getByText('返回今日').click();
  await expect(main).toBeVisible();

  const input=page.getByLabel('今天发生了什么？');
  await input.fill('体重 70kg');
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('已记录');
  await page.goto('/#Body');
  const body=page.locator('.screen[data-screen="Body"]');
  await expect(body).toContainText('70.00 kg');
  await expect(body.locator('svg[role="img"]')).toHaveAttribute('aria-label',/1 次真实称重/);
  await page.goto('/#Progress');
  const progress=page.locator('.screen[data-screen="Progress"]');
  await expect(progress).toContainText('e1RM');
  await expect(progress).not.toContainText('e1RM 200 lb');
  await page.goto('/#Ledger');
  await expect(page.locator('.screen[data-screen="Ledger"]')).toContainText('体重 70 kg');
  await expect(page.locator('.screen[data-screen="Ledger"]')).toContainText('152.5 lb × 5');
});
