import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve('.toolchain/browsers');
const chrome=process.platform==='darwin'&&existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
export default defineConfig({
  testDir:'./tests/e2e',outputDir:'.artifacts/playwright',workers:1,
  use:{ignoreHTTPSErrors:true,locale:'zh-CN',viewport:{width:390,height:844},trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{browserName:'chromium',baseURL:'https://127.0.0.1:5174',...(chrome?{launchOptions:{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}}:{})}},
    {name:'webkit',use:{browserName:'webkit',baseURL:'https://127.0.0.1:5175',isMobile:true,hasTouch:true}},
  ],
  // Each engine gets a fresh database, including when both projects run together.
  webServer:[...[5174,5175].map(port=>({command:'node scripts/serve.mjs --e2e',env:{LOWKKEY_E2E_PORT:String(port),LOWKKEY_E2E_TLS:'1'},url:`https://127.0.0.1:${port}/healthz`,ignoreHTTPSErrors:true,reuseExistingServer:false,timeout:45000}))],
});
