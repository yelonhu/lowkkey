import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e', outputDir: '.artifacts/playwright', workers: 1,
  use: { ...(process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } } : {}), baseURL: 'http://127.0.0.1:5174', locale: 'zh-CN', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve.mjs --e2e', url: 'http://127.0.0.1:5174/healthz', reuseExistingServer: !process.env.CI, timeout: 45_000 },
});
