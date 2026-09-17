import { localRuntime } from './local-runtime.mjs';
import { applyMigrations } from './migrations.mjs';
const runtime = localRuntime(true);
try { console.log({ applied: await applyMigrations(await runtime.getD1Database('DB')), target: '.data/dev/v3/d1' }); }
finally { await runtime.dispose(); }
