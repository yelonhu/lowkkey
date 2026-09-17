import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', outputDir: '.artifacts/playwright', workers: 1, retries: 0,
  reporter: [['list'], ['json', { outputFile: '.artifacts/playwright-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'zh-Hans', use: { locale: 'zh-CN' } }, { name: 'zh-Hant', use: { locale: 'zh-TW' } }, { name: 'en', use: { locale: 'en-US' } }],
  // Match verify:dev: local Worker startup measured 29.7s, before health polling.
  webServer: { command: 'node scripts/serve.mjs --e2e', url: 'http://127.0.0.1:5173/healthz', reuseExistingServer: false, stdout: 'pipe', timeout: 45_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
});
