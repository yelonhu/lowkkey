import { test, expect } from './fixtures.ts';
import { openDay, words } from './daily-helpers.ts';
import { nutritionLocale } from '../../src/i18n/nutrition-resources.ts';
import type { Page } from '@playwright/test';
import type { Meal } from '../../src/domain/nutrition.ts';
import type * as Storage from '../../src/client/local-database.ts';
const labels = (locale: string) => nutritionLocale(locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2);
async function records(page: Page, date: string): Promise<Meal[]> { return page.evaluate(async date => (await (await fetch('/api/v1/meals?from='+date+'&to='+date)).json()).data.items, date); }
async function start(page: Page) { await page.getByTestId('add-note').click(); const card=page.locator('[data-note-id]').last(); await expect(card).toHaveAttribute('data-draft-ready','true'); return card; }
async function blur(page: Page) { await page.locator('.daily-heading h1').click(); }

test('food notes preserve words, record only on region exit, and allow every nutrient to be unknown',async({page},info)=>{
 const locale=info.project.name,text=labels(locale),{date}=await openDay(page,locale,1960,'nutrition'),card=await start(page);
 const description='小炒牛肉吃了一半、米饭一碗\nNo weighing, no guessing.';
 await card.locator('textarea').fill(description);
 expect(await records(page,date)).toHaveLength(0);
 await card.locator('.diet-nutrients summary').click(); await card.getByRole('textbox',{name:text.energyKcal,exact:true}).focus();
 expect(await records(page,date)).toHaveLength(0);
 await blur(page);
 await expect.poll(async()=>(await records(page,date)).length).toBe(1);
 const first=(await records(page,date))[0];expect(first.note?.description).toBe(description);expect(first.note?.nutrientSnapshot.energyMkcal).toBeNull();
 await expect(page.getByTestId('diet-complete')).toBeEnabled();await page.getByTestId('diet-complete').click();
 await expect.poll(()=>page.evaluate(async date=>(await(await fetch('/api/v1/nutrition/summary?from='+date+'&to='+date)).json()).data.days[0].completeness,date)).toBe('complete');
 await page.reload();await expect(page.locator('.diet-note textarea')).toHaveValue(description);
 await page.locator('.diet-nutrients summary').click();
 const energy=page.getByRole('textbox',{name:text.energyKcal,exact:true});
 await energy.fill('1');await energy.fill('10');await page.getByRole('textbox',{name:text.proteinG,exact:true}).focus();
 expect((await records(page,date))[0].note?.nutrients.energyKcal).toBeNull();
 await blur(page);await expect.poll(async()=>(await records(page,date))[0].note?.nutrients.energyKcal).toBe('10');
 expect((await records(page,date))[0].id).toBe(first.id);
 await expect(page.locator('.diet-review')).toContainText(text.partial);
});

test('raw drafts survive refresh and conversation; leaving for another date saves to the original day',async({page},info)=>{
 const locale=info.project.name,{date}=await openDay(page,locale,1961,'nutrition'),card=await start(page);
 await card.locator('textarea').fill('米饭一碗，先写到这里');
 await expect.poll(()=>page.evaluate(async()=>{
  const path='/src/client/local-database.ts'; const {LocalDatabase}=await import(path) as typeof Storage;
  const me=(await(await fetch('/api/v1/me')).json()).data,db=await LocalDatabase.open(me.profile.ownerId);
  const values=await db.listDrafts();db.close();return values.some(value=>value.rawFields.description==='米饭一碗，先写到这里');
 })).toBe(true);
 await page.reload();await expect(page.locator('.diet-note textarea')).toHaveValue('米饭一碗，先写到这里');
 expect(await records(page,date)).toHaveLength(0);
 await page.locator('.chat-button').click();await page.getByRole('button',{name:words(locale).assistant.back,exact:true}).click();
 await expect(page.locator('.diet-note textarea')).toHaveValue('米饭一碗，先写到这里');
 await expect.poll(async()=>(await records(page,date)).length).toBe(1);
 await page.locator('.diet-note textarea').fill('米饭一碗，改一下');
 await page.locator('.daily-heading input').fill(date.slice(0,8)+'02');
 await expect(page.locator('.diet-view')).toHaveAttribute('data-diet-date',date.slice(0,8)+'02');
 await expect.poll(async()=>(await records(page,date))[0].note?.description).toBe('米饭一碗，改一下');
 expect(await records(page,date.slice(0,8)+'02')).toHaveLength(0);
});

test('offline successive edits keep one identity and reconnect without refresh',async({page,context},info)=>{
 const locale=info.project.name,text=labels(locale),{date}=await openDay(page,locale,1962,'nutrition');
 await context.setOffline(true);
 const card=await start(page);await card.locator('textarea').fill('离线便签');await blur(page);
 await expect(card.locator('.save-status')).toHaveAttribute('data-save-state','queued');
 await card.locator('textarea').fill('离线便签，补一句');await blur(page);
 await expect(page.getByTestId('diet-complete')).toBeDisabled();
 await expect(page.locator('.diet-review')).toContainText(text.pendingReview);
 await context.setOffline(false);
 await expect.poll(async()=>(await records(page,date))[0]?.note?.description).toBe('离线便签，补一句');
 expect(await records(page,date)).toHaveLength(1);
 await expect(page.getByTestId('diet-complete')).toBeEnabled();
});

test('cross-device changes require review, clearing never deletes, and explicit deletion works',async({page},info)=>{
 const locale=info.project.name,text=labels(locale),{date}=await openDay(page,locale,1963,'nutrition'),card=await start(page);
 await card.locator('textarea').fill('原来的便签');await blur(page);
 await expect.poll(async()=>(await records(page,date)).length).toBe(1);const first=(await records(page,date))[0];
 await expect(card.locator('.save-status')).toHaveAttribute('data-save-state','synced');
 await card.locator('textarea').fill('本机的新内容');
 await page.evaluate(async first=>{
  const response=await fetch('/api/v1/meals/'+first.id,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"'+first.revision+'"'},body:JSON.stringify({note:{description:'另一台设备的内容',nutrients:{energyKcal:null,proteinG:null,carbsG:null,fatG:null}}})});if(!response.ok)throw Error('Remote edit failed');
 },first);
 await blur(page);await expect(card.locator('[data-command-state=conflict]')).toBeVisible();
 expect((await records(page,date))[0].note?.description).toBe('另一台设备的内容');
 await card.getByRole('button',{name:words(locale).common.review,exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('另一台设备的内容');
 await page.getByRole('dialog').getByRole('button',{name:text.apply}).click();
 await expect.poll(async()=>(await records(page,date))[0].note?.description).toBe('本机的新内容');
 await card.locator('textarea').fill('');await blur(page);await expect(card.locator('[role=alert]')).toContainText(text.invalidText);
 expect(await records(page,date)).toHaveLength(1);
 await expect(page.getByTestId('diet-complete')).toBeDisabled();
 await card.locator('.diet-details summary').click();await card.getByRole('button',{name:words(locale).common.remove,exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:words(locale).common.remove,exact:true}).click();
 await expect.poll(async()=>(await records(page,date)).length).toBe(0);
});

test('quick undo is available for ten seconds and never overwrites a newer note',async({page},info)=>{
 const locale=info.project.name,{date}=await openDay(page,locale,1964,'nutrition');await page.clock.install();
 const card=await start(page);await card.locator('textarea').fill('一杯牛奶');await blur(page);
 await expect(page.getByTestId('diet-undo')).toBeVisible();await page.clock.fastForward(8000);await expect(page.getByTestId('diet-undo')).toBeVisible();await page.clock.fastForward(2100);await expect(page.getByTestId('diet-undo')).toHaveCount(0);
 const second=await start(page);await second.locator('textarea').fill('一碗米饭');await blur(page);await expect(page.getByTestId('diet-undo')).toBeVisible();
 await page.getByTestId('diet-undo').click();await expect.poll(async()=>(await records(page,date)).length).toBe(1);
 const third=await start(page);await third.locator('textarea').fill('另一碗米饭');await blur(page);await expect(page.getByTestId('diet-undo')).toBeVisible();
 await third.locator('textarea').fill('米饭吃了一半');await blur(page);await expect.poll(async()=>(await records(page,date)).some(record=>record.note?.description==='米饭吃了一半')).toBe(true);
 await page.getByTestId('diet-undo').click();await expect(page.locator('.diet-view > [role=alert]')).toContainText(words(locale).weight.undoBlocked);
 expect((await records(page,date)).some(record=>record.note?.description==='米饭吃了一半')).toBe(true);
});

test('slow local persistence does not consume newer writing',async({page},info)=>{
 const locale=info.project.name,{date}=await openDay(page,locale,1965,'nutrition'),card=await start(page);
 await card.locator('textarea').fill('旧输入');
 await page.evaluate(async()=>{
  const path='/src/client/local-database.ts', {LocalDatabase}=await import(path) as typeof Storage;
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),original=LocalDatabase.prototype.readLedger;
  const race={waiting:false,release};(window as unknown as {dietRace:typeof race}).dietRace=race;
  LocalDatabase.prototype.readLedger=async function(){if(!new Error().stack?.split('\n')[2]?.includes('/src/app/nutrition/NoteEditor.tsx'))return original.call(this);LocalDatabase.prototype.readLedger=original;race.waiting=true;await gate;return original.call(this);};
 });
 await blur(page);await expect.poll(()=>page.evaluate(()=>(window as unknown as {dietRace:{waiting:boolean}}).dietRace.waiting)).toBe(true);
 await card.locator('textarea').fill('存储很慢时继续写的新输入');
 await page.evaluate(()=>(window as unknown as {dietRace:{release:()=>void}}).dietRace.release());
 await expect.poll(async()=>(await records(page,date)).length).toBe(1);
 await expect(card.locator('textarea')).toHaveValue('存储很慢时继续写的新输入');
 await blur(page);await expect.poll(async()=>(await records(page,date))[0].note?.description).toBe('存储很慢时继续写的新输入');
 expect(await records(page,date)).toHaveLength(1);
});

test('food notes fit narrow screens, dark mode, large text, and local numeric fonts',async({page},info)=>{
 const locale=info.project.name,text=labels(locale),{date}=await openDay(page,locale,1966,'nutrition');
 for(const width of [320,375,430,1280]){await page.setViewportSize({width,height:667});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 const card=await start(page);await card.locator('textarea').fill('小炒牛肉吃了一半、米饭一碗。 A long food note with enough detail to remember a shared meal.');
 await card.locator('.diet-nutrients summary').click();await card.getByRole('textbox',{name:text.energyKcal,exact:true}).fill('1234.56');await blur(page);
 await expect.poll(async()=>(await records(page,date)).length).toBe(1);
 for(const colorScheme of ['light','dark'] as const)for(const width of [320,375,430,1280]){
  await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await page.setViewportSize({width,height:667});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const buttons=await card.locator('button:visible, summary:visible').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height));expect(buttons.every(height=>height>=44)).toBe(true);
  await expect.poll(()=>card.locator('textarea').evaluate(element=>element.scrollHeight<=element.clientHeight+1)).toBe(true);
  await page.screenshot({path:info.outputPath('diet-'+colorScheme+'-'+width+'.png'),fullPage:true,animations:'disabled'});
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='24px';});await page.setViewportSize({width:375,height:667});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await card.getByRole('textbox',{name:text.energyKcal,exact:true}).focus();expect(await card.getByRole('textbox',{name:text.energyKcal,exact:true}).evaluate(element=>getComputedStyle(element).fontFamily)).toContain('JetBrains Mono');
 expect(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('16px "JetBrains Mono"');})).toBe(true);
});
