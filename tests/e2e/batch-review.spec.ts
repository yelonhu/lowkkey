import { expect, test } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

test('a model batch stays pending until the user writes all five rows',async({page})=>{
  await page.goto('/');const login=page.getByRole('button',{name:'进入状态舱'});if(await login.isVisible())await login.click();
  await page.locator('.screen[data-screen="Main"]').waitFor();
  const origin=new URL(page.url()).origin;
  for(let i=0;i<10;i++){
    const state=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
    if(!state.submissions.length)break;
    await page.evaluate(async({id,revision})=>{const response=await fetch(`/v1/submissions/${id}/decision`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({decision:'skip',expectedRevision:revision})});if(!response.ok)throw new Error(await response.text());},{id:state.submissions[0].id,revision:state.revision});
  }
  const before=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  const redirect='http://127.0.0.1:45678/callback';
  const registered=await (await page.request.post(`${origin}/oauth/register`,{data:{client_name:'Browser Batch Test',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'}})).json();
  const verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const query=new URLSearchParams({response_type:'code',client_id:registered.client_id,redirect_uri:redirect,scope:'submit',code_challenge:challenge,code_challenge_method:'S256',state:'batch-browser',resource:`${origin}/mcp`});
  await page.route(`${redirect}**`,route=>route.fulfill({status:200,body:'authorized'}));
  await page.goto(`${origin}/authorize?${query}`);
  await page.getByRole('button',{name:'授权'}).click();
  await page.waitForURL(`${redirect}**`);
  const code=new URL(page.url()).searchParams.get('code');expect(code).toBeTruthy();
  const token=await (await page.request.post(`${origin}/oauth/token`,{form:{grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:redirect,code:code!,code_verifier:verifier,resource:`${origin}/mcp`}})).json();
  expect(token.access_token).toBeTruthy();
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find(item=>item.type===type)!.value,localDate=`${part('year')}-${part('month')}-${part('day')}`;
  const rawText=`五条浏览器待审备注 ${randomUUID()}`;
  const entries=Array.from({length:5},(_,index)=>({kind:'note',date:localDate,dateOrigin:'device',source:{actor:'model',channel:'mcp',client:'browser'},text:`浏览器待审记录 ${index+1}`,confidence:0.99}));
  const rpc=async(id:number,method:string,params:unknown)=>{
    const response=await fetch(`${origin}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
    expect(response.status).toBe(200);const body=await response.text();return body.startsWith('event:')?JSON.parse(body.match(/data: (\{[^\n]+\})/)?.[1]??'{}'):JSON.parse(body);
  };
  await rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'browser-test',version:'1'}});
  const proposed=await rpc(2,'tools/call',{name:'propose_entries',arguments:{idempotencyKey:randomUUID(),rawText,capturedAt:new Date().toISOString(),capturedLocalDate:localDate,timeZone:'America/Chicago',entries}});
  expect(proposed.result.structuredContent.result.drafts).toHaveLength(5);
  await page.goto('/#Main');await page.locator('.screen[data-screen="Main"]').waitFor();
  const pending=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  expect(pending.entries).toHaveLength(before.entries.length);
  await page.locator('[data-action="view-pending"]').click();
  const dialog=page.getByRole('dialog',{name:'确认'});await expect(dialog).toContainText('待写入 5 项');
  await dialog.locator('[data-action="submission-accept"]').click();
  await expect(page.locator('.screen[data-screen="Main"]')).toBeVisible();
  const after=await page.evaluate(async()=>await (await fetch('/v1/state')).json());
  expect(after.entries.filter((entry:{source:{rawText?:string}})=>entry.source.rawText===rawText)).toHaveLength(5);
  await page.goto('/#Connect');
  const connection=page.locator('.screen[data-screen="Connect"] [data-action="client-revoke"]').filter({hasText:'Browser Batch Test'});
  await expect(connection).toBeVisible();
  await connection.click();
  await expect(page.locator('.screen[data-screen="Connect"]')).toContainText('已撤销');
  const revoked=await fetch(`${origin}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list',params:{}})});
  expect(revoked.status).toBe(401);
});
