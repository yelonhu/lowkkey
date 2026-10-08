import {expect,test} from '@playwright/test';

test('free recording needs no plan, preserves editing during SSE and syncs physical equipment',async({page,context},info)=>{
  await page.goto('/');await page.locator('.screen,.access-gate button').first().waitFor();
  const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  const before=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const write=async(path:string,body:unknown)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());},{path,body});
  try{
    await write('/v1/program',{...before.program,days:[]});await page.reload();
    expect(await page.evaluate(()=>getComputedStyle(document.body).position)).not.toBe('fixed');
    await expect(page.locator('.prototype-host')).toHaveCSS('transform','none');
    await expect(page.locator('html')).toHaveAttribute('data-viewport',/standalone/);
    await page.locator('[data-action="free-session"]').click();
    const picker=page.getByRole('dialog',{name:'动作清单'});await picker.getByRole('searchbox',{name:'搜索动作'}).fill('髋内收');
    await picker.getByRole('button',{name:/髋内收/}).click();
    const session=page.locator('[data-screen="Session"]');await expect(session).toBeVisible();
    await expect(session.getByRole('progressbar')).toBeHidden();await expect(session).not.toContainText('共 undefined');
    const weight=session.locator('[data-action="load-input"]'),reps=session.getByRole('spinbutton',{name:'本组次数'});
    await expect(weight).toHaveValue('');await expect(reps).toHaveValue('');
    await weight.fill('20');await expect(session.getByRole('button',{name:'请填写 1–100 的整数次数'})).toBeDisabled();
    await reps.fill('12');await session.getByRole('radio',{name:'2'}).click();
    // An unrelated remote preference change must leave the edited set intact.
    const current=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    await write('/v1/preferences/equipment',{equipment:current.equipment,expectedRevision:current.revision});
    await expect(weight).toHaveValue('20');await expect(reps).toHaveValue('12');await expect(session.getByRole('radio',{name:'2'})).toHaveAttribute('aria-checked','true');
    let writes=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/v1/entries',async route=>{writes++;await gate;await route.continue();});
    await session.getByRole('button',{name:'记录 20 kg × 12'}).click();await expect(reps).toHaveAttribute('readonly','');
    await session.locator('[data-action="complete-set"]').evaluate(el=>{(el as HTMLElement).click();(el as HTMLElement).click();});release();
    await expect(session.locator('[data-session-part="count"]')).toContainText('第 2 组');expect(writes).toBe(1);await page.unroute('**/v1/entries');
    await expect(session.getByRole('radio',{name:'2'})).toHaveAttribute('aria-checked','false');
    await session.getByRole('button',{name:'动作清单',exact:true}).click();await picker.getByRole('searchbox').fill('杠铃平板');await picker.getByRole('button',{name:/杠铃平板卧推/}).click();
    await weight.fill('125');await session.getByRole('button',{name:'杠铃与配片设置'}).click();
    const equipment=page.getByRole('dialog',{name:'杠铃与配片'});
    await equipment.getByRole('button',{name:/kg 杠铃/}).click();await equipment.getByRole('textbox',{name:'空杆重量（kg）'}).fill('20');await equipment.getByRole('textbox',{name:'可用片重（kg）'}).fill('20, 15, 10, 5, 2.5, 0.5');
    await equipment.getByRole('button',{name:'保存配置',exact:true}).click();await expect(equipment).toHaveCount(0);
    await expect(weight).toHaveValue('125');await expect(session.getByRole('button',{name:'杠铃与配片设置'})).toContainText(/每侧 .* kg/);
    await session.getByRole('button',{name:'重量单位 lb，点按切换'}).click();await expect(weight).toHaveValue('125');await expect(session.getByRole('button',{name:'杠铃与配片设置'})).toContainText(/每侧 .* kg/);
    await weight.fill('60');await expect(session).toContainText('每侧 20');
    const other=await context.newPage();await other.goto('/');await expect(other.locator('[data-screen="Main"]')).toBeVisible();
    expect((await other.evaluate(async()=>await (await fetch('/v1/state')).json())).equipment.activeBarbellUnit).toBe('kg');await other.close();
    await weight.blur();await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
    await session.screenshot({animations:'disabled',path:`.artifacts/playwright/${info.project.name}/free-training.png`});
    await session.locator('[data-action="end-session"]').click();await expect(page.locator('[data-screen="Debrief"]')).toContainText('20 kg × 12');
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    const start=state.entries.findLast((entry:{kind:string;event?:string})=>entry.kind==='session'&&entry.event==='start');
    expect(start.dayId).toBeNull();expect(start.prescription).toEqual([]);expect(state.program.days).toEqual([]);
    const set=state.entries.findLast((entry:{kind:string;exerciseId?:string})=>entry.kind==='set'&&entry.exerciseId==='hip_adduction');expect(set.rir).toBe(2);expect(set.recommendation).toBeUndefined();
  }finally{
    await write('/v1/program',before.program);
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    await write('/v1/preferences/equipment',{equipment:before.equipment,expectedRevision:state.revision});
  }
});

test('a reviewed set stays frozen across remote sets and a lost save response',async({page})=>{
  await page.goto('/');await page.locator('.screen,.access-gate button').first().waitFor();const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await expect(page.locator('[data-screen="Main"]')).toBeVisible();
  const before=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  try{
    await page.evaluate(async state=>{const r=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...state.program,days:[{id:'freeze',name:'上肢 A',weekday:new Date(`${state.today}T12:00:00Z`).getUTCDay(),items:[{exerciseId:'barbell_row',sets:3,repMin:5,repMax:8,startLoad:95}]}]})});if(!r.ok)throw new Error(await r.text());},before);
    await page.reload();await page.locator('[data-action="start-session"]').click();
    const board=page.locator('[data-screen="Session"]'),weight=board.locator('[data-action="load-input"]');
    await expect(weight).toHaveValue('95');await board.getByRole('spinbutton',{name:'本组次数'}).fill('7');await board.getByRole('radio',{name:'2'}).click();
    await page.evaluate(async()=>{
      const state=await (await fetch('/v1/state')).json(),start=state.entries.findLast((e:{kind:string;event?:string})=>e.kind==='session'&&e.event==='start');
      const r=await fetch('/v1/entries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({entries:[{kind:'set',sessionId:start.sessionId,exerciseId:'barbell_row',setIndex:1,load:90,unit:'lb',loadKind:'external',reps:6,rir:null,setRole:'work',date:state.today,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'}}]})});if(!r.ok)throw new Error(await r.text());
    });
    await expect(board.locator('[data-session-part="count"]')).toContainText('第 2 组');await expect(weight).toHaveValue('95');
    const requests:{key:string;body:string}[]=[];
    await page.route('**/v1/entries',async route=>{requests.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()!});if(requests.length===1){await route.fetch();await route.abort('failed');}else await route.continue();});
    await board.getByRole('button',{name:'记录 95 lb × 7'}).click();await expect(page.getByRole('status')).toContainText('暂未确认');
    await expect(board.getByRole('spinbutton',{name:'本组次数'})).toHaveValue('7');await expect(board.getByRole('radio',{name:'2'})).toHaveAttribute('aria-checked','true');
    await page.getByRole('button',{name:'重试',exact:true}).click();await expect(weight).toHaveValue('95');await expect(board.getByRole('radio',{name:'2'})).toHaveAttribute('aria-checked','false');
    expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    const saved=state.entries.filter((e:{kind:string;exerciseId?:string;load?:number})=>e.kind==='set'&&e.exerciseId==='barbell_row'&&e.load===95);expect(saved).toHaveLength(1);expect(saved[0].inputReference.load).toBe(95);
    await page.unroute('**/v1/entries');await board.locator('[data-action="end-session"]').click();
  }finally{await page.unroute('**/v1/entries');await page.evaluate(async program=>{await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(program)});},before.program);}
});
