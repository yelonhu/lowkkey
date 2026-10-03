import { test,expect } from '@playwright/test';
test('overlapping unauthenticated reads lead to login rather than a network dead end',async({page})=>{
  let calls=0;
  await page.route('**/v1/state',async route=>{
    calls++;if(calls<=2){await new Promise(resolve=>setTimeout(resolve,calls===1?180:350));await route.fulfill({status:401,json:{error:{code:'unauthorized'}}}).catch(()=>{});}else await route.continue();
  });
  await page.goto('/');await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  const login=page.getByRole('button',{name:'进入状态舱'});await expect(login).toBeVisible();
  await expect(page.getByRole('heading')).toHaveText('欢迎回来。');
  await page.unroute('**/v1/state');await login.click();await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  await page.goto('/#Connect');await page.getByRole('button',{name:'我的账户'}).click();
  await expect(page.getByRole('dialog',{name:'账户'})).toBeVisible();await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(login).toBeVisible();await expect(page.locator('.screen')).toHaveCount(0);
});
