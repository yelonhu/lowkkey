import { createServer } from 'vite';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { localRuntime } from './local-runtime.mjs';
import { applyMigrations } from './migrations.mjs';
const e2e = process.argv[2] === '--e2e';
if (process.argv.length > (e2e ? 3 : 2)) throw new Error('Unsupported argument');
const directory = e2e ? `.data/e2e-v02/${randomUUID()}` : '.data/v02';
if (e2e) process.env.LOWKKEY_E2E_DIR = directory;
const runtime = localRuntime(directory);
try { await applyMigrations(await runtime.getD1Database('DB')); } finally { await runtime.dispose(); }
const server = await createServer({ mode: e2e ? 'test' : 'development', configFile: 'vite.config.ts' });
await server.listen(); server.printUrls();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); if (e2e) await rm(directory, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
