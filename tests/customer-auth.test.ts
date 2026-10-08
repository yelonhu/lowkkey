import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile,readdir,rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { customerAuth,ownerForRequest } from '../src/server/customer-auth.ts';
import type { AuthBindings } from '../src/server/customer-auth.ts';
import { createApi } from '../src/server/api.ts';
const directory=`.data/auth-test/${crypto.randomUUID()}`,origin='http://127.0.0.1:5370';
let mf:Miniflare,env:AuthBindings;const codes=new Map<string,string>();
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-30',cf:false,host:'127.0.0.1',d1Databases:{DB:'11111111-1111-4111-8111-111111111111'},d1Persist:`${directory}/d1`,outboundService:()=>{throw new Error('no outbound');}});
  env={DB:await mf.getD1Database('DB') as D1Database,APP_ENV:'test',AUTH_MODE:'customer',APP_ORIGIN:origin,BETTER_AUTH_SECRET:'test-only-secret-never-use-in-production-123456'};
  for(const name of (await readdir('db/showroom-migrations')).filter(n=>n.endsWith('.sql')).sort())await env.DB.batch((await readFile(`db/showroom-migrations/${name}`,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(sql=>env.DB.prepare(sql)));
  for(const email of ['one@example.com','two@example.com','expired@example.com','mail@example.com','devices@example.com'])await env.DB.prepare('INSERT INTO auth_invites(email,created_at) VALUES (?,?)').bind(email,new Date().toISOString()).run();
});
afterAll(async()=>{await mf?.dispose();await rm(directory,{recursive:true,force:true});});
const request=(path:string,body?:unknown,cookie='')=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','cf-connecting-ip':`192.0.2.${Math.floor(Math.random()*200)+1}`},body:body?JSON.stringify(body):undefined});
async function login(email:string){const auth=customerAuth(env,async(email,otp)=>{codes.set(email,otp);});const sent=await auth.handler(request('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'}));expect(sent.status,await sent.clone().text()).toBe(200);const signed=await auth.handler(request('/api/auth/sign-in/email-otp',{email,otp:codes.get(email)}));expect(signed.status,await signed.clone().text()).toBe(200);return signed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
describe('customer authentication on isolated D1',()=>{
  it('requires an invitation and never sends uninvited codes',async()=>{
    const response=await customerAuth(env,async(email,otp)=>{codes.set(email,otp);}).handler(request('/api/auth/email-otp/send-verification-otp',{email:'stranger@example.com',type:'sign-in'}));
    expect(response.status).toBe(403);expect(codes.has('stranger@example.com')).toBe(false);
  });
  it('verifies OTP once, preserves owner, and rejects cross-account writes',async()=>{
    const cookie=await login('one@example.com'),owner=await ownerForRequest(request('/v1/state',undefined,cookie),env);
    const replay=await customerAuth(env).handler(request('/api/auth/sign-in/email-otp',{email:'one@example.com',otp:codes.get('one@example.com')}));expect(replay.ok).toBe(false);
    expect(await ownerForRequest(request('/v1/state',undefined,cookie),env)).toBe(owner);
    const other=await login('two@example.com');const wrong=request('/v1/clients/other/revoke',{text:'体重60kg'},other);wrong.headers.set('X-Lowkkey-Account',owner);
    expect((await createApi().fetch(wrong,env)).status).toBe(409);
    const signout=await customerAuth(env).handler(request('/api/auth/sign-out',{},cookie));expect(signout.ok).toBe(true);
    await expect(ownerForRequest(request('/v1/state',undefined,cookie),env)).rejects.toThrow('unauthorized');
  });
  it('rejects local bypass cookies in customer mode',async()=>{await expect(ownerForRequest(request('/v1/state',undefined,'lowkkey_dev=1'),env)).rejects.toThrow('unauthorized');});
  it('reports mail delivery failure and rejects foreign origins',async()=>{
    const failed=await customerAuth(env).handler(request('/api/auth/email-otp/send-verification-otp',{email:'mail@example.com',type:'sign-in'}));expect(failed.status).toBe(503);
    const foreign=request('/api/auth/sign-out',{});foreign.headers.set('Origin','https://foreign.invalid');
    expect((await customerAuth(env).handler(foreign)).status).toBe(403);
  });
  it('rejects expired codes and revokes other device sessions',async()=>{
    const auth=customerAuth(env,async(email,otp)=>{codes.set(email,otp);});
    await auth.handler(request('/api/auth/email-otp/send-verification-otp',{email:'expired@example.com',type:'sign-in'}));
    await env.DB.prepare('UPDATE auth_verification SET expiresAt=0 WHERE identifier LIKE ?').bind('%expired@example.com%').run();
    expect((await auth.handler(request('/api/auth/sign-in/email-otp',{email:'expired@example.com',otp:codes.get('expired@example.com')}))).ok).toBe(false);
    const first=await login('devices@example.com'),second=await login('devices@example.com');
    expect((await auth.handler(request('/api/auth/revoke-other-sessions',{},second))).ok).toBe(true);
    await expect(ownerForRequest(request('/v1/state',undefined,first),env)).rejects.toThrow('unauthorized');
    expect(await ownerForRequest(request('/v1/state',undefined,second),env)).toBeTruthy();
    await env.DB.prepare('UPDATE auth_invites SET revoked_at=? WHERE email=?').bind(new Date().toISOString(),'devices@example.com').run();
    await expect(ownerForRequest(request('/v1/state',undefined,second),env)).rejects.toThrow('unauthorized');
  });

});
