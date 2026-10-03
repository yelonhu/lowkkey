import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('MCP card shows structured plans and opens the user-only review page',async({page})=>{
  const html=await readFile('src/server/review-app.html','utf8');
  await page.setContent('<iframe title="训练卡片"></iframe><output id="opened"></output>');
  await page.evaluate(html=>{
    const frame=document.querySelector('iframe')!;
    window.addEventListener('message',event=>{
      const message=event.data;if(event.source!==frame.contentWindow||!message.id)return;
      frame.contentWindow!.postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');
      if(message.method==='ui/initialize')frame.contentWindow!.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{result:{kind:'proposal',id:'p-card',status:'open',reviewUrl:'https://example.com/#Main?review=proposal&id=p-card',exercises:[{id:'personal',name:'个人划船'}],item:{title:'周三安排',patch:{days:[{name:'背部训练',items:[{exerciseId:'personal',sets:3,repMin:8,repMax:12}]}]}}}}}},'*');
      if(message.method==='ui/open-link')document.querySelector('output')!.textContent=message.params.url;
    });frame.srcdoc=html;
  },html);
  const card=page.frameLocator('iframe');await expect(card.locator('#state')).toHaveText('周三安排');
  await card.locator('summary').click();await expect(card.locator('#details')).toContainText('个人划船 · 3 组 × 8–12 次');
  await card.getByRole('button',{name:'查看并确认'}).click();await expect(page.locator('output')).toContainText('review=proposal&id=p-card');
});
