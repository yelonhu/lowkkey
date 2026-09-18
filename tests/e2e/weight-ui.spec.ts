import type { LocalDatabase } from '../../src/client/local-database.ts';
import { test, expect } from './fixtures.ts';
import { openDay, enterWeight, saveWeight, readWeightDay, words } from './daily-helpers.ts';
test('offline weight and a concurrent edit are recovered without manual refresh',async({page,context},info)=>{
 const locale=info.project.name,text=words(locale),{date}=await openDay(page,locale,2003);
 await enterWeight(page,'７０．','kg');await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();await expect(page).toHaveURL(new RegExp('weight\\?date='+date));await page.reload();await expect(page.locator('#weight-value')).toHaveValue('７０．');
 await context.setOffline(true);await page.locator('#weight-value').fill('70.4');await page.locator('.daily-heading h1').click();await expect(page.getByTestId('weight-reading')).toContainText('70.4');await expect(page.locator('.save-status')).toContainText(locale==='en'?'device':'本');
 await context.setOffline(false);await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70.4');
 const current=await readWeightDay(page,date);await enterWeight(page,'70.8');
 await page.evaluate(async id=>{await fetch('/api/v1/weights/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"1"'},body:JSON.stringify({value:'70.6'})});},current.id);
 await page.locator('.daily-heading h1').click();const conflict=page.locator('[data-command-state=conflict]');await expect(conflict).toBeVisible();await conflict.getByRole('button',{name:text.common.review,exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('70.8');await expect(page.getByRole('dialog')).toContainText('70.6');await page.getByRole('dialog').locator('button').first().click();
 await expect(conflict).toHaveCount(0);await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70.8');
});
test('unit focus stays inside the editor and consecutive edits retain one daily record',async({page,context},info)=>{
 const locale=info.project.name,{date}=await openDay(page,locale,2004);await enterWeight(page,'70','kg');await page.locator('.weight-reading select').focus();expect(await readWeightDay(page,date)).toBeNull();
 await page.locator('#weight-value').fill('70.2');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70.2');
 const before=await readWeightDay(page,date);await context.setOffline(true);await enterWeight(page,'70.3');await page.locator('.daily-heading h1').click();await enterWeight(page,'70.4');await page.locator('.daily-heading h1').click();await context.setOffline(false);
 await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70.4');expect((await readWeightDay(page,date)).id).toBe(before.id);
 await saveWeight(page,locale,date,'70.5');
});

test('weight preserves newer input during a slow save and reopening never submits a draft',async({page,context},info)=>{
 const {date,ownerId}=await openDay(page,info.project.name,2005);await enterWeight(page,'70','kg');await context.setOffline(true);
 await page.evaluate(async()=>{
  const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);
  const state=window as typeof window & {weightRace?:{waiting:boolean;release:()=>void;saving:Promise<unknown>;preserved:string|null}};
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),original=LocalDatabase.prototype.readLedger,enqueue=LocalDatabase.prototype.enqueueCommand;
  const race={waiting:false,release,saving:Promise.resolve() as Promise<unknown>,preserved:null as string|null};state.weightRace=race;
  LocalDatabase.prototype.readLedger=async function(){if(!new Error().stack?.split('\n')[2]?.includes('/src/app/WeightView.tsx'))return original.call(this);LocalDatabase.prototype.readLedger=original;race.waiting=true;await gate;return original.call(this);};
  LocalDatabase.prototype.enqueueCommand=async function(...args:Parameters<LocalDatabase['enqueueCommand']>){LocalDatabase.prototype.enqueueCommand=enqueue;const result=await enqueue.apply(this,args);race.preserved=args[1]?(await this.readDraft(args[1].id))?.rawFields.value??null:null;return result;};
  const actions:Array<()=>Promise<unknown>>=[];window.dispatchEvent(new CustomEvent('lowkkey:commit-editing',{detail:actions}));race.saving=Promise.all(actions.map(action=>action()));
 });
 await expect.poll(()=>page.evaluate(()=>(window as typeof window & {weightRace?:{waiting:boolean}}).weightRace?.waiting)).toBe(true);
 await page.locator('#weight-value').fill('70.2');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect.poll(()=>page.evaluate(async owner=>{const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);const db=await LocalDatabase.open(owner);try{return(await db.listDrafts()).some((draft:{rawFields:Record<string,string>})=>draft.rawFields.value==='70.2');}finally{db.close();}},ownerId)).toBe(true);
 expect(await page.evaluate(async()=>{const race=(window as typeof window&{weightRace:{release:()=>void;saving:Promise<unknown>;preserved:string|null}}).weightRace;race.release();await race.saving;return race.preserved;})).toBe('70.2');
 await expect(page.locator('#weight-value')).toHaveValue('70.2');await context.setOffline(false);await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70');
 await page.reload();await expect(page.locator('#weight-value')).toHaveValue('70.2');await expect(page.locator('#weight-value')).not.toBeFocused();expect((await readWeightDay(page,date)).value).toBe('70');
 await page.locator('#weight-value').focus();await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readWeightDay(page,date))?.value).toBe('70.2');expect((await readWeightDay(page,date)).revision).toBe(2);
});
test('weight reading and chart fit the first mobile screen with clear touch targets',async({page},info)=>{
 const locale=info.project.name,{date}=await openDay(page,locale,2006);await page.setViewportSize({width:375,height:667});await saveWeight(page,locale,date,'70','kg');
 await expect.poll(async()=>{const r=await page.locator('.trend-chart').boundingBox();return r? r.y+r.height:Infinity;}).toBeLessThan(667);
 await expect(page.getByTestId('weight-reading')).toBeVisible();await page.screenshot({animations:'disabled',path:info.outputPath('weight-375.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({animations:'disabled',path:info.outputPath('weight-375-dark.png'),fullPage:true});
 await page.getByTestId('weight-reading').click();const targets=page.locator('.weight-reading input,.weight-reading select,.weight-more');
 for(const target of await targets.all()){const box=await target.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);}
 await expect(page.locator('#weight-value')).toBeFocused();await page.locator('#weight-value').fill('500');await expect(page.locator('.daily-weight')).toHaveJSProperty('scrollWidth',await page.locator('.daily-weight').evaluate(e=>e.clientWidth));
});
