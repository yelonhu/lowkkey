import {test,expect,type Page} from '@playwright/test';

async function enter(page:Page){
  await page.goto('/');await page.locator('.screen,.access-gate button').first().waitFor();
  const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await expect(page.locator('[data-screen="Main"]')).toBeVisible();
}
const snapshot=(page:Page)=>page.evaluate(async()=>await (await fetch('/v1/state')).json());
async function program(page:Page,value:unknown){await page.evaluate(async value=>{const r=await fetch('/v1/program',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});if(!r.ok)throw new Error(await r.text());},value);}

test('authorized empty state stays usable without setup prompts or developer controls',async({page})=>{
  await enter(page);const before=await snapshot(page);
  await page.route('**/v1/state',async route=>{const response=await route.fetch(),value=await response.json();value.program.days=[];value.entries=[];value.proposals=[];value.submissions=[];value.held=[];value.derived={};value.clients=[{id:'fixture-client',name:'测试授权客户端',status:'active',scopes:['read','propose'],createdAt:new Date().toISOString()}];await route.fulfill({response,json:value});});
  const mutations:string[]=[];page.on('request',r=>{if(['POST','PUT','DELETE'].includes(r.method()))mutations.push(r.url());});
  await page.reload();const main=page.locator('[data-screen="Main"]');
  await expect(main).toContainText('体重或训练，记一条就好。');
  await expect(main).not.toContainText('连接 AI');await expect(main).not.toContainText('准备训练计划');
  await expect(main.getByLabel('今天发生了什么？')).toBeEnabled();
  await page.getByRole('link',{name:'接入',exact:true}).click();const connect=page.locator('[data-screen="Connect"]');
  await expect(connect).toContainText('测试授权客户端');await expect(connect).toContainText('读取状态与记录、提出计划调整');
  await expect(connect).not.toContainText('MCP');await expect(connect).not.toContainText('get_state');await expect(connect).not.toContainText('在线');
  expect(mutations).toEqual([]);
  await page.unroute('**/v1/state');expect((await snapshot(page)).revision).toBe(before.revision);
});

test('optional training uses an explicit exercise list, next exercise and explicit extra set',async({page})=>{
  await enter(page);const before=await snapshot(page),weekday=new Date(`${before.today}T12:00:00Z`).getUTCDay();
  try{
    await program(page,{...before.program,days:[{id:'optional',name:'胸 / 背 · 自己的安排',weekday,items:[{exerciseId:'bench_press',sets:1,repMin:5,repMax:8,startLoad:95},{exerciseId:'seated_row',sets:1,repMin:8,repMax:12,startLoad:30}]}]});
    await page.reload();await expect(page.locator('[data-bind="main-plan"]')).toContainText('杠铃平板卧推');
    await page.locator('[data-action="start-session"]').click();const session=page.locator('[data-screen="Session"]');
    // Editing the weekly plan on another device must not rewrite this session.
    await program(page,{...before.program,days:[]});
    await expect.poll(async()=>(await snapshot(page)).program.days.length).toBe(0);
    await session.getByRole('button',{name:'动作清单',exact:true}).click();const list=page.getByRole('dialog',{name:'动作清单'});
    await expect(list).toContainText('正式组 0 / 1');await list.getByRole('button',{name:/坐姿绳索划船/}).click();await expect(list).toHaveCount(0);
    await session.getByRole('button',{name:/^记录 .* × /}).click();
    await expect(session.getByRole('button',{name:'下一个动作：杠铃平板卧推'})).toBeVisible();
    await expect(session.locator('[data-action="complete-set"]')).toHaveCount(0);
    const count=(await snapshot(page)).entries.filter((e:{kind:string})=>e.kind==='set').length;
    await session.getByRole('button',{name:'再记一组',exact:true}).click();
    expect((await snapshot(page)).entries.filter((e:{kind:string})=>e.kind==='set')).toHaveLength(count);
    await session.getByRole('button',{name:/^记录 .* × /}).click();await expect(session).toContainText('已记录 2 组正式组');
    await session.getByRole('button',{name:'下一个动作：杠铃平板卧推'}).click();
    await session.getByRole('button',{name:/^记录 .* × /}).click();
    await expect(session.getByRole('button',{name:'结束本次训练',exact:true})).toBeVisible();
    await session.getByRole('button',{name:'结束本次训练',exact:true}).click();await expect(page.locator('[data-screen="Debrief"]')).toContainText('2 个动作 · 3 组');
  }finally{await program(page,before.program);}
});

test('custom long plans remain readable, cycles stay collapsed and stale review requires reconfirmation',async({page})=>{
  await enter(page);const before=await snapshot(page);
  try{
    await program(page,{...before.program,cycleStart:before.today,ramp:[{week:1,label:'个人恢复阶段',setMultiplier:.8,targetRir:3}],days:Array.from({length:4},(_,index)=>({id:`custom_${index}`,name:['胸','背','肩','腿'][index]+' · 这是用户在对话里确定的长名称',weekday:index,items:[{exerciseId:'bench_press',sets:3,repMin:5,repMax:8,startLoad:null},{exerciseId:'seated_row',sets:3,repMin:8,repMax:12,startLoad:30,note:'由用户与 AI 确定的动作备注'}]}))});
    await page.reload();await page.getByRole('button',{name:'查看动作安排'}).click();const sheet=page.getByRole('dialog');
    await expect(sheet).toContainText('由用户与 AI 确定的动作备注');await expect(sheet).not.toContainText('个人恢复阶段');await expect(sheet.getByRole('button',{name:/周期安排/})).toHaveCount(0);
    for(const width of [375,390,393,402,430,440]){await page.setViewportSize({width,height:844});expect(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await sheet.locator('.plan-detail-row').evaluateAll(rows=>rows.every(row=>row.scrollHeight<=row.clientHeight+1))).toBe(true);}
    await page.keyboard.press('Escape');
    const id=await page.evaluate(async()=>{const r=await fetch('/v1/proposals',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({kind:'program_change',title:'等待重新确认的调整',rationale:'确认后生效',patch:{constraints:[]}})});if(!r.ok)throw new Error(await r.text());return (await r.json()).id;});
    await page.goto('/#Ledger');await page.getByText('等待重新确认的调整',{exact:true}).click();
    await page.evaluate(async()=>{const state=await (await fetch('/v1/state')).json();const r=await fetch('/v1/entries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({entries:[{kind:'note',date:state.today,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'},text:'审阅时另一设备更新记录',confidence:1}]})});if(!r.ok)throw new Error(await r.text());});
    await expect(sheet.getByRole('button',{name:'采用',exact:true})).toHaveAttribute('aria-disabled','true');
    await sheet.getByRole('button',{name:'已核对，重新确认'}).click();await expect(sheet.getByRole('button',{name:'采用',exact:true})).not.toHaveAttribute('aria-disabled','true');
    await sheet.getByRole('button',{name:'以后',exact:true}).click();await expect(sheet).toHaveCount(0);
    const after=await snapshot(page);expect(after.proposals.find((p:{id:string})=>p.id===id).status).toBe('open');
    await page.evaluate(async({id,revision})=>{const r=await fetch(`/v1/proposals/${id}/decision`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({decision:'reject',expectedRevision:revision})});if(!r.ok)throw new Error(await r.text());},{id,revision:after.revision});
  }finally{await program(page,before.program);}
});
