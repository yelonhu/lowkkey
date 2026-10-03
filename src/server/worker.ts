import { AuthorizationError, CimdFetchError, OAuthProvider, OAuthError } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers, OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import type { ExecutionContext, KVNamespace } from '@cloudflare/workers-types';
import { createApi } from './api.ts';
import type { Bindings } from './api.ts';
import { ownerForRequest } from './customer-auth.ts';
import { mcpResponse } from './mcp.ts';
import { oauthClient, registerOAuthClient, revokeClient } from './v1-store.ts';

type OAuthEnv=Bindings&{OAUTH_KV:KVNamespace;OAUTH_PROVIDER:OAuthHelpers};
const api=createApi();
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>`&#${char.charCodeAt(0)};`);
const scopes=['read','submit','propose'];

async function authorize(request:Request,env:OAuthEnv):Promise<Response>{
  let ownerId:string;
  try{ownerId=await ownerForRequest(request,env);}catch{if(env.AUTH_MODE==='customer'&&request.method==='GET')return Response.redirect(`${new URL(request.url).origin}/?returnTo=${encodeURIComponent(new URL(request.url).pathname+new URL(request.url).search)}#Login`,302);return new Response('Sign-in required',{status:401});}
  const oauth=env.OAUTH_PROVIDER;
  try{
    if(request.method==='GET'){
      const auth=await oauth.parseAuthRequest(request);
      const client=await oauth.lookupClient(auth.clientId);
      if(!client)return new Response('Unknown client',{status:400});
      const grant=await oauth.beginConsent(auth);
      const redirectHost=new URL(auth.redirectUri).hostname;
      const source=auth.clientId.startsWith('https://')?new URL(auth.clientId).hostname:'self-registered client';
      const permissionLabels:Record<string,string>={read:'读取我的状态和记录',submit:'提交记录，等待我确认',propose:'提出计划修改，等待我确认'};
      const checks=auth.scope.filter(scope=>scopes.includes(scope)).map(scope=>`<label><input type="checkbox" name="scope" value="${escape(scope)}" checked> ${escape(permissionLabels[scope])}</label>`).join('<br>');
      const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>授权连接</title><main style="max-width:440px;margin:10vh auto;padding:24px;font:16px system-ui;line-height:1.6"><h1>连接 ${escape(client.clientName??client.clientId)}？</h1><p>客户端来源：${escape(source)}<br>授权将发送到：<strong>${escape(redirectHost)}</strong></p>${/^(localhost|127\.\d+\.\d+\.\d+)$/.test(redirectHost)?'<p>此地址位于你的电脑。请确认是你刚刚发起的连接。</p>':''}<form method="post"><input type="hidden" name="owner" value="${escape(ownerId)}"><input type="hidden" name="handle" value="${escape(grant.handle)}">${checks}<p><button name="decision" value="approve">授权</button> <button name="decision" value="deny">拒绝</button></p></form></main></html>`;
      grant.headers.set('Content-Type','text/html; charset=utf-8');grant.headers.set('Cache-Control','no-store');
      return new Response(html,{headers:grant.headers});
    }
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    if(env.AUTH_MODE==='customer'&&request.headers.get('Origin')!==env.APP_ORIGIN)return new Response('Origin required',{status:403});
    const form=await request.formData(),handle=String(form.get('handle')??'');
    if(env.AUTH_MODE==='customer'&&form.get('owner')!==ownerId)return new Response('Account changed; restart authorization',{status:409});
    if(form.get('decision')!=='approve'){
      const denied=await oauth.denyConsent(request,handle);
      return new Response(null,{status:302,headers:denied.headers});
    }
    const selected=form.getAll('scope').map(String).filter(scope=>scopes.includes(scope));
    if(!selected.length){const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
    const approved=await oauth.approveConsent(request,handle,{scope:selected});
    const client=await oauth.lookupClient(approved.request.clientId);
    if(!client)throw new Error('Unknown client');
    const id=crypto.randomUUID(),name=client.clientName??client.clientId;
    await registerOAuthClient(env.DB,ownerId,approved.request.clientId,name,selected,id);
    let redirectTo:string;
    try{({redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:ownerId,metadata:{clientName:name},scope:selected,props:{ownerId,clientRecordId:id}}));}catch(error){await revokeClient(env.DB,ownerId,crypto.randomUUID(),id);throw error;}
    approved.headers.set('Location',redirectTo);
    return new Response(null,{status:302,headers:approved.headers});
  }catch(error){
    if(error instanceof AuthorizationError&&error.redirectUri){const url=new URL(error.redirectUri);url.searchParams.set('error',error.code);url.searchParams.set('error_description',error.description);if(error.state)url.searchParams.set('state',error.state);if(error.issuer)url.searchParams.set('iss',error.issuer);return Response.redirect(url.href,302);}
    if(error instanceof AuthorizationError||error instanceof CimdFetchError)return new Response(error instanceof AuthorizationError?error.description:'Client metadata unavailable',{status:400});
    throw error;
  }
}

export default {
  fetch(request:Request,env:OAuthEnv,ctx:ExecutionContext){
    const origin=env.APP_ORIGIN??new URL(request.url).origin;
    if(env.APP_ENV==='production'&&(!env.APP_ORIGIN||new URL(request.url).origin!==origin))return new Response('Origin not configured',{status:503});
    const provider=new OAuthProvider<OAuthEnv>({
      apiRoute:'/mcp',
      apiHandler:{async fetch(req:Request,bindings:OAuthEnv,context:OAuthResourceContext<{ownerId?:string;clientRecordId?:string}>){
        const props=context.props as {ownerId?:string;clientRecordId?:string};
        if(!props.ownerId||!props.clientRecordId)return new Response('Unauthorized',{status:401});
        const client=await oauthClient(bindings.DB,props.ownerId,props.clientRecordId);
        if(!client||client.status!=='active')return new Response('Client revoked',{status:401});
        await bindings.DB.prepare("UPDATE v1_clients SET last_used_at=? WHERE id=? AND owner_id=? AND status='active'").bind(new Date().toISOString(),client.id,props.ownerId).run();
        const granted=JSON.parse(client.scopes_json) as string[];
        const effective=context.auth.scope.filter((scope:string)=>granted.includes(scope));
        return mcpResponse(req,bindings.DB,{ownerId:props.ownerId,clientId:client.id,scopes:effective});
      }},
      defaultHandler:{fetch(req:Request,bindings:OAuthEnv,execution:ExecutionContext){if(new URL(req.url).pathname==='/authorize')return authorize(req,bindings);return api.fetch(req,bindings,execution);}},
      authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
      scopesSupported:scopes,clientIdMetadataDocumentEnabled:true,accessTokenTTL:3600,refreshTokenTTL:60*60*24*30,
      async tokenExchangeCallback(options){
        const props=options.props as {ownerId?:string;clientRecordId?:string};
        if(!props.ownerId||!props.clientRecordId||props.ownerId!==options.userId)throw new OAuthError('invalid_grant',{description:'Authorization revoked or unavailable'});
        const client=await oauthClient(env.DB,props.ownerId,props.clientRecordId);
        if(!client||client.status!=='active')throw new OAuthError('invalid_grant',{description:'Authorization revoked or unavailable'});
        await env.DB.prepare('UPDATE v1_clients SET grant_id=? WHERE id=? AND owner_id=? AND status=?').bind(options.grantId,props.clientRecordId,props.ownerId,'active').run();
        return {accessTokenScope:(JSON.parse(client.scopes_json) as string[]).filter(scope=>options.requestedScope.includes(scope))};
      },
      resourceMetadata:{resource:`${origin}/mcp`,authorization_servers:[origin],scopes_supported:scopes,resource_name:'lowkkey'},
    });
    return provider.fetch(request,env,ctx);
  },
};
