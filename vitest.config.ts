import { defineConfig } from 'vitest/config';
export default defineConfig({ cacheDir: '.cache/vitest', test: { api: false, ui: false, include: ['tests/**/*.test.ts','packages/core/test/**/*.test.ts'], maxWorkers: 1 } });
