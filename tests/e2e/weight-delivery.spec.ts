import { test, expect, localLogin } from './fixtures.ts';
import { openDay, words, enterWeight, saveWeight, readWeightDay } from './daily-helpers.ts';

test('daily weight keeps 110 lb, edits one identity, and display preferences never rewrite facts', async ({page},info) => {
  const locale=info.project.name,{date}=await openDay(page,locale,1990), first=await saveWeight(page,locale,date,'110','lb');
  expect(first).toMatchObject({value:'110',unit:'lb',kgMicros:49895161,timePrecision:'date',occurredAt:null,revision:1});
  const second=await saveWeight(page,locale,date,'110.5','lb'); expect(second.id).toBe(first.id); expect(second.revision).toBe(2);
  await page.locator('.avatar').click(); await page.locator('#weight-display-unit').selectOption('lb'); await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/v1/me')).json()).data.profile.bodyWeightUnit)).toBe('lb');
  await page.goto('/weight?date='+date); await expect(page.getByTestId('weight-reading')).toContainText('110.5');
  await page.reload(); await expect(page.getByTestId('weight-reading')).toContainText('110.5'); expect(await readWeightDay(page,date)).toMatchObject({id:first.id,revision:2,value:'110.5',unit:'lb'});
  await page.locator('.avatar').click(); await page.locator('#weight-display-unit').selectOption('kg'); await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/v1/me')).json()).data.profile.bodyWeightUnit)).toBe('kg');
});
test('quick undo expires and a later edit is protected',async({page},info)=>{
  const locale=info.project.name,{date}=await openDay(page,locale,1991);await page.clock.install();
  const first=await saveWeight(page,locale,date,'70');await expect(page.getByTestId('quick-undo')).toBeVisible();
  await page.clock.fastForward(8000);await expect(page.getByTestId('quick-undo')).toBeVisible();await page.clock.fastForward(2100);await expect(page.getByTestId('quick-undo')).toHaveCount(0);
  const response=await page.evaluate(async({date,id})=>{return (await fetch('/api/v1/weights/days/'+date+'/'+id,{method:'DELETE',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"1"'},body:'{}'})).status;},{date,id:first.id});expect(response).toBe(200);
  await page.reload();await expect(page.getByTestId('weight-reading')).toContainText('—');
  const next=await saveWeight(page,locale,date,'70.1');await page.getByTestId('quick-undo').click();await expect.poll(()=>readWeightDay(page,date)).toBeNull();
  await expect(page.getByTestId('weight-reading')).toContainText('—');
  const later=await saveWeight(page,locale,date,'70.2');expect(later.id).not.toBe(next.id);
  await page.evaluate(async id=>{
    const send=(extra:object={})=>fetch('/api/v1/weights/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"1"'},body:JSON.stringify({value:'70.3',...extra})});
    let result=await send();if(result.status===422){const details=(await result.json()).error.params;result=await send({confirmedOutlier:true,outlierReference:{id:details.referenceId,revision:details.referenceRevision}});}if(!result.ok)throw Error('Concurrent edit failed');
  },later.id);
  await page.getByTestId('quick-undo').click();await expect.poll(async()=> (await readWeightDay(page,date))?.value).toBe('70.3');
});
test('outliers require confirmation; clearing does not delete; deleting never promotes legacy extras',async({page},info)=>{
  const locale=info.project.name,text=words(locale),{date}=await openDay(page,locale,1992), first=await saveWeight(page,locale,date,'70');
  await page.evaluate(async date=>{await fetch('/api/v1/weights',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({id:crypto.randomUUID(),localDate:date,entryTimezone:'America/Chicago',occurredAt:null,timePrecision:'date',value:'70.1',unit:'kg',condition:'unspecified',primaryChoice:'extra'})});},date);
  await enterWeight(page,'');await page.locator('.daily-heading h1').click();expect((await readWeightDay(page,date)).id).toBe(first.id);await expect(page.locator('.weight-hero [role=alert]')).toBeVisible();
  await enterWeight(page,'80');await page.locator('.daily-heading h1').click();
  // A reference on a previous day drives the anomaly check, not the edited row itself.
  await expect.poll(async()=>await page.getByRole('dialog').isVisible() || (await readWeightDay(page,date))?.value==='80').toBe(true);
  if(await page.getByRole('dialog').isVisible())await page.getByRole('dialog').getByRole('button',{name:text.weight.confirmOutlier}).click();
  await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('80');
  await page.locator('.weight-more').click();await page.getByRole('dialog').getByRole('button',{name:text.common.remove,exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:text.common.remove,exact:true}).click();await expect.poll(()=>readWeightDay(page,date)).toBeNull();
  await expect(page.getByTestId('weight-reading')).toContainText('—');await page.reload();await expect(page.getByTestId('weight-reading')).toContainText('—');
});
test('repeated transport failures recover automatically with the same idempotency key',async({page},info)=>{
  test.setTimeout(60000);const locale=info.project.name,{date}=await openDay(page,locale,1993);await page.clock.install();
  let attempts=0;const keys:string[]=[];
  await page.route('**/api/v1/weights/days/'+date,async route=>{if(route.request().method()!=='POST')return route.continue();keys.push(route.request().headers()['idempotency-key']);attempts++;if(attempts<=6)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY_FAILURE'}})});return route.continue();});
  await enterWeight(page,'70','kg');await page.locator('.daily-heading h1').click();
  if(await page.getByRole('dialog').isVisible())await page.getByRole('dialog').getByRole('button',{name:words(locale).weight.confirmOutlier}).click();
  for(let i=0;i<7;i++){await page.clock.fastForward(31000);await expect.poll(()=>attempts).toBeGreaterThanOrEqual(Math.min(i+1,7));}
  await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70');expect(new Set(keys).size).toBe(1);expect(attempts).toBe(7);
});
test('initial read failure offers recovery and normal background reads stay silent',async({page},info)=>{
  await localLogin(page);let failing=true;
  await page.route('**/api/v1/sync/snapshot?*',route=>failing?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY_FAILURE'}})}):route.continue());
  await page.goto('/weight');const initial=page.getByTestId('initial-load');await expect(initial.locator('[role=alert]')).toBeVisible();failing=false;await initial.getByRole('button').click();
  await expect(page.getByTestId('weight-reading')).toBeVisible();await expect(page.locator('.sync-bar')).toHaveCount(0);await expect(page.locator('.app-footer button')).toHaveCount(0);
  await page.getByTestId('language').selectOption(info.project.name);
});
test('28-day window follows the chosen date and shows no substitute for an empty day',async({page},info)=>{
  const locale=info.project.name,{date}=await openDay(page,locale,1994);await saveWeight(page,locale,date,'70');
  await page.locator('.daily-heading input').fill(date.slice(0,8)+'10');await expect(page.getByTestId('weight-reading')).toContainText('—');
  await expect(page.locator('.trend-chart text').last()).toHaveText(date.slice(5,8)+'10');await expect(page.locator('.raw-point')).toHaveCount(1);
  await page.screenshot({animations:'disabled',path:info.outputPath('weight-day.png'),fullPage:true});
});
