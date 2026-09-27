import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const experimentFile = resolve('.data/experiment/training-2026-09-26.json');
const localPort = process.env.LOWKKEY_E2E_DIR ? 5174 : 5173;
function experimentPlugin(): Plugin {
  return {
    name: 'local-experiment-data',
    configureServer(server) {
      server.middlewares.use('/__experiment/training', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        void readFile(experimentFile).then(data => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(data);
        }).catch(() => { res.statusCode = 404; res.end('Experimental data unavailable'); });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  envDir: '.local/config/no-env', envPrefix: 'LOWKKEY_NO_AUTO_ENV_', cacheDir: '.cache/vite',
  plugins: [react(), ...(command === 'serve' ? [experimentPlugin()] : []), cloudflare({ configPath: process.env.LOWKKEY_WRANGLER_CONFIG, remoteBindings: false, tunnel: false, inspectorPort: false,
    persistState: { path: process.env.LOWKKEY_E2E_DIR ?? '.data/v02' },
    config: { vars: command === 'serve' ? { APP_ENV: 'development', APP_ORIGIN: `http://127.0.0.1:${localPort}` } : { APP_ENV: 'production' } },
  })],
  server: { host: '127.0.0.1', port: localPort, strictPort: true, open: false,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.artifacts/**'] },
    watch: { ignored: ['**/.artifacts/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.tmp/**', '**/.cache/**'] },
  },
  build: { outDir: '.artifacts/build', emptyOutDir: true, sourcemap: false },
}));
