/* global Request */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { customerAuth } from '../src/server/customer-auth.ts';

const origin = process.env.LOWKKEY_TEST_ORIGIN, directory = process.env.LOWKKEY_CUSTOMER_TEST_DIR;
if (!origin?.startsWith('http://127.0.0.1:') || !directory?.startsWith('.data/e2e-showroom/')) throw new Error('Only isolated customer tests are allowed');
const runtime = localRuntime(directory);
try {
  const DB = await runtime.getD1Database('DB');
  const env = { DB, APP_ENV: 'test', AUTH_MODE: 'customer', APP_ORIGIN: origin, BETTER_AUTH_SECRET: 'isolated-customer-test-secret-not-for-production-12345' };
  // Issue real signed Better Auth sessions; only email delivery is intercepted.
  // All OAuth and MCP requests below execute in the actual Workers runtime.
  async function login(email) {
    await DB.prepare('INSERT INTO auth_invites(email,created_at) VALUES (?,?)').bind(email, new Date().toISOString()).run();
    let otp;
    const auth = customerAuth(env, async (_email, value) => { otp = value; });
    const post = (path, body) => new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(body) });
    assert.equal((await auth.handler(post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }))).status, 200);
    const signed = await auth.handler(post('/api/auth/sign-in/email-otp', { email, otp }));
    assert.equal(signed.status, 200);
    return signed.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  }
  const cookie = await login('mcp@example.com'), otherCookie = await login('other@example.com');
  const user = (path, session = cookie, body, account) => fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json', ...(account ? { 'X-Lowkkey-Account': account } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
  const stateResponse = await user('/v1/state'); assert.equal(stateResponse.status, 200);
  const owner = (await stateResponse.json()).accountId;
  assert.equal((await user('/v1/state', 'lowkkey_dev=1')).status, 401);
  const verifier = randomBytes(48).toString('base64url'), redirect = origin + '/client-callback';
  const registered = await (await fetch(origin + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Customer integration', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })).json();
  const params = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: redirect, scope: 'read write', state: 'customer-test', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/mcp' });
  assert.equal((await user('/authorize?' + params, '')).status, 302);
  const consent = await user('/authorize?' + params), html = await consent.text(); assert.equal(consent.status, 200);
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1]; assert.ok(handle);
  const consentCookie = [cookie, ...consent.headers.getSetCookie().map(c => c.split(';')[0])].join('; ');
  const form = new URLSearchParams([['owner', owner], ['handle', handle], ['decision', 'approve'], ['scope', 'read'], ['scope', 'write']]);
  const approve = session => fetch(origin + '/authorize', { method: 'POST', headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual' });
  assert.equal((await approve(otherCookie)).status, 409);
  const approval = await approve(consentCookie); assert.equal(approval.status, 302);
  const code = new URL(approval.headers.get('Location')).searchParams.get('code');
  const exchange = body => fetch(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: registered.client_id, resource: origin + '/mcp' }) });
  const tokenResponse = await exchange({ grant_type: 'authorization_code', redirect_uri: redirect, code, code_verifier: verifier }); assert.equal(tokenResponse.status, 200);
  let token = await tokenResponse.json(), sequence = 0;
  const rpc = (method, params) => fetch(origin + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
  const initialized = await (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'customer-test', version: '1' } })).json();
  assert.ok(initialized.result.instructions.includes('完整原话'));
  for (const [name, args] of [['log_weight', { date: '2026-10-08', lb: 160 }], ['log_session', { date: '2026-10-08', raw_text: 'Private original\n  line two', sets: [] }], ['set_plan', { day: 'A & B', items: [], notes: { body: 'Private note' } }]]) {
    const response = await rpc('tools/call', { name, arguments: args }); assert.equal(response.status, 200);
    const value = (await response.json()).result; assert.notEqual(value.isError, true); assert.equal(new URL(value.structuredContent.view_url).origin, origin);
  }
  const own = await (await user('/v1/state')).json(), other = await (await user('/v1/state', otherCookie)).json();
  assert.equal(own.accountId, owner); assert.equal(own.sessions.length, 1); assert.equal(own.weights.length, 1); assert.equal(own.plans.length, 1);
  assert.notEqual(other.accountId, owner); assert.equal(other.sessions.length, 0); assert.equal(other.weights.length, 0); assert.equal(other.plans.length, 0);
  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token }); assert.equal(refreshed.status, 200); token = await refreshed.json();
  const brief = (await (await rpc('tools/call', { name: 'get_brief', arguments: {} })).json()).result.structuredContent.result;
  assert.equal(brief.body_notes, 'Private note'); assert.equal(brief.sessions[0].raw_text, 'Private original\n  line two');
  const clients = await (await user('/v1/clients')).json();
  assert.equal((await user('/v1/clients/' + clients[0].id + '/revoke', cookie, {}, owner)).status, 200);
  assert.equal((await rpc('tools/list', {})).status, 401);
  assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token })).ok, false);
  await DB.prepare('UPDATE auth_session SET expiresAt=0 WHERE userId IN (SELECT id FROM auth_user WHERE email=?)').bind('mcp@example.com').run();
  assert.equal((await user('/v1/state')).status, 401);
  console.log('Customer session → OAuth → four MCP tools → same-owner website → revocation passed');
} finally { await runtime.dispose(); }
