import { betterAuth, APIError } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import type { D1Database } from '@cloudflare/workers-types';
import { StoreError, accountFor } from './account.ts';
import { consumeConsentIntent } from './privacy.ts';
import { event } from './lifecycle.ts';
import { accessVerifier } from './auth.ts';

export type AuthBindings={DB:D1Database;APP_ENV?:'development'|'test'|'production';APP_ORIGIN?:string;AUTH_MODE?:'customer'|'access';AI_CONNECTION_ENABLED?:string;BETTER_AUTH_SECRET?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;PRIVACY_CONTACT_EMAIL?:string;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string};
export function customerAuth(env:AuthBindings){
  if(!env.BETTER_AUTH_SECRET||env.BETTER_AUTH_SECRET.length<32||!env.APP_ORIGIN)throw new StoreError('auth_not_configured',503);
  return betterAuth({
    hooks:{before:createAuthMiddleware(async ctx=>{
      if(ctx.request?.method==='POST'&&ctx.request.headers.get('Origin')!==env.APP_ORIGIN)throw new APIError('FORBIDDEN',{message:'INVALID_ORIGIN'});
      if(ctx.path==='/link-social'||ctx.path==='/unlink-account')throw new APIError('NOT_FOUND',{message:'NOT_FOUND'});
    })},
    appName:'lowkkey',baseURL:env.APP_ORIGIN,basePath:'/api/auth',secret:env.BETTER_AUTH_SECRET,database:env.DB,
    trustedOrigins:[env.APP_ORIGIN],
    user:{modelName:'auth_user'},session:{modelName:'auth_session',expiresIn:60*60*24*30,updateAge:60*60*24,cookieCache:{enabled:false}},
    account:{modelName:'auth_account',encryptOAuthTokens:true,accountLinking:{enabled:false}},verification:{modelName:'auth_verification'},
    advanced:{useSecureCookies:env.APP_ORIGIN.startsWith('https:'),ipAddress:{ipAddressHeaders:['cf-connecting-ip']}},
    rateLimit:{enabled:true,storage:'database',modelName:'auth_rate_limit',window:60,max:30},
    socialProviders:env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET?{google:{clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,scope:['openid','email','profile']}}:{},
    databaseHooks:{user:{create:{before:async user=>{if(!user.emailVerified)throw new APIError('FORBIDDEN',{message:'VERIFIED_EMAIL_REQUIRED'});return {data:user};}}},session:{create:{before:async session=>{
      if(await env.DB.prepare('SELECT 1 FROM account_deletions WHERE user_id=?').bind(session.userId).first())throw new APIError('FORBIDDEN',{message:'ACCOUNT_DELETING'});
      const user=await env.DB.prepare('SELECT email,emailVerified FROM auth_user WHERE id=?').bind(session.userId).first<{email:string;emailVerified:number}>();
      if(!user?.emailVerified)throw new APIError('FORBIDDEN',{message:'VERIFIED_EMAIL_REQUIRED'});
      return {data:session};
    }}}},
    logger:{level:'error',log:()=>console.error('AUTH_OPERATION_FAILED')},
  });
}
export async function customerSession(request:Request,env:AuthBindings){
  const session=await customerAuth(env).api.getSession({headers:request.headers});
  if(!session?.user.emailVerified)throw new StoreError('unauthorized',401);
  if(await env.DB.prepare('SELECT 1 FROM account_deletions WHERE user_id=?').bind(session.user.id).first())throw new StoreError('unauthorized',401);
  return session;
}
export async function ownerForRequest(request:Request,env:AuthBindings):Promise<string>{
  if(env.AUTH_MODE==='customer'){
    const session=await customerSession(request,env);
    const linked=await env.DB.prepare('SELECT owner_id FROM auth_owners WHERE user_id=?').bind(session.user.id).first<{owner_id:string}>();
    if(linked){await consumeConsentIntent(env.DB,request,linked.owner_id);return linked.owner_id;}
    const owner=await accountFor(env.DB,{issuer:'lowkkey-customer',subject:session.user.id,email:session.user.email});
    await env.DB.prepare('INSERT OR IGNORE INTO auth_owners(user_id,owner_id) VALUES (?,?)').bind(session.user.id,owner).run();
    await event(env.DB,owner,'login');
    const actual=(await env.DB.prepare('SELECT owner_id FROM auth_owners WHERE user_id=?').bind(session.user.id).first<{owner_id:string}>())!.owner_id;
    await consumeConsentIntent(env.DB,request,actual);return actual;
  }
  if(env.APP_ENV==='development'||env.APP_ENV==='test'){
    if(!/(?:^|;\s*)lowkkey_dev=1(?:;|$)/.test(request.headers.get('Cookie')??''))throw new StoreError('unauthorized',401);
    return accountFor(env.DB,{issuer:'lowkkey-local',subject:'owner',email:'owner@local.invalid'});
  }
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)throw new StoreError('auth_not_configured',503);
  return accountFor(env.DB,await accessVerifier({teamDomain:env.ACCESS_TEAM_DOMAIN,audience:env.ACCESS_AUD})(request));
}

export function requireFresh(session:{session:{createdAt:Date}}){if(Date.now()-new Date(session.session.createdAt).getTime()>5*60*1000)throw new StoreError('reauth_required',403);}
