import { fileURLToPath } from 'node:url';
import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
export const nodeBin = path.join(root, '.toolchain/node-v24.21.0-darwin-arm64/bin');
/** @returns {Record<string, string>} */
export function environment(extra = {}) {
  const paths = ['.cache/npm', '.local/config', '.local/state', '.local/test-browser', '.data/dev', '.logs', '.tmp', '.artifacts'];
  for (const directory of paths) {
    mkdirSync(path.join(root, directory), { recursive: true });
    if (!realpathSync(path.join(root, directory)).startsWith(root + path.sep)) throw new Error('Project directory escapes root');
  }
  const inherited = Object.fromEntries(['HOME', 'CODEX_HOME', 'USER', 'LOGNAME', 'LANG', 'TERM'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  return {
    ...inherited, PATH: `${nodeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    // Chromium on macOS uses its own documented temporary-directory override.
    // Keep download staging inside the same project fence as final artifacts.
    MAC_CHROMIUM_TMPDIR: path.join(root, '.tmp'),
    TMPDIR: path.join(root, '.tmp'), XDG_CONFIG_HOME: path.join(root, '.local/config'),
    XDG_CACHE_HOME: path.join(root, '.cache'), XDG_STATE_HOME: path.join(root, '.local/state'),
    npm_config_cache: path.join(root, '.cache/npm'), npm_config_userconfig: path.join(root, '.local/config/npmrc'),
    npm_config_globalconfig: path.join(root, '.local/config/npm-globalrc'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, '.toolchain/browsers'), PLAYWRIGHT_SKIP_BROWSER_GC: '1',
    WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_LOG_PATH: path.join(root, '.logs/wrangler'), WRANGLER_LOG_SANITIZE: 'true',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false',
    CI: '1', ...extra,
  };
}
