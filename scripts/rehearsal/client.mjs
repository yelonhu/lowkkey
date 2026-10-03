import { createHash, randomBytes, randomUUID } from 'node:crypto';

// This adapter intentionally accepts only the private loopback app created by
// the runner. It cannot be pointed at a personal or public deployment.
export async function rehearsalClient(port) {
  const origin=`http://127.0.0.1:${port}`;
  const checked=async response=>{const body=await response.text();if(!response.ok)throw new Error(`${response.status}: ${body}`);return JSON.parse(body);};
  const user=async(path,body,method='POST',key=randomUUID())=>checked(await fetch(`${origin}${path}`,{method,headers:{Cookie:'lowkkey_dev=1',Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const state=()=>user('/v1/state',undefined,'GET');
  const redirect=`${origin}/rehearsal-callback`,verifier=randomBytes(48).toString('base64url');
  const registered=await checked(await fetch(`${origin}/oauth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'演练客户端（非真实 AI）',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'})}));
  const query=new URLSearchParams({response_type:'code',client_id:registered.client_id,redirect_uri:redirect,scope:'read submit propose',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:randomUUID(),resource:`${origin}/mcp`});
  const consent=await fetch(`${origin}/authorize?${query}`,{headers:{Cookie:'lowkkey_dev=1'},redirect:'manual'}),html=await consent.text();
  const handle=html.match(/name="handle" value="([^"]+)"/)?.[1];if(!consent.ok||!handle)throw new Error('演练授权初始化失败');
  const body=new URLSearchParams({handle,decision:'approve'});for(const scope of ['read','submit','propose'])body.append('scope',scope);
  const approved=await fetch(`${origin}/authorize`,{method:'POST',headers:{Cookie:['lowkkey_dev=1',...consent.headers.getSetCookie().map(value=>value.split(';')[0])].join('; '),'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
  if(approved.status!==302)throw new Error('演练授权未完成');
  const code=new URL(approved.headers.get('Location')).searchParams.get('code');
  const token=await checked(await fetch(`${origin}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:`${origin}/mcp`})}));
  let sequence=0;
  const rpc=async(method,params)=>{
    const response=await fetch(`${origin}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});
    const raw=await response.text();if(!response.ok)throw new Error(`${response.status}: 演练客户端请求失败`);
    const value=raw.startsWith('event:')?JSON.parse(raw.match(/data: (\{[^\n]+\})/)?.[1]??'{}'):JSON.parse(raw);
    if(value.error||value.result?.isError)throw new Error(JSON.stringify(value.error??value.result.content));
    return value.result;
  };
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'local-rehearsal',version:'1'}});
  return {state,user,tool:async(name,args)=>(await rpc('tools/call',{name,arguments:args})).structuredContent.result};
}
