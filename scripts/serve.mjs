import { createServer } from 'vite';
import { randomUUID } from 'node:crypto';
import { localRuntime } from './local-runtime.mjs';
import { applyMigrations } from './migrations.mjs';
import { seedLocalFixture } from '../tests/support/local-fixture.ts';
const e2e = process.argv[2] === '--e2e';
if (process.argv.length > (e2e ? 3 : 2)) throw new Error('Unsupported development arguments');
if (e2e) { process.env.APP_ENV = 'test'; process.env.LOWKKEY_E2E_RUN_ID = randomUUID(); }
const startedAt = performance.now();
console.log('Preparing project-local storage…');
const runtime = localRuntime(true, e2e ? `.data/e2e/${process.env.LOWKKEY_E2E_RUN_ID}` : '.data/dev');
try {
  const db = await runtime.getD1Database('DB');
  await applyMigrations(db);
  await seedLocalFixture(db, process.env.APP_ENV ?? 'development');
} finally { await runtime.dispose(); }
console.log(`Local storage ready (${Math.round(performance.now() - startedAt)} ms). Starting the application…`);
const server = await createServer({ mode: e2e ? 'test' : 'development' });
await server.listen();
console.log(`Application ready (${Math.round(performance.now() - startedAt)} ms).`);
server.printUrls();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
