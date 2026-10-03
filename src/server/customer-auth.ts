import { betterAuth, APIError } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import type { D1Database } from '@cloudflare/workers-types';
import { StoreError, accountFor } from './account.ts';
import { accessVerifier } from './auth.ts';

export type AuthBindings={DB:D1Database;APP_ENV?:'development'|'test'|'production';APP_ORIGIN?:string;AUTH_MODE?:'customer'|'access';AI_CONNECTION_ENABLED?:string;BETTER_AUTH_SECRET?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;RESEND_API_KEY?:string;AUTH_EMAIL_FROM?:string;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string};
const normalize=(email:string)=>email.trim().toLowerCase();
export async function invited(db:D1Database,email:string){return !!await db.prepare('SELECT email FROM auth_invites WHERE email=? AND revoked_at IS NULL').bind(normalize(email)).first();}
export function customerAuth(env:AuthBindings,sendCode?:(email:string,otp:string)=>Promise<void>){
  if(!env.BETTER_AUTH_SECRET||env.BETTER_AUTH_SECRET.length<32||!env.APP_ORIGIN)throw new StoreError('auth_not_configured',503);
  const requireInvite=async(email:string)=>{if(!await invited(env.DB,email))throw new APIError('FORBIDDEN',{code:'INVITATION_REQUIRED',message:'INVITATION_REQUIRED'});};
  let mailFailed=false;
  return betterAuth({
    hooks:{before:createAuthMiddleware(async ctx=>{if(ctx.request?.method==='POST'&&ctx.request.headers.get('Origin')!==env.APP_ORIGIN)throw new APIError('FORBIDDEN',{message:'INVALID_ORIGIN'});if(ctx.path==='/email-otp/send-verification-otp'){await requireInvite(String(ctx.body?.email??''));if(ctx.body?.type!=='sign-in')throw new APIError('BAD_REQUEST',{message:'UNSUPPORTED_OPERATION'});}}),after:createAuthMiddleware(async ctx=>{if(ctx.path==='/email-otp/send-verification-otp'&&mailFailed)throw new APIError('SERVICE_UNAVAILABLE',{code:'MAIL_UNAVAILABLE',message:'MAIL_UNAVAILABLE'});})},
    appName:'lowkkey',baseURL:env.APP_ORIGIN,basePath:'/api/auth',secret:env.BETTER_AUTH_SECRET,database:env.DB,
    trustedOrigins:[env.APP_ORIGIN],
    user:{modelName:'auth_user'},session:{modelName:'auth_session',expiresIn:60*60*24*30,updateAge:60*60*24,cookieCache:{enabled:false}},
    account:{modelName:'auth_account',encryptOAuthTokens:true,accountLinking:{enabled:true,disableImplicitLinking:true,allowDifferentEmails:false}},verification:{modelName:'auth_verification'},
    advanced:{useSecureCookies:env.APP_ORIGIN.startsWith('https:'),ipAddress:{ipAddressHeaders:['cf-connecting-ip']}},
    rateLimit:{enabled:true,storage:'database',modelName:'auth_rate_limit',window:60,max:30,customRules:{'/email-otp/send-verification-otp':{window:60,max:3},'/sign-in/email-otp':{window:300,max:5}}},
    socialProviders:env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET?{google:{clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,scope:['openid','email','profile']}}:{},
    databaseHooks:{user:{create:{before:async user=>{await requireInvite(user.email);return {data:user};}}},session:{create:{before:async session=>{
      const user=await env.DB.prepare('SELECT email,emailVerified FROM auth_user WHERE id=?').bind(session.userId).first<{email:string;emailVerified:number}>();
      if(!user?.emailVerified)throw new APIError('FORBIDDEN',{message:'VERIFIED_EMAIL_REQUIRED'});
      await requireInvite(user.email);return {data:session};
    }}}},
    plugins:[emailOTP({otpLength:6,expiresIn:300,allowedAttempts:5,storeOTP:'hashed',async sendVerificationOTP({email,otp,type}){
      await requireInvite(email);if(type!=='sign-in')throw new APIError('BAD_REQUEST',{message:'UNSUPPORTED_OPERATION'});
      if(sendCode){await sendCode(email,otp);return;}
      if(!env.RESEND_API_KEY||!env.AUTH_EMAIL_FROM){mailFailed=true;throw new APIError('SERVICE_UNAVAILABLE',{code:'MAIL_UNAVAILABLE',message:'MAIL_UNAVAILABLE'});}
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.AUTH_EMAIL_FROM,to:[email],subject:'lowkkey 登录验证码',text:`你的验证码是 ${otp}，5 分钟内有效。请勿向他人提供。`})}).catch(()=>{mailFailed=true;throw new APIError('SERVICE_UNAVAILABLE',{code:'MAIL_UNAVAILABLE',message:'MAIL_UNAVAILABLE'});});
      if(!response.ok){mailFailed=true;throw new APIError('SERVICE_UNAVAILABLE',{code:'MAIL_UNAVAILABLE',message:'MAIL_UNAVAILABLE'});}
    }})],
    logger:{level:'error',log:()=>console.error('AUTH_OPERATION_FAILED')},
  });
}
export async function customerSession(request:Request,env:AuthBindings){
  const session=await customerAuth(env).api.getSession({headers:request.headers});
  if(!session?.user.emailVerified||!await invited(env.DB,session.user.email))throw new StoreError('unauthorized',401);
  return session;
}
export async function ownerForRequest(request:Request,env:AuthBindings):Promise<string>{
  if(env.AUTH_MODE==='customer'){
    const session=await customerSession(request,env);
    const linked=await env.DB.prepare('SELECT owner_id FROM auth_owners WHERE user_id=?').bind(session.user.id).first<{owner_id:string}>();
    if(linked)return linked.owner_id;
    const owner=await accountFor(env.DB,{issuer:'lowkkey-customer',subject:session.user.id,email:session.user.email});
    await env.DB.prepare('INSERT OR IGNORE INTO auth_owners(user_id,owner_id) VALUES (?,?)').bind(session.user.id,owner).run();
    return (await env.DB.prepare('SELECT owner_id FROM auth_owners WHERE user_id=?').bind(session.user.id).first<{owner_id:string}>())!.owner_id;
  }
  if(env.APP_ENV==='development'||env.APP_ENV==='test'){
    if(!/(?:^|;\s*)lowkkey_dev=1(?:;|$)/.test(request.headers.get('Cookie')??''))throw new StoreError('unauthorized',401);
    return accountFor(env.DB,{issuer:'lowkkey-local',subject:'owner',email:'owner@local.invalid'});
  }
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)throw new StoreError('auth_not_configured',503);
  return accountFor(env.DB,await accessVerifier({teamDomain:env.ACCESS_TEAM_DOMAIN,audience:env.ACCESS_AUD})(request));
}
