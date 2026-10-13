import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { googleLogin } from './google-auth-helper.ts';

const origin = process.env.LOWKKEY_TEST_ORIGIN, directory = process.env.LOWKKEY_CUSTOMER_TEST_DIR;
if (!origin?.startsWith('http://127.0.0.1:') || !directory?.startsWith('.data/e2e-showroom/')) throw new Error('Only isolated customer tests are allowed');
const runtime = localRuntime(directory);
try {
  const DB = await runtime.getD1Database('DB');
  const env = { DB, APP_ENV: 'test', AUTH_MODE: 'customer', APP_ORIGIN: origin, BETTER_AUTH_SECRET: 'isolated-customer-test-secret-not-for-production-12345' };
  // Real Google callback/session handling, with only the provider network exchange simulated.
  const login=email=>googleLogin(env,email);
  const cookie=await login('mcp@example.com');let otherCookie=await login('other@example.com');
  const user = (path, session = cookie, body, account) => fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json', ...(account ? { 'X-Lowkkey-Account': account } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
  assert.equal((await user('/v1/state')).status,403);
  const owner = (await (await user('/v1/account')).json()).accountId;
  assert.equal((await user('/v1/state', 'lowkkey_dev=1')).status, 401);
  const verifier = randomBytes(48).toString('base64url'), redirect = origin + '/client-callback';
  const registered = await (await fetch(origin + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Customer integration', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })).json();
  const params = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: redirect, scope: 'read write', state: 'customer-test', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/mcp' });
  assert.equal((await user('/authorize?' + params, '')).status, 302);
  const pendingPrivacy=await user('/authorize?'+params);assert.equal(pendingPrivacy.status,302);assert.equal(new URL(pendingPrivacy.headers.get('Location')).hash,'#consent');
  for(const session of [cookie,otherCookie]){const account=await (await user('/v1/account',session)).json();assert.equal((await user('/v1/account/consent',session,{version:'2026-10-13-notes-write',accepted:true},account.accountId)).status,200);}
  assert.equal((await user('/v1/state')).status,200);
  const switchConsent=await user('/authorize?'+params,otherCookie),switchHtml=await switchConsent.text();
  assert.ok(switchHtml.includes('other@example.com'));assert.ok(switchHtml.includes('换一个账户'));
  const switchOwner=(await (await user('/v1/state',otherCookie)).json()).accountId;
  const switchHandle=switchHtml.match(/name="handle" value="([^"]+)"/)?.[1];assert.ok(switchHandle);
  const switchCookie=[otherCookie,...switchConsent.headers.getSetCookie().map(c=>c.split(';')[0])].join('; ');
  const switched=await fetch(origin+'/authorize?'+params,{method:'POST',headers:{Cookie:switchCookie,Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({owner:switchOwner,handle:switchHandle,decision:'switch'}),redirect:'manual'});
  assert.equal(switched.status,302);assert.equal(switched.headers.get('Location'),origin+'/authorize?'+params);
  assert.equal((await user('/v1/state',otherCookie)).status,401);
  otherCookie=await login('other@example.com');

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
  assert.ok(initialized.result.instructions.includes('派生数字引用工具结果'));
  await DB.prepare('DELETE FROM privacy_consents WHERE owner_id=?').bind(owner).run();
  assert.equal((await rpc('tools/list',{})).status,403);
  assert.equal((await user('/v1/export')).status,200);
  assert.equal((await user('/v1/account/consent',cookie,{version:'2026-10-13-notes-write',accepted:true},owner)).status,200);
  assert.equal((await (await user('/v1/onboarding')).json()).clients[0].firstReadAt,null);
  const noteResponse=await fetch(origin+'/v1/notes/2026-10-12',{method:'PUT',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-Lowkkey-Account':owner},body:JSON.stringify({text:'来自网页的随手记\n  自由书写 🙂',revision:0})});
  assert.equal(noteResponse.status,200);
  const notesReply=(await (await rpc('tools/call',{name:'read_notes',arguments:{}})).json()).result;
  assert.equal(notesReply.structuredContent.result.notes[0].text,'来自网页的随手记\n  自由书写 🙂');
  assert.equal((await (await user('/v1/notes',otherCookie)).json()).notes.length,0);
  const noteSetup=await (await user('/v1/onboarding')).json();assert.ok(noteSetup.clients[0].firstReadAt);assert.equal(noteSetup.clients[0].firstWriteAt,null);
  assert.equal((await (await user('/v1/export')).json()).notes.length,1);
  for (const [name, args] of [['log_weight', { date: '2026-10-08', lb: 160 }], ['log_session', { date: '2026-10-08', title:'A & B',note: 'Private original\n  line two', sets: [] }], ['set_plan', { title: 'A & B',weekday:1,items:[{ex:'bench_press',load:100,unit:'lb',loadKind:'external',sets:3,min:6,max:8}]}], ['set_profile', {body_notes:'Private note'}]]) {
    const response = await rpc('tools/call', { name, arguments: args }); assert.equal(response.status, 200);
    const value = (await response.json()).result; assert.notEqual(value.isError, true); assert.equal(new URL(value.structuredContent.view_url).origin, origin);
  }
  const own = await (await user('/v1/state')).json(), other = await (await user('/v1/state', otherCookie)).json();
  assert.equal(own.accountId, owner); assert.equal(own.sessions.length, 1); assert.equal(own.weights.length, 1); assert.equal(own.plans.length, 1);
  assert.notEqual(other.accountId, owner); assert.equal(other.sessions.length, 0); assert.equal(other.weights.length, 0); assert.equal(other.plans.length, 0);
  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token }); assert.equal(refreshed.status, 200); token = await refreshed.json();
  const brief = (await (await rpc('tools/call', { name: 'get_brief', arguments: {} })).json()).result.structuredContent.result;
  assert.deepEqual(brief.permissions,['read','write']);assert.ok(brief.timezone);
  const setup=await (await user('/v1/onboarding')).json();assert.ok(setup.completedAt);assert.ok(setup.clients[0].firstReadAt);assert.ok(setup.clients[0].firstWriteAt);
  assert.equal(brief.profile.body_notes, 'Private note'); assert.equal(brief.sessions[0].note, 'Private original\n  line two');
  const clients = await (await user('/v1/clients')).json();
  assert.equal((await user('/v1/clients/' + clients[0].id + '/revoke', cookie, {}, owner)).status, 200);
  assert.equal((await rpc('tools/list', {})).status, 401);
  assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token })).ok, false);
  // Reconnect, then delete while the replacement grant is still active.
  const reconnect=await user('/authorize?'+params),reconnectHtml=await reconnect.text();
  const reconnectHandle=reconnectHtml.match(/name="handle" value="([^"]+)"/)?.[1];assert.ok(reconnectHandle);
  const reconnectCookie=[cookie,...reconnect.headers.getSetCookie().map(c=>c.split(';')[0])].join('; ');
  const reapproved=await fetch(origin+'/authorize',{method:'POST',headers:{Cookie:reconnectCookie,Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams([['owner',owner],['handle',reconnectHandle],['decision','approve'],['scope','read'],['scope','write']]),redirect:'manual'});
  assert.equal(reapproved.status,302);
  const reconnectCode=new URL(reapproved.headers.get('Location')).searchParams.get('code');
  const replacement=await exchange({grant_type:'authorization_code',redirect_uri:redirect,code:reconnectCode,code_verifier:verifier});assert.equal(replacement.status,200);token=await replacement.json();
  assert.equal((await rpc('tools/list',{})).status,200);
  assert.equal((await user('/v1/account/delete',cookie,{confirm:'DELETE'},owner)).status,200);
  assert.equal((await rpc('tools/list',{})).status,401);
  assert.equal((await exchange({grant_type:'refresh_token',refresh_token:token.refresh_token})).ok,false);
  assert.equal((await user('/v1/state')).status,401);
  assert.equal(await DB.prepare('SELECT 1 FROM daily_notes WHERE owner_id=?').bind(owner).first(),null);
  assert.equal(await DB.prepare('SELECT 1 FROM privacy_consents WHERE owner_id=?').bind(owner).first(),null);
  assert.equal((await user('/v1/state',otherCookie)).status,200);
  await DB.prepare('UPDATE auth_session SET expiresAt=0 WHERE userId IN (SELECT id FROM auth_user WHERE email=?)').bind('other@example.com').run();
  assert.equal((await user('/v1/state',otherCookie)).status,401);
  console.log('Customer session → OAuth → eight MCP tools → same-owner website → revocation → reconnect → account deletion passed');
} finally { await runtime.dispose(); }
