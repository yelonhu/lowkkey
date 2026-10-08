import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
const port = Number(process.env.LOWKKEY_OAUTH_TEST_PORT ?? 5183);
for (const customer of [false, true]) {
  const server = fork('scripts/serve.mjs', ['--e2e'], { env: { ...process.env, LOWKKEY_E2E_PORT: String(port), LOWKKEY_CUSTOMER_TEST: customer ? '1' : '0' }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let child;
  async function stop() { child?.kill('SIGTERM'); if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } }
  const interrupt = () => void stop();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    const [ready] = await Promise.race([once(server, 'message'), once(server, 'exit').then(() => { throw new Error('OAuth test server exited'); })]);
    if (!ready?.isolated || !ready.directory) throw new Error('Expected isolated D1');
    child = spawn(process.execPath, [...(customer ? ['--experimental-transform-types'] : []), customer ? 'tests/customer-mcp.e2e.mjs' : 'tests/oauth-mcp.e2e.mjs'], {
      env: { ...process.env, LOWKKEY_TEST_ORIGIN: `http://127.0.0.1:${port}`, LOWKKEY_CUSTOMER_TEST_DIR: ready.directory }, stdio: 'inherit',
    });
    const [code] = await once(child, 'exit');
    if (code !== 0) { process.exitCode = code ?? 1; break; }
  } finally { await stop(); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
}
