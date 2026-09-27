import { expect, test } from '@playwright/test';

const screens=['Main','Capture','Session','Body','Progress','Ledger','Connect','Transition','Debrief','Icon'] as const;

test('every visible control navigates, acts, or is explicitly disabled on an empty account',async({page})=>{
  await page.goto('/');
  const login=page.getByRole('button',{name:'进入状态舱'});
  if(await login.isVisible())await login.click();
  for(const screen of screens){
    await page.goto(`/#${screen}`);
    await page.locator(`.screen[data-screen="${screen}"]`).waitFor();
    const unresolved=await page.locator(`.screen[data-screen="${screen}"]`).evaluate(root=>
      Array.from(root.querySelectorAll<HTMLElement>('button,a,[role="button"]'))
        .filter(item=>item.getClientRects().length>0)
        .filter(item=>!item.closest('[aria-hidden="true"]'))
        .filter(item=>!(item instanceof HTMLButtonElement&&item.disabled)&&item.getAttribute('aria-disabled')!=='true')
        .filter(item=>!item.hasAttribute('href')&&!item.dataset.action&&!item.dataset.derivedKey&&!item.dataset.filter&&!item.dataset.answerGate&&!item.dataset.heldOption)
        .map(item=>item.outerHTML.slice(0,240)));
    expect(unresolved,`${screen} has inert controls`).toEqual([]);
  }
});
