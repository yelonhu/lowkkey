import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const localPort = process.env.LOWKKEY_E2E_DIR ? 5174 : 5173;

export default defineConfig(({ command }) => ({
  envDir: '.local/config/no-env', envPrefix: 'LOWKKEY_NO_AUTO_ENV_', cacheDir: '.cache/vite',
  plugins: [react(), cloudflare({ configPath: process.env.LOWKKEY_WRANGLER_CONFIG, remoteBindings: false, tunnel: false, inspectorPort: false,
    persistState: { path: process.env.LOWKKEY_E2E_DIR ?? '.data/v02' },
    config: { vars: command === 'serve' ? { APP_ENV: 'development', APP_ORIGIN: `http://127.0.0.1:${localPort}` } : { APP_ENV: 'production' } },
  })],
  server: { host: '127.0.0.1', port: localPort, strictPort: true, open: false,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.artifacts/**'] },
    watch: { ignored: ['**/.artifacts/**', '**/.data/**', '**/.logs/**', '**/.local/**', '**/.toolchain/**', '**/.tmp/**', '**/.cache/**'] },
  },
  build: { outDir: '.artifacts/build', emptyOutDir: true, sourcemap: false },
}));
