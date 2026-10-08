import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const localPort = process.env.LOWKKEY_E2E_DIR ? Number(process.env.LOWKKEY_E2E_PORT??5174) : 5173;

const testTLS=process.env.LOWKKEY_E2E_DIR&&process.env.LOWKKEY_E2E_TLS==='1';

const buildSha=process.env.CF_PAGES_COMMIT_SHA??process.env.GITHUB_SHA??(()=>{try{return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{return 'development';}})();

export default defineConfig(({ command }) => ({
  define:{__BUILD_SHA__:JSON.stringify(buildSha)},
  envDir: '.local/config/no-env', envPrefix: 'LOWKKEY_NO_AUTO_ENV_', cacheDir: process.env.LOWKKEY_E2E_DIR?`.cache/vite-e2e-${localPort}`:'.cache/vite',
  plugins: [react(), cloudflare({ configPath: process.env.LOWKKEY_WRANGLER_CONFIG ?? (command === 'serve' ? 'wrangler.local.json' : 'wrangler.json'), remoteBindings: false, tunnel: false, inspectorPort: false,
    persistState: { path: process.env.LOWKKEY_E2E_DIR ?? '.data/v02' },
    config: { vars: command === 'serve' ? { APP_ENV: 'development', APP_ORIGIN: `${testTLS?'https':'http'}://127.0.0.1:${localPort}` } : { APP_ENV: 'production' } },
  })],
  server: { ...(testTLS?{https:{key:readFileSync(`${process.env.LOWKKEY_E2E_DIR}/localhost.key`),cert:readFileSync(`${process.env.LOWKKEY_E2E_DIR}/localhost.crt`)}}:{}),host: '127.0.0.1', port: localPort, strictPort: true, open: false,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.artifacts/**'] },
    watch: { ignored: ['**/.artifacts/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.tmp/**', '**/.cache/**'] },
  },
  build: { outDir: '.artifacts/build', emptyOutDir: true, sourcemap: false },
}));
