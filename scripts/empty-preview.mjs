// The existing --e2e lifecycle creates and disposes a fresh local D1; no fixtures.
process.env.LOWKKEY_E2E_PORT='5176';
process.argv[2]='--e2e';
await import('./serve.mjs');
