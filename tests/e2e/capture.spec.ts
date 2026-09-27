import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function enterAccount(page:Page) {
  await page.goto('/');
  const login=page.getByRole('button',{name:'进入状态舱'});
  if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
}

test('direct file open explains how to start the app', async ({page}) => {
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await expect(page.getByRole('heading',{name:'请从本地服务打开 lowkkey'})).toBeVisible();
  await expect(page.getByText('./scripts/run dev')).toBeVisible();
});

test('direct text capture commits and can be reverted from the original ledger row',async({page})=>{
  await enterAccount(page);
  await page.getByLabel('今天发生了什么？').fill('卧推 110lb 10次');
  await page.getByLabel('今天发生了什么？').press('Enter');
  await expect(page.getByRole('status')).toContainText('已记录');
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await page.locator('.screen[data-screen="Ledger"]').waitFor();
  const row=page.locator('.record-card').filter({hasText:'杠铃平板卧推 110 lb × 10'}).first();
  await expect(row).toBeVisible();
  await row.getByRole('button',{name:'撤销'}).click();
  await expect(row).toContainText('已撤销');
});

test('the source status bar supports immediate undo and closes after eight seconds',async({page})=>{
  await enterAccount(page);
  const input=page.getByLabel('今天发生了什么？');
  await input.fill('卧推 117lb 7次');await input.press('Enter');
  const status=page.getByRole('status');
  await expect(status).toContainText('已记录 杠铃平板卧推 117 lb × 7');
  await status.getByRole('button',{name:'撤销'}).click();
  await expect(status).toBeHidden();
  await input.fill('卧推 119lb 6次');await input.press('Enter');
  await expect(status).toContainText('已记录 杠铃平板卧推 119 lb × 6');
  await input.fill('下一条未提交');
  await expect(status).toBeHidden({timeout:10_000});
  await expect(input).toHaveValue('下一条未提交');
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await page.getByRole('link',{name:'今日',exact:true}).click();
  await expect(input).toHaveValue('下一条未提交');
});

test('ambiguous RIR asks one question after other sets commit',async({page})=>{
  await enterAccount(page);
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await page.locator('.screen[data-screen="Ledger"]').waitFor();
  const activeBench=page.locator('.record-card').filter({hasText:'杠铃平板卧推',hasNotText:'已撤销'});
  const before=await activeBench.count();
  await page.getByRole('link',{name:'今日',exact:true}).click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  await page.getByLabel('今天发生了什么？').fill('卧推 105lb*5+115lb*8+125lb*7+125lb*5，125那组rir0');
  await page.getByLabel('今天发生了什么？').press('Enter');
  const dialog=page.getByRole('dialog',{name:'确认'});
  await expect(dialog).toContainText('待确认');
  await expect(dialog).toContainText('RIR');
  await dialog.getByRole('button',{name:/跳过/}).click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await page.locator('.screen[data-screen="Ledger"]').waitFor();
  await expect(activeBench).toHaveCount(before+4);
});

test('offline queue submits once after reconnect',async({page,context})=>{
  await enterAccount(page);
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await page.locator('.screen[data-screen="Ledger"]').waitFor();
  const matching=page.locator('.record-card').filter({hasText:'杠铃平板卧推 113 lb × 9'});
  const before=await matching.count();
  await page.getByRole('link',{name:'今日',exact:true}).click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  await context.setOffline(true);
  await page.getByLabel('今天发生了什么？').fill('卧推 113lb 9次');
  await page.getByLabel('今天发生了什么？').press('Enter');
  await expect(page.getByRole('status')).toContainText('1 条待发送');
  await expect(page.getByRole('status')).not.toContainText('已记录');
  await context.setOffline(false);
  await expect(page.getByRole('status')).toContainText('已记录 杠铃平板卧推 113 lb × 9');
  await page.reload();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  await expect(page.getByText('1 条待发送')).toHaveCount(0);
  await page.getByRole('link',{name:'日志',exact:true}).click();
  await page.locator('.screen[data-screen="Ledger"]').waitFor();
  await expect(matching).toHaveCount(before+1);
});
