import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source=readFileSync(resolve('docs/lowkkey-handoff/frontend/lowkkey-frontend.html'),'utf8');
const screens=['Main','Capture','Session','Body','Progress','Ledger','Connect','Transition','Debrief','Icon'] as const;

test('ten source artboards keep their original container styles and render account state',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen').waitFor();
  const account=await page.evaluate(async()=>{const response=await fetch('/v1/state');if(!response.ok)throw new Error(String(response.status));return response.json();});
  for(const screen of screens){
    await page.setViewportSize(screen==='Transition'?{width:1160,height:840}:screen==='Icon'?{width:512,height:512}:{width:390,height:844});
    await page.goto(`/#${screen}`);
    const board=page.locator(`.screen[data-screen="${screen}"]`);await expect(board).toHaveCount(1);
    await page.evaluate(()=>document.fonts.ready);
    const original=await page.evaluate(({html,name})=>new DOMParser().parseFromString(html,'text/html').querySelector(`.screen[data-screen="${name}"]`)?.firstElementChild?.getAttribute('style'),{html:source,name:screen});
    expect(await board.locator(':scope > *').first().getAttribute('style')).toBe(original);
    await expect(async()=>await board.screenshot({animations:'disabled',path:`.artifacts/playwright/${testInfo.project.name}/v1-${screen}.png`})).toPass({timeout:5000});
  }
  expect(errors).toEqual([]);
  await page.goto('/#Connect');
  const connect=page.locator('.screen[data-screen="Connect"]');
  await expect(connect).not.toContainText('/mcp');
  await expect(connect).not.toContainText('propose_entries');
  await expect(connect).toContainText('授权管理');
  expect(await connect.getByText('已撤销',{exact:true}).count()).toBe(account.clients.filter((client:{status:string})=>client.status==='revoked').length);
  await page.goto('/#Ledger');
  await expect(page.locator('.screen[data-screen="Ledger"]')).not.toContainText('130.1 lb');
  await page.goto('/#Body');
  const body=page.locator('.screen[data-screen="Body"]');
  await expect(body).not.toContainText('目标 75 kg');
  await expect(body).not.toContainText('目标速度 → 5 月中');
  await expect(body.locator('[data-bind="body-reference-label"]')).toHaveText('');
  await page.goto('/#Session');
  await expect(page.locator('.screen[data-screen="Session"]')).not.toContainText('115 × 8');
  await page.goto('/#Debrief');
  await expect(page.locator('.screen[data-screen="Debrief"]')).not.toContainText('175 × 6');
});

test('capture records the user value and the ledger supports append-only undo',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  const input=page.getByLabel('今天发生了什么？');await input.fill('卧推 118lb 7次');await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('已记录');
  await page.goto('/#Ledger');
  const row=page.locator('.record-card').filter({hasText:'杠铃平板卧推 118 lb × 7'}).first();await expect(row).toBeVisible();
  await row.getByRole('button',{name:'撤销'}).click();
  await expect(row).toContainText('已撤销');
});

test('photo and voice explain current availability without exposing protocol setup',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});await page.locator('.screen,.access-gate button').first().waitFor();if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  await page.getByRole('button',{name:'照片使用说明'}).click();
  await expect(page.getByRole('status')).toContainText('暂不支持照片输入');
  await page.getByRole('button',{name:'语音使用说明'}).click();
  await expect(page.getByRole('status')).toContainText('暂不支持语音输入');
});
