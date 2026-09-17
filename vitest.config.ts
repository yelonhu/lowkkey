import { defineConfig } from 'vitest/config';
export default defineConfig({ cacheDir: '.cache/vitest', test: { api: false, ui: false, include: ['tests/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 30_000, maxWorkers: 1, reporters: ['default', 'json'], outputFile: { json: '.artifacts/m1/vitest.json' } } });
