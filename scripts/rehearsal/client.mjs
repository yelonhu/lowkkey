import { createHash, randomBytes, randomUUID } from 'node:crypto';

// Loopback-only adapter for isolated rehearsal/test servers.
export async function rehearsalClient(port, scopes = ['read','write']) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
  const origin = `http://127.0.0.1:${port}`;
  const checked = async response => { const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value; };
  const user = async (path, body, method = 'POST') => checked(await fetch(origin + path, {
    method, headers: { Cookie:'lowkkey_dev=1', Origin:origin, 'Content-Type':'application/json' },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  }));
  const redirect = origin + '/rehearsal-callback', verifier = randomBytes(48).toString('base64url');
  const registered = await checked(await fetch(origin + '/oauth/register', { method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({client_name:'演练客户端（非真实 AI）',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'}) }));
  const query = new URLSearchParams({ response_type:'code',client_id:registered.client_id,redirect_uri:redirect,scope:scopes.join(' '),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:randomUUID(),resource:origin+'/mcp' });
  const consent = await fetch(origin + '/authorize?' + query,{headers:{Cookie:'lowkkey_dev=1'},redirect:'manual'}), html = await consent.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  if (!consent.ok || !handle) throw new Error('Rehearsal consent failed');
  const form = new URLSearchParams({handle,decision:'approve'}); for (const scope of scopes) form.append('scope',scope);
  const approved = await fetch(origin + '/authorize',{method:'POST',headers:{Cookie:['lowkkey_dev=1',...consent.headers.getSetCookie().map(value=>value.split(';')[0])].join('; '),'Content-Type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
  if (approved.status !== 302) throw new Error('Rehearsal authorization failed');
  const code = new URL(approved.headers.get('Location')).searchParams.get('code');
  const token = await checked(await fetch(origin + '/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:origin+'/mcp'})}));
  const headers = {Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'};
  let sequence = 0;
  const raw = (method,params) => fetch(origin+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});
  const rpc = async (method,params) => {
    const response = await raw(method,params), text = await response.text();
    if (!response.ok) throw new Error(response.status + ': ' + text);
    const payload = text.startsWith('event:') ? JSON.parse(text.match(/data: (\{[^\n]+\})/)?.[1] ?? '{}') : JSON.parse(text);
    if (payload.error) throw new Error(JSON.stringify(payload.error));
    return payload.result;
  };
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'local-showroom-rehearsal',version:'1'}});
  const tool = async (name,args) => { const value = await rpc('tools/call',{name,arguments:args}); if (value.isError) throw new Error(JSON.stringify(value)); return value.structuredContent.result; };
  return { state:()=>user('/v1/state',undefined,'GET'), user, tool, rpc, raw, token, registered, origin, headers };
}
