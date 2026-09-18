import type { LocalDatabase } from '../../src/client/local-database.ts';
import { test, expect } from './fixtures.ts';
import { trainingReady, addExercise, readTrainingDay, load, reps, rpe, trainingWords } from './daily-helpers.ts';
test('one day records rows on exit only and has no workout lifecycle',async({page,context},info)=>{
 const locale=info.project.name,{date}=await trainingReady(page,locale,2010),card=await addExercise(page,locale),row=card.locator('[data-set-id]').first();
 expect((await readTrainingDay(page,date)).sessions).toHaveLength(0);
 await load(row).fill('110');await reps(row).fill('1');await rpe(row).focus();expect((await readTrainingDay(page,date)).sets).toHaveLength(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect((await readTrainingDay(page,date)).sets).toHaveLength(0);
 await reps(row).fill('10');await context.setOffline(true);await card.locator('.add-set').click();await expect(card.locator('[data-recorded=true]')).toHaveCount(1);
 const second=card.locator('[data-set-id]').last();await expect(load(second)).toHaveValue('110');await expect(reps(second)).toHaveValue('');await expect(rpe(second)).toHaveValue('');
 await reps(second).fill('8');await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();await expect(page).toHaveURL(new RegExp('training\\?date='+date));
 await context.setOffline(false);await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(2);
 const day=await readTrainingDay(page,date);expect(day.sessions).toHaveLength(1);expect(day.sessions[0]).toMatchObject({status:'recorded',startedAt:null,endedAt:null,timePrecision:'date'});
 expect(day.sets).toEqual(expect.arrayContaining([expect.objectContaining({reps:10,loadDecimal:'110',unit:'lb',kgMicros:49895161,completedAt:null,rpeHalfUnits:null,setType:'unknown'})]));
 expect(day.exercises[0].displaySnapshot).toMatchObject({includesBar:true,barWeightDecimal:'45',barUnit:'lb'});
 await page.reload();await expect(card.locator('[data-recorded=true]')).toHaveCount(2);await expect(page.locator('.training-timer,.session-options,.finish-training')).toHaveCount(0);
 await page.screenshot({animations:'disabled',path:info.outputPath('training-day.png'),fullPage:true});
});
test('stale row edits require review and deleting the final row leaves an empty day',async({page},info)=>{
 const locale=info.project.name,text=trainingWords(locale),{date}=await trainingReady(page,locale,2011),card=await addExercise(page,locale),row=card.locator('[data-set-id]').first();
 await load(row).fill('110');await reps(row).fill('10');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);
 await reps(row).fill('8');await page.evaluate(async date=>{
 const day=(await(await fetch('/api/v1/training/days/'+date)).json()).data;
 const response=await fetch('/api/v1/training/days/'+date+'/'+day.sessions[0].id+'/sets/'+day.sets[0].id,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"'+day.sessions[0].revision+'"'},body:JSON.stringify({expectedRevision:day.sets[0].revision,reps:9})});if(!response.ok)throw Error();
 },date);
 await page.locator('.daily-heading h1').click();await expect(row.locator('.row-status')).toBeVisible();await row.getByRole('button',{name:text.review,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:text.applyEdit}).click();
 await expect.poll(async()=>(await readTrainingDay(page,date)).sets[0]?.reps).toBe(8);
 await reps(row).fill('');await page.locator('.daily-heading h1').click();expect((await readTrainingDay(page,date)).sets).toHaveLength(1);
 await row.locator('.set-number').click();await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click();
 await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(0);
});
test('past-day reference remains unrecorded and unit changes preserve real bar metadata',async({page},info)=>{
 const locale=info.project.name,text=trainingWords(locale),{date}=await trainingReady(page,locale,2012),card=await addExercise(page,locale),row=card.locator('[data-set-id]').first();
 await load(row).fill('110');await reps(row).fill('10');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);
 const nextDate=date.slice(0,8)+'10';await page.locator('.daily-heading input').fill(nextDate);const next=await addExercise(page,locale);await expect(next.locator('.training-reference')).toContainText('110');
 expect((await readTrainingDay(page,nextDate)).sets).toHaveLength(0);await expect(load(next.locator('[data-set-id]').first())).toHaveValue('');
 await next.locator('.setup-chip').click();await page.getByRole('dialog').getByLabel(text.unit,{exact:true}).selectOption('kg');await page.getByRole('dialog').getByRole('button',{name:text.applySetup}).click();
 await expect(next.locator('.setup-chip')).toContainText('kg');const newrow=next.locator('[data-set-id]').first();await load(newrow).fill('50');await reps(newrow).fill('8');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,nextDate)).sets.length).toBe(1);
 expect((await readTrainingDay(page,date)).sets[0]).toMatchObject({loadDecimal:'110',unit:'lb',kgMicros:49895161});expect((await readTrainingDay(page,nextDate)).exercises[0].displaySnapshot).toMatchObject({barWeightDecimal:'45',barUnit:'lb'});
});
test('per-side default keeps unknown effort and custom bodyweight omits external load',async({page},info)=>{
 const locale=info.project.name,text=trainingWords(locale),{date}=await trainingReady(page,locale,2013),card=await addExercise(page,locale,true),row=card.locator('[data-set-id]').first();
 await load(row).fill('35');await reps(row).fill('10');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);
 await page.locator('.add-exercise').click();await page.getByRole('dialog').getByRole('button',{name:text.custom}).click();await page.getByRole('dialog').getByLabel(text.customName).fill('Personal bodyweight');
 await page.getByRole('dialog').getByRole('button',{name:text.addExercise,exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.training-exercise')).toHaveCount(2);const body=page.locator('.training-exercise').last();await body.locator('.setup-chip').click();await page.getByRole('dialog').locator('summary').click();await page.getByRole('dialog').getByLabel(text.semantics).selectOption('bodyweight_only');await page.getByRole('dialog').getByRole('button',{name:text.applySetup}).click();
 const current=page.locator('.training-exercise').last();await expect(current.locator('.row-load input')).toHaveCount(0);await reps(current.locator('[data-set-id]').first()).fill('12');await page.locator('.daily-heading h1').click();
 await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(2);expect((await readTrainingDay(page,date)).sets).toEqual(expect.arrayContaining([expect.objectContaining({loadDecimal:'35',unit:'lb',kgMicros:15875733,loadSemantics:'per_side',rpeHalfUnits:null,setType:'unknown'}),expect.objectContaining({loadDecimal:null,unit:null,reps:12})]));
});
test('half rows, old draft keys, date and language survive reload without becoming facts',async({page},info)=>{
 const locale=info.project.name,{date,ownerId,timezone}=await trainingReady(page,locale,2014),card=await addExercise(page,locale),exerciseId=(await card.getAttribute('data-exercise-id'))!;
 await page.evaluate(async({date,ownerId,timezone,exerciseId})=>{
 const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);const db=await LocalDatabase.open(ownerId),day=await db.readDraft('training-day:'+date),sessionId=JSON.parse(day.rawFields.groups)[0].sessionId;
 await db.saveDraft({id:'training:'+sessionId+':'+exerciseId+':set',ownerId,kind:'set',rawFields:{load:'７５．',unit:'lb',reps:'',rpe:'',setType:'unknown',note:'',targetId:'',rootBinding:'',targetBinding:''},baseRefs:[],localDate:date,entryTimezone:timezone,updatedAt:new Date().toISOString()});db.close();
 },{date,ownerId,timezone,exerciseId});
 await page.reload();const row=card.locator('[data-set-id]').first();await expect(load(row)).toHaveValue('７５．');
 await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();await expect(page).toHaveURL(new RegExp('training\\?date='+date));await page.reload();await expect(load(row)).toHaveValue('７５．');expect((await readTrainingDay(page,date)).sessions).toHaveLength(0);
 await page.getByTestId('language').selectOption(locale==='en'?'zh-Hans':'en');await expect(load(row)).toHaveValue('７５．');await page.getByTestId('language').selectOption(locale);
 await load(row).fill('75');await reps(row).fill('8');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);
 await page.goto('/');await expect(page).toHaveURL(/today$/);await expect(page.locator('[data-artifact]')).toHaveCount(3);
});
test('date remains fixed over midnight and narrow rows keep reachable non-overlapping targets',async({page},info)=>{
 const locale=info.project.name,{date}=await trainingReady(page,locale,2015),card=await addExercise(page,locale),row=card.locator('[data-set-id]').first();
 await load(row).fill('1000');await reps(row).fill('200');await rpe(row).fill('8.5');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);
 await page.clock.install();await page.clock.setSystemTime(new Date('2026-09-19T07:00:00Z'));await expect(page.locator('.daily-heading input')).toHaveValue(date);
 for(const colorScheme of ['light','dark'] as const)for(const width of [320,375,430,1024]){
 await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await page.setViewportSize({width,height:667});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(const target of [row.locator('.set-number'),load(row),reps(row),rpe(row)]){const box=await target.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);}
 await page.screenshot({animations:'disabled',path:info.outputPath('training-'+colorScheme+'-'+width+'.png'),fullPage:true});
 }
 await expect.poll(()=>page.evaluate(()=>document.fonts.check('16px "JetBrains Mono"'))).toBe(true);
 await page.locator('.brand').click();await page.setViewportSize({width:375,height:667});const last=await page.locator('[data-artifact]').last().boundingBox();expect(last!.y+last!.height).toBeLessThanOrEqual(667);expect(await page.locator('.artifact-card button').count()).toBe(0);
});

test('slow local persistence never consumes newer row input',async({page,context},info)=>{
 const locale=info.project.name,{date,ownerId}=await trainingReady(page,locale,2016),card=await addExercise(page,locale),row=card.locator('[data-set-id]').first();
 await load(row).fill('110');await reps(row).fill('10');await context.setOffline(true);
 await page.evaluate(async()=>{
 const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);
 const state=window as typeof window & {race?:{waiting:boolean;release:()=>void;saving:Promise<unknown>;preserved:string|null}};
 let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),original=LocalDatabase.prototype.readLedger,enqueue=LocalDatabase.prototype.enqueueCommand;
 const race={waiting:false,release,saving:Promise.resolve() as Promise<unknown>,preserved:null as string|null};state.race=race;
 LocalDatabase.prototype.readLedger=async function(){if(!new Error().stack?.split('\n')[2]?.includes('/src/app/training/SetRow.tsx'))return original.call(this);LocalDatabase.prototype.readLedger=original;race.waiting=true;await gate;return original.call(this);};
 LocalDatabase.prototype.enqueueCommand=async function(...args:Parameters<LocalDatabase['enqueueCommand']>){LocalDatabase.prototype.enqueueCommand=enqueue;const result=await enqueue.apply(this,args);race.preserved=args[1]?(await this.readDraft(args[1].id))?.rawFields.reps??null:null;return result;};
 const actions:Array<()=>Promise<unknown>>=[];window.dispatchEvent(new CustomEvent('lowkkey:commit-editing',{detail:actions}));race.saving=Promise.all(actions.map(action=>action()));
 });
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{race?:{waiting:boolean}}).race?.waiting)).toBe(true);
 await reps(row).fill('11');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect.poll(()=>page.evaluate(async owner=>{const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);const db=await LocalDatabase.open(owner);try{return(await db.listDrafts()).some((draft:{rawFields:Record<string,string>})=>draft.rawFields.reps==='11');}finally{db.close();}},ownerId)).toBe(true);
 expect(await page.evaluate(async()=>{const race=(window as typeof window&{race:{release:()=>void;saving:Promise<unknown>;preserved:string|null}}).race;race.release();await race.saving;return race.preserved;})).toBe('11');
 await expect(reps(row)).toHaveValue('11');await context.setOffline(false);await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();
 await expect.poll(async()=>(await readTrainingDay(page,date)).sets[0]?.reps).toBe(11);expect((await readTrainingDay(page,date)).sets).toHaveLength(1);
 await page.reload();await expect(reps(row)).toHaveValue('11');
});
test('a legacy session deep link opens its date without changing stored time or identity',async({page},info)=>{
 const locale=info.project.name,{date}=await trainingReady(page,locale,2017),card=await addExercise(page,locale),row=card.locator('[data-set-id]').first();
 await load(row).fill('110');await reps(row).fill('8');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);
 const before=await readTrainingDay(page,date);await page.goto('/training/sessions/'+before.sessions[0].id);await expect(page).toHaveURL(new RegExp('training\\?date='+date));await expect(page.locator('.daily-heading input')).toHaveValue(date);
 expect(await readTrainingDay(page,date)).toEqual(before);
});

test('unchanged rows stay unchanged and stale deletions require an explicit review',async({page},info)=>{
 const locale=info.project.name,text=trainingWords(locale),{date}=await trainingReady(page,locale,2018),card=await addExercise(page,locale);
 let row=card.locator('[data-set-id]').first();
 await load(row).fill('110');await reps(row).fill('10');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
 const original=await readTrainingDay(page,date);await reps(row).fill('9');await reps(row).fill('10');await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();expect((await readTrainingDay(page,date)).sessions[0].revision).toBe(original.sessions[0].revision);
 const remoteEdit=async()=>{await page.evaluate(async date=>{
 const day=(await(await fetch('/api/v1/training/days/'+date)).json()).data;
 const response=await fetch('/api/v1/training/days/'+date+'/'+day.sessions[0].id+'/sets/'+day.sets[0].id,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'If-Match':'"'+day.sessions[0].revision+'"'},body:JSON.stringify({expectedRevision:day.sets[0].revision,reps:9})});if(!response.ok)throw Error();
 },date);};
 await row.locator('.set-number').click();await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click();await remoteEdit();await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click();
 await expect(row.locator('.row-status')).toBeVisible();expect((await readTrainingDay(page,date)).sets[0].reps).toBe(9);
 await row.getByRole('button',{name:text.review,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(0);
 await card.locator('.add-set').click();row=card.locator('[data-set-id]').last();await load(row).fill('110');await reps(row).fill('10');await page.locator('.daily-heading h1').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(1);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
 await card.locator('.exercise-tools button').last().click();await remoteEdit();await page.getByRole('dialog').locator('button.danger').click();
 const problem=page.locator('[data-exercise-issue]');await expect(problem).toBeVisible();expect((await readTrainingDay(page,date)).sets[0].reps).toBe(9);
 await problem.getByRole('button').first().click();await page.getByRole('dialog').locator('button.danger').click();await expect.poll(async()=>(await readTrainingDay(page,date)).sets.length).toBe(0);await expect(problem).toHaveCount(0);
});
