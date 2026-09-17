import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { parseLocalConfig, publicConfig } from './src/server/config.ts';
import { uuidSchema } from './src/domain/primitives.ts';
import { localRestoreEpoch } from './scripts/runtime-state.mjs';
import path from 'node:path';

const privateFiles: Plugin = {
  name: 'veyra-private-files', enforce: 'pre',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname); }
      catch { response.statusCode = 400; response.end('Invalid path'); return; }
      if (pathname.split('/').some(part => /^\.env(?:\.|$)/.test(part) || ['.dev.vars', '.git', '.data', '.logs', '.local', '.toolchain', '.tmp', '.artifacts'].includes(part))) {
        response.statusCode = 404; response.setHeader('Cache-Control', 'no-store'); response.end('Unavailable'); return;
      }
      next();
    });
  },
};

export default defineConfig(({ command, mode }) => {
  const config = parseLocalConfig(process.env);
  const testRunId = mode === 'test' && command === 'serve' ? uuidSchema.parse(process.env.LOWKKEY_E2E_RUN_ID) : null;
  const persistPath = testRunId ? `.data/e2e/${testRunId}` : '.data/dev';
  const serve = command === 'serve';
  return {
    envDir: '.local/config/no-env', envPrefix: 'VEYRA_NO_AUTO_ENV_', cacheDir: '.cache/vite',
    plugins: [privateFiles, react(), cloudflare({ remoteBindings: false, tunnel: false, inspectorPort: false, persistState: { path: persistPath }, config: { vars: { ...config, ...(serve ? { RESTORE_EPOCH: testRunId ?? localRestoreEpoch() } : {}) }, ...(serve ? { main: path.resolve('tests/support/local-worker.ts') } : {}) } })],
    define: { __PUBLIC_CONFIG__: JSON.stringify(publicConfig(config)), __LOCAL_DEVELOPMENT__: JSON.stringify(serve) },
    // Generated reports and local state must never trigger application reloads.
    server: { watch: { ignored: ['**/.artifacts/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.tmp/**', '**/.cache/**', '**/.wrangler/**'] }, host: '127.0.0.1', port: 5173, strictPort: true, open: false, fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**'] } },
    build: { outDir: '.artifacts/build', sourcemap: false, emptyOutDir: true },
  };
});
