import { localRuntime } from './local-runtime.mjs';
import { applyMigrations } from './migrations.mjs';
const runtime = localRuntime();
try { await applyMigrations(await runtime.getD1Database('DB')); console.log('Local database ready'); }
finally { await runtime.dispose(); }
