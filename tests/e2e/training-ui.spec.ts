import { test, expect, openWorkspace } from './fixtures.ts';
import type { Page, Locator } from '@playwright/test';
import type { LocalDatabase } from '../../src/client/local-database.ts';
import { trainingLocale } from '../../src/i18n/training-resources.ts';
const copy = (locale: string) => trainingLocale(locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2);
const bench = 'bdeba6ce-c5ba-4a1b-9910-000000000004';
async function ready(page: Page, locale: string) {
  const account = await openWorkspace(page, locale, '/training');
  await page.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()).data;
    const headers = () => ({ 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() });
    const pref = await fetch('/api/v1/me', { method: 'PATCH', headers: { ...headers(), 'If-Match': '"' + me.profile.revision + '"' }, body: JSON.stringify({ defaultLoadUnit: 'lb' }) }); if (!pref.ok) throw Error('Preference failed');
    const setups = (await (await fetch('/api/v1/exercise-setups?limit=100')).json()).data.items;
    for (const setup of setups.filter((item: {exerciseId: string; loadUnit: string}) => item.exerciseId === 'bdeba6ce-c5ba-4a1b-9910-000000000004' && item.loadUnit !== 'lb')) {
      const response = await fetch('/api/v1/exercise-setups/' + setup.id, {method: 'PATCH', headers: {...headers(), 'If-Match': '"' + setup.revision + '"'}, body: JSON.stringify({loadUnit:'lb'})}); if (!response.ok) throw Error('Fixture setup unit failed');
    }
    const list = (await (await fetch('/api/v1/training/sessions?status=in_progress')).json()).data;
    for (const row of list.items ?? []) {
      const response = await fetch('/api/v1/training/sessions/' + row.id + '/pause', { method: 'POST', headers: { ...headers(), 'If-Match': '"' + row.revision + '"' }, body: '{}' }); if (!response.ok) throw Error('Pause failed');
    }
  });
  await page.reload(); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  await page.getByRole('button', { name: copy(locale).start, exact: true }).click();
  await expect(page.locator('.training-session')).toBeVisible();
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  return { ...account, sessionId: (await page.locator('.training-session').getAttribute('data-session-id'))! };
}
async function add(page: Page, locale: string, id = bench) {
  await page.locator('.add-exercise').click();
  const labels = { [bench]: ['Barbell bench press', '杠铃平板卧推', '槓鈴平板臥推'], 'bdeba6ce-c5ba-4a1b-9910-000000000005': ['Incline dumbbell press', '哑铃上斜卧推', '啞鈴上斜臥推'] };
  const index = locale === 'en' ? 0 : locale === 'zh-Hans' ? 1 : 2;
  await page.getByRole('dialog').locator('.exercise-choice').filter({ hasText: labels[id as keyof typeof labels][index] }).click();
  const card = page.locator('.training-exercise').last(); await expect(card.locator('.set-row-wrap')).toHaveCount(1);
  await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  return card;
}
async function tree(page: Page, id: string) { return page.evaluate(async id => (await (await fetch('/api/v1/training/sessions/' + id + '?limit=100')).json()).data, id); }
async function factCount(page: Page, id: string) { return (await tree(page, id)).items.filter((item: {type: string}) => item.type === 'workout_set').length; }
const load = (row: Locator) => row.locator('.row-load input');
const reps = (row: Locator) => row.locator('[role=cell]').nth(2).locator('input');
const rpe = (row: Locator) => row.locator('[role=cell]').nth(3).locator('input');
async function finish(page: Page, locale: string) {
  await page.getByRole('button', { name: copy(locale).finish, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect.poll(async () => (await dialog.isVisible()) || ((await page.locator('.training-session').getAttribute('data-session-state')) ?? '').startsWith('completed')).toBe(true);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: copy(locale).keepAndFinish }).click();
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', /completed/);
}
test('row exit records once; editing within a row and background events only preserve drafts', async ({ page, context }, info) => {
  const locale = info.project.name, { sessionId } = await ready(page, locale), card = await add(page, locale), row = card.locator('[data-set-id]').first();
  await load(row).fill('１１０．'); await page.locator('.chat-button').click(); await page.locator('.conversation .back-link').click(); await expect(page).toHaveURL(/\/training\/sessions\//); await expect(load(row)).toBeVisible(); await page.reload();
  await expect(load(row)).toHaveValue('１１０．');
  await load(row).fill('110'); await reps(row).fill('1'); await rpe(row).focus();
  expect(await factCount(page, sessionId)).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await factCount(page, sessionId)).toBe(0);
  await reps(row).fill('10'); await context.setOffline(true);
  await card.locator('.add-set').click();
  await expect(card.locator('[data-recorded=true]')).toHaveCount(1); await expect(card.locator('[data-set-id]')).toHaveCount(2);
  const second = card.locator('[data-set-id]').last(); await expect(load(second)).toHaveValue('110'); await expect(reps(second)).toHaveValue(''); await expect(rpe(second)).toHaveValue('');
  await reps(second).fill('8'); await finish(page, locale);
  await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed_pending_sync');
  await context.setOffline(false); await expect(page.locator('.training-session')).toHaveAttribute('data-session-state', 'completed'); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const data = await tree(page, sessionId), sets = data.items.filter((item: {type: string}) => item.type === 'workout_set').map((item: {value: unknown}) => item.value);
  expect(sets).toHaveLength(2); expect(sets).toEqual(expect.arrayContaining([expect.objectContaining({ reps: 10, loadDecimal: '110', unit: 'lb', kgMicros: 49_895_161, rpeHalfUnits: null, setType: 'unknown' }), expect.objectContaining({ reps: 8 })]));
  expect(data.items.find((item: {type: string}) => item.type === 'session_exercise').value.displaySnapshot).toMatchObject({ includesBar: true, barWeightDecimal: '45', barUnit: 'lb', defaultsOrigin: { ruleVersion: 'training-defaults-v1' } });
  await page.screenshot({ path: info.outputPath('training-completed.png'), fullPage: true });
});
test('autosave preserves conflicting edits; deleting requires an explicit action', async ({ page }, info) => {
  const locale = info.project.name, text = copy(locale), { sessionId } = await ready(page, locale), card = await add(page, locale), row = card.locator('[data-set-id]').first();
  await load(row).fill('110'); await reps(row).fill('10'); await card.locator('.exercise-heading').click();
  await expect.poll(() => factCount(page, sessionId)).toBe(1);
  const setId = (await row.getAttribute('data-set-id'))!;
  await reps(row).fill('8');
  await page.evaluate(async ({sessionId,setId}) => {
    const data = (await (await fetch('/api/v1/training/sessions/' + sessionId)).json()).data, record = data.items.find((item: {id:string}) => item.id === setId).value;
    const response = await fetch('/api/v1/training/sessions/' + sessionId + '/sets/' + setId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"' + data.session.revision + '"' }, body: JSON.stringify({ expectedRevision: record.revision, reps: 9 }) }); if (!response.ok) throw Error('Concurrent edit failed');
  }, {sessionId,setId});
  await card.locator('.exercise-heading').click();
  await expect(page.locator('[data-command-state=conflict]')).toHaveCount(1); await page.locator('.app-footer button').click();
  await expect(reps(row)).toHaveValue('8');
  await row.getByRole('button', {name:text.review}).click(); await page.getByRole('dialog').getByRole('button', {name:text.applyEdit}).click();
  await expect(page.locator('[data-command-state=conflict]')).toHaveCount(0); await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  expect((await tree(page,sessionId)).items.find((item:{id:string})=>item.id===setId).value.reps).toBe(8);
  await reps(row).fill(''); await card.locator('.exercise-heading').click(); expect(await factCount(page,sessionId)).toBe(1);
  await reps(row).fill('8'); await card.locator('.add-set').click(); await expect(card.locator('[data-set-id]')).toHaveCount(2); const second=card.locator('[data-set-id]').last();
  await load(second).fill('95'); await reps(second).fill('10'); await card.locator('.exercise-heading').click(); await expect.poll(()=>factCount(page,sessionId)).toBe(2);
  await second.locator('.set-number').click(); await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click(); await page.getByRole('dialog').getByRole('button',{name:text.remove,exact:true}).click();
  await expect.poll(()=>factCount(page,sessionId)).toBe(1);
  await page.locator('.session-options summary').click(); await page.getByRole('button',{name:text.pause,exact:true}).click(); await expect(page.locator('.training-session')).toHaveAttribute('data-session-state','paused');
  await page.getByRole('button',{name:text.resume,exact:true}).click(); await expect(page.locator('.training-session')).toHaveAttribute('data-session-state','in_progress');
  await page.getByRole('button',{name:text.cancelWorkout,exact:true}).click(); await expect(page.getByRole('dialog')).toContainText(text.cancelHasSets);
  await page.getByRole('dialog').getByRole('button',{name:text.keepAndFinish}).click(); await expect(page.locator('.training-session')).toHaveAttribute('data-session-state',/completed/);
});
test('same-setup reference stays unrecorded; display unit changes keep old loads and bar metadata', async ({page}, info)=>{
  const locale=info.project.name,text=copy(locale),{sessionId:first}=await ready(page,locale),card=await add(page,locale),row=card.locator('[data-set-id]').first();
  await load(row).fill('110');await reps(row).fill('10');await card.locator('.add-set').click();await expect(card.locator('[data-set-id]')).toHaveCount(2);
  await finish(page,locale);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();await expect(card.locator('[data-set-id]')).toHaveCount(1);
  const firstTree=await tree(page,first),setupId=firstTree.items.find((item:{type:string})=>item.type==='session_exercise').value.setupId;
  const {sessionId:second}=await ready(page,locale),next=await add(page,locale);
  await expect(next.locator('.training-reference')).toContainText('110');await expect(load(next.locator('[data-set-id]').first())).toHaveValue('');await expect(reps(next.locator('[data-set-id]').first())).toHaveValue('');
  expect(await factCount(page,second)).toBe(0);
  await next.locator('.setup-chip').click();await page.getByRole('dialog').getByLabel(text.unit,{exact:true}).selectOption('kg');await page.getByRole('dialog').getByRole('button',{name:text.applySetup}).click();
  await expect(next.locator('.setup-chip')).toContainText('kg');
  const empty=next.locator('[data-set-id]').first();await load(empty).fill('50');await reps(empty).fill('8');await finish(page,locale);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const setup=await page.evaluate(async id=>(await(await fetch('/api/v1/exercise-setups?limit=100')).json()).data.items.find((item:{id:string})=>item.id===id),setupId);
  expect(setup).toMatchObject({loadUnit:'kg',barWeightDecimal:'45',barUnit:'lb'});
  expect((await tree(page,first)).items.find((item:{type:string})=>item.type==='workout_set').value).toMatchObject({loadDecimal:'110',unit:'lb',kgMicros:49_895_161});
});
test('per-side defaults and explicit custom bodyweight retain unknown effort and type', async ({page},info)=>{
  const locale=info.project.name,text=copy(locale),{sessionId}=await ready(page,locale),card=await add(page,locale,'bdeba6ce-c5ba-4a1b-9910-000000000005');
  const row=card.locator('[data-set-id]').first();await load(row).fill('35');await reps(row).fill('10');await card.locator('.exercise-heading').click();await expect.poll(()=>factCount(page,sessionId)).toBe(1);
  await page.locator('.add-exercise').click();await page.getByRole('dialog').getByRole('button',{name:text.custom}).click();await page.getByRole('dialog').getByLabel(text.customName).fill('Personal bodyweight');
  await page.getByRole('dialog').getByRole('button',{name:text.addExercise,exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.training-exercise')).toHaveCount(2);
  const body=page.locator('.training-exercise').last();await body.locator('.setup-chip').click();await page.getByRole('dialog').locator('summary').click();await page.getByRole('dialog').getByLabel(text.semantics).selectOption('bodyweight_only');await page.getByRole('dialog').getByRole('button',{name:text.applySetup}).click();
  const current=page.locator('.training-exercise').last();await expect(current.locator('.row-load input')).toHaveCount(0);await reps(current.locator('[data-set-id]').first()).fill('12');await finish(page,locale);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const values=(await tree(page,sessionId)).items.filter((item:{type:string})=>item.type==='workout_set').map((item:{value:unknown})=>item.value);
  expect(values).toEqual(expect.arrayContaining([expect.objectContaining({loadDecimal:'35',unit:'lb',kgMicros:15_875_733,loadSemantics:'per_side',rpeHalfUnits:null,setType:'unknown'}),expect.objectContaining({loadDecimal:null,unit:null,kgMicros:null,reps:12})]));
});
test('bento cards and compact rows stay reachable in three locales, themes and narrow viewports',async({page},info)=>{
  const locale=info.project.name,{sessionId}=await ready(page,locale),card=await add(page,locale);
  const row=card.locator('[data-set-id]').first();await load(row).fill('1000');await reps(row).fill('200');await rpe(row).fill('8.5');await card.locator('.exercise-heading').click();await expect.poll(()=>factCount(page,sessionId)).toBe(1);
  for(const colorScheme of ['light','dark'] as const) for(const width of [320,375,430,1024]){
    await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await page.setViewportSize({width,height:667});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const hit=await row.locator('.set-number').boundingBox();expect(hit!.width).toBeGreaterThanOrEqual(44);expect(hit!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:info.outputPath('training-'+colorScheme+'-'+width+'.png'),fullPage:true});
  }
  await expect.poll(()=>page.evaluate(()=>document.fonts.check('16px "JetBrains Mono"'))).toBe(true);
  await page.locator('.brand').click();await page.setViewportSize({width:375,height:667});await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('.artifact-card')).toHaveCount(3);expect((await page.locator('.artifact-card').last().boundingBox())!.y+(await page.locator('.artifact-card').last().boundingBox())!.height).toBeLessThanOrEqual(667);
  expect(await page.locator('.artifact-card button').count()).toBe(0);
  await page.screenshot({path:info.outputPath('today-light-375.png'),fullPage:true});
  await page.locator('[data-artifact=SessionArtifact]').click();await expect(page.locator('.training-session')).toBeVisible();
  await finish(page,locale);
});

test('legacy half-filled rows and multiple independent drafts survive reload and language changes', async ({page},info)=>{
  const locale=info.project.name,{sessionId,ownerId,localDate,timezone}=await ready(page,locale),card=await add(page,locale);
  const exerciseId=(await card.getAttribute('data-exercise-id'))!;
  await page.evaluate(async ({sessionId,exerciseId,ownerId,localDate,timezone})=>{
    const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);const db=await LocalDatabase.open(ownerId);
    const tree=(await(await fetch('/api/v1/training/sessions/'+sessionId)).json()).data;
    await db.saveDraft({id:'training:'+sessionId+':'+exerciseId+':set',ownerId,kind:'set',rawFields:{load:'７５．',unit:'lb',reps:'',rpe:'',setType:'unknown',note:'',targetId:'',rootBinding:JSON.stringify({type:'workout_session',id:sessionId,source:{kind:'observed',revision:tree.session.revision}}),targetBinding:''},baseRefs:[],localDate,entryTimezone:timezone,updatedAt:new Date().toISOString()});db.close();
  },{sessionId,exerciseId,ownerId,localDate,timezone});
  await page.reload();const row=card.locator('[data-set-id]').first();await expect(load(row)).toHaveValue('７５．');expect(await factCount(page,sessionId)).toBe(0);
  await load(row).fill('110');await reps(row).fill('10');await card.locator('.add-set').click();await expect(card.locator('[data-set-id]')).toHaveCount(2);
  const second=card.locator('[data-set-id]').last(), secondId=(await second.getAttribute('data-set-id'))!;
  await load(second).fill('95');await page.locator('.chat-button').click();await expect(page).toHaveURL(/assistant/);await page.locator('.conversation .back-link').click();await expect(page).toHaveURL(/training\/sessions/);
  await page.reload();await expect(card.locator('[data-set-id]')).toHaveCount(2);await expect(load(card.locator('[data-set-id="'+secondId+'"]'))).toHaveValue('95');expect(await factCount(page,sessionId)).toBe(1);
  const next=locale==='en'?'zh-Hans':'en';await page.getByTestId('language').selectOption(next);await expect(page.locator('html')).toHaveAttribute('lang',next);await expect(load(second)).toHaveValue('95');await page.getByTestId('language').selectOption(locale);
  await reps(row).fill('8');await card.locator('.exercise-heading').click();await expect.poll(async()=>(await tree(page,sessionId)).items.filter((item:{type:string})=>item.type==='workout_set').map((item:{value:{reps:number}})=>item.value.reps)).toEqual([8]);
  await finish(page,locale);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();expect(await factCount(page,sessionId)).toBe(1);
});

test('a slow row save consumes only its submitted draft and retains newer input', async ({page,context},info)=>{
  const locale=info.project.name,{sessionId,ownerId}=await ready(page,locale),card=await add(page,locale),row=card.locator('[data-set-id]').first();
  await load(row).fill('110');await reps(row).fill('10');await context.setOffline(true);
  // Hold a real local ledger read so the user can edit while an earlier save is in flight.
  await page.evaluate(async()=>{
    const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);
    const state=window as typeof window & {rowRace?:{waiting:boolean;release:()=>void;saving:Promise<unknown>;preserved:string|null;diagnostic?:unknown}};
    let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    const originalRead=LocalDatabase.prototype.readLedger,originalEnqueue=LocalDatabase.prototype.enqueueCommand;
    const race={waiting:false,release,saving:Promise.resolve() as Promise<unknown>,preserved:null as string|null,diagnostic:undefined as unknown};state.rowRace=race;
    LocalDatabase.prototype.readLedger=async function(){
      if (!new Error().stack?.split('\n')[2]?.includes('/src/app/training/SetRow.tsx')) return originalRead.call(this);
      LocalDatabase.prototype.readLedger=originalRead;race.waiting=true;await gate;return originalRead.call(this);
    };
    LocalDatabase.prototype.enqueueCommand=async function(...args:Parameters<LocalDatabase['enqueueCommand']>){
      LocalDatabase.prototype.enqueueCommand=originalEnqueue;const before=args[1] ? await this.readDraft(args[1].id) : null;const result=await originalEnqueue.apply(this,args);
      race.diagnostic={token:args[1],before,command:args[0]};
      race.preserved=args[1] ? (await this.readDraft(args[1].id))?.rawFields.reps ?? null : null;return result;
    };
    const actions:Array<()=>Promise<unknown>>=[];window.dispatchEvent(new CustomEvent('lowkkey:commit-training',{detail:actions}));
    race.saving=Promise.all(actions.map(action=>action()));
  });
  await expect.poll(()=>page.evaluate(()=>(window as typeof window & {rowRace?:{waiting:boolean}}).rowRace?.waiting)).toBe(true);
  await reps(row).fill('11');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  const id=(await row.getAttribute('data-set-id'))!;
  await expect.poll(()=>page.evaluate(async({ownerId,id})=>{
    const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);const db=await LocalDatabase.open(ownerId);
    try{return (await db.listDrafts()).find((draft:{rawFields:Record<string,string>})=>draft.rawFields.rowId===id)?.rawFields.reps;}finally{db.close();}
  },{ownerId,id})).toBe('11');
  const evidence=await page.evaluate(async()=>{
    const race=(window as typeof window & {rowRace:{release:()=>void;saving:Promise<unknown>;preserved:string|null;diagnostic?:unknown}}).rowRace;
    race.release();await race.saving;return {preserved:race.preserved,diagnostic:race.diagnostic};
  });expect(evidence.preserved,JSON.stringify(evidence)).toBe('11');
  await expect(reps(row)).toHaveValue('11');
  await context.setOffline(false);await page.locator('.chat-button').click();await page.locator('.conversation .back-link').click();
  await expect(page).toHaveURL(/\/training\/sessions\//);await page.reload();await expect(reps(row)).toHaveValue('11');
  await expect.poll(()=>factCount(page,sessionId)).toBe(1);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
  const data=await tree(page,sessionId);expect(data.items.find((item:{type:string})=>item.type==='workout_set').value.reps).toBe(11);
  await page.goto('/today');await expect(page.locator('[data-artifact]')).toHaveCount(3);await page.locator('[data-artifact=SessionArtifact]').click();
  await finish(page,locale);await expect(page.locator('[data-sync-state=synced]')).toBeVisible();
});
