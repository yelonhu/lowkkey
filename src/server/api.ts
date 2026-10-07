import { reviewDetail } from './review.ts';
import { Hono } from 'hono';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { customerAuth, customerSession, ownerForRequest } from './customer-auth.ts';
import type { AuthBindings } from './customer-auth.ts';
import { z, ZodError } from 'zod';
import { accessVerifier } from './auth.ts';
import type { IdentityVerifier } from './auth.ts';
import { accountFor, StoreError } from './account.ts';
import { EquipmentRequest, CaptureRequest, EntryDraft, Program, ProposeChangeRequest, ProposalDecisionRequest, ResolveHeldRequest, Snapshot, TriggerDecisionRequest } from '@lowkkey/protocol';
import * as v1 from './v1-store.ts';
import { ForbiddenError, NotFoundError } from '@lowkkey/core';

export type Bindings = AuthBindings & {OAUTH_PROVIDER?:OAuthHelpers};
type Environment = { Bindings: Bindings; Variables: { requestId:string;ownerId: string; principal:{kind:'user'|'model';clientId:string;scopes:string[]} } };
function assertOrigin(request: Request, bindings: Bindings) {
  if (bindings.APP_ENV === 'production' && !bindings.APP_ORIGIN) throw new StoreError('ORIGIN_NOT_CONFIGURED',503);
  const expected = new URL(bindings.APP_ORIGIN ?? 'http://127.0.0.1:5173').origin;
  if (request.headers.get('Origin') !== expected || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new StoreError('ORIGIN_REQUIRED',403);
}
async function jsonBody(request: Request, limit=16_384): Promise<unknown> {
  const contentType = request.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new StoreError('JSON_REQUIRED',400);
  const text = await request.text();
  if (text.length > limit) throw new StoreError('BODY_TOO_LARGE',413);
  try { return JSON.parse(text) as unknown; } catch { throw new StoreError('INVALID_JSON',400); }
}
const key=(request:Request)=>request.headers.get('Idempotency-Key')??'';
function userOnly(kind:'user'|'model') {if(kind!=='user')throw new StoreError('forbidden',403);}
function allowed(principal:{kind:'user'|'model';scopes:string[]},scope:string) {if(principal.kind!=='user'&&!principal.scopes.includes(scope))throw new StoreError('forbidden',403);}
export function createApi(options: { verifyIdentity?: IdentityVerifier } = {}) {
  const app = new Hono<Environment>();
  app.use('*',async(c,next)=>{const id=crypto.randomUUID();c.set('requestId',id);c.header('X-Request-ID',id);await next();});
  app.get('/healthz', context => context.json({ status:'ok',version:typeof __BUILD_SHA__==='undefined'?'development':__BUILD_SHA__ }));
  app.get('/api/auth/config',c=>c.json({mode:c.env.AUTH_MODE??'access',aiConnection:c.env.AI_CONNECTION_ENABLED==='1'&&c.env.AUTH_MODE==='customer'&&c.env.APP_ORIGIN?.startsWith('https://'),local:c.env.AUTH_MODE!=='customer'&&['test','development'].includes(c.env.APP_ENV??''),google:!!c.env.GOOGLE_CLIENT_ID&&!!c.env.GOOGLE_CLIENT_SECRET,email:!!c.env.RESEND_API_KEY&&!!c.env.AUTH_EMAIL_FROM},{headers:{'Cache-Control':'no-store'}}));
  app.on(['GET','POST'],'/api/auth/*',async c=>{
    if(c.env.AUTH_MODE==='customer')return customerAuth(c.env).handler(c.req.raw);
    if(c.req.path==='/api/auth/sign-out'&&c.req.method==='POST'){assertOrigin(c.req.raw,c.env);return c.json({success:true,redirect:c.env.APP_ENV==='production'?'/cdn-cgi/access/logout':null},200,{'Set-Cookie':'lowkkey_dev=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});}
    throw new StoreError('NOT_FOUND',404);
  });

  app.post('/api/local/session', context => {
    if (!['development','test'].includes(context.env.APP_ENV ?? '')) throw new StoreError('NOT_FOUND',404);
    assertOrigin(context.req.raw,context.env);
    return context.json({ ok:true },200,{ 'Set-Cookie':'lowkkey_dev=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400', 'Cache-Control':'no-store' });
  });
  app.use('/v1/*',async(context,next)=>{
    {
      const ownerId=options.verifyIdentity?await accountFor(context.env.DB,await options.verifyIdentity(context.req.raw)):await ownerForRequest(context.req.raw,context.env);
      context.set('ownerId',ownerId);
      const expected=context.req.header('X-Lowkkey-Account');if(context.env.AUTH_MODE==='customer'&&!['GET','HEAD','OPTIONS'].includes(context.req.method)&&!expected)throw new StoreError('account_required',409);if(expected&&expected!==context.get('ownerId'))throw new StoreError('account_mismatch',409);
      context.set('principal',{kind:'user',clientId:'web',scopes:['user']});
      if(!['GET','HEAD','OPTIONS'].includes(context.req.method))assertOrigin(context.req.raw,context.env);
    }
    context.header('Cache-Control','no-store');context.header('X-Content-Type-Options','nosniff');
    await next();
  });

  app.get('/v1/account',async c=>{
    const user=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(c.get('ownerId')).first<{email:string}>();
    return c.json({accountId:c.get('ownerId'),email:user?.email,mode:c.env.AUTH_MODE??'access'});
  });
  app.post('/v1/account/claim-access',async c=>{
    if(c.env.AUTH_MODE!=='customer'||!c.env.ACCESS_TEAM_DOMAIN||!c.env.ACCESS_AUD)throw new StoreError('NOT_FOUND',404);
    const session=await customerSession(c.req.raw,c.env);
    const identity=await accessVerifier({teamDomain:c.env.ACCESS_TEAM_DOMAIN,audience:c.env.ACCESS_AUD})(c.req.raw);
    const old=await accountFor(c.env.DB,identity),current=c.get('ownerId');
    if(old===current)return c.json({accountId:old});
    const snapshot=await v1.state(c.env.DB,current);
    if(snapshot.entries.length||snapshot.clients.length||snapshot.program.days.length||snapshot.proposals.length||snapshot.held.length||snapshot.program.targets.goal)throw new StoreError('conflict',409);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO mutation_guards(owner_id,operation_id,condition_ok) VALUES (?,?,CASE WHEN (SELECT data_revision FROM users WHERE id=?)=? THEN 1 ELSE 0 END)').bind(current,'claim-access',current,snapshot.revision),
      c.env.DB.prepare('UPDATE auth_owners SET owner_id=? WHERE user_id=? AND owner_id=?').bind(old,session.user.id,current),
      c.env.DB.prepare('DELETE FROM mutation_guards WHERE owner_id=? AND operation_id=?').bind(current,'claim-access'),
    ]);
    return c.json({accountId:old});
  });
  app.get('/v1/state',async c=>{
    allowed(c.get('principal'),'read');
    const data=await v1.state(c.env.DB,c.get('ownerId'));
    const from=c.req.query('from'),to=c.req.query('to');
    if(from&&to&&from>to)throw new StoreError('bad_request',400);
    return c.json({...data,entries:data.entries.filter(e=>(!from||e.date>=from)&&(!to||e.date<=to))});
  });
  app.post('/v1/decisions/today',async c=>{userOnly(c.get('principal').kind);z.strictObject({}).parse(await jsonBody(c.req.raw));return c.json(await v1.claimDecision(c.env.DB,c.get('ownerId'),key(c.req.raw)));});
  app.get('/v1/program',async c=>{allowed(c.get('principal'),'read');return c.json((await v1.state(c.env.DB,c.get('ownerId'))).program);});
  app.put('/v1/program',async c=>{userOnly(c.get('principal').kind);return c.json(await v1.writeProgram(c.env.DB,c.get('ownerId'),key(c.req.raw),Program.parse(await jsonBody(c.req.raw,1_000_000))));});
  app.put('/v1/preferences/equipment',async c=>{userOnly(c.get('principal').kind);return c.json(await v1.setEquipment(c.env.DB,c.get('ownerId'),key(c.req.raw),EquipmentRequest.parse(await jsonBody(c.req.raw))));});
  app.get('/v1/preferences/timezone',async c=>{userOnly(c.get('principal').kind);return c.json({timeZone:(await v1.state(c.env.DB,c.get('ownerId'))).timezone});});
  app.put('/v1/preferences/timezone',async c=>{userOnly(c.get('principal').kind);const body=z.strictObject({timeZone:z.string().min(1).max(80)}).parse(await jsonBody(c.req.raw));return c.json(await v1.setTimeZone(c.env.DB,c.get('ownerId'),key(c.req.raw),body.timeZone));});
  app.post('/v1/capture',async c=>{
    userOnly(c.get('principal').kind);
    const body=CaptureRequest.parse(await jsonBody(c.req.raw));
    if(!body.text?.trim())throw new StoreError('bad_request',400);
    return c.json(await v1.captureText(c.env.DB,c.get('ownerId'),key(c.req.raw),{text:body.text,capturedAt:body.capturedAt,capturedLocalDate:body.capturedLocalDate,timeZone:body.timeZone,inSession:body.context?.inSession}));
  });
  app.post('/v1/entries',async c=>{userOnly(c.get('principal').kind);const body=z.strictObject({entries:z.array(EntryDraft).min(1).max(100),inSession:z.boolean().optional()}).parse(await jsonBody(c.req.raw,1_000_000));return c.json(await v1.logEntries(c.env.DB,c.get('ownerId'),key(c.req.raw),body.entries,body.inSession));});
  app.post('/v1/entries/:id/revert',async c=>{userOnly(c.get('principal').kind);const body=z.strictObject({reason:z.string().max(400).optional()}).parse(await jsonBody(c.req.raw));return c.json(await v1.undo(c.env.DB,c.get('ownerId'),key(c.req.raw),c.req.param('id'),body.reason??''));});
  app.post('/v1/held/:id/resolve',async c=>{userOnly(c.get('principal').kind);const body=ResolveHeldRequest.parse(await jsonBody(c.req.raw));return c.json(await v1.resolve(c.env.DB,c.get('ownerId'),key(c.req.raw),c.req.param('id'),body));});
  app.post('/v1/submissions/:id/decision',async c=>{userOnly(c.get('principal').kind);const body=z.strictObject({decision:z.enum(['accept','skip']),answers:z.record(z.string(),z.string()).optional(),expectedRevision:z.number().int().nonnegative()}).parse(await jsonBody(c.req.raw));return c.json(await v1.decideSubmission(c.env.DB,c.get('ownerId'),key(c.req.raw),c.req.param('id'),body.decision,body.answers,body.expectedRevision));});
  app.post('/v1/submissions/:id/review',async c=>{userOnly(c.get('principal').kind);const body=z.strictObject({answers:z.record(z.string(),z.string())}).parse(await jsonBody(c.req.raw));return c.json(await v1.reviewSubmission(c.env.DB,c.get('ownerId'),c.req.param('id'),body.answers));});
  app.post('/v1/proposals',async c=>{allowed(c.get('principal'),'propose');const body=ProposeChangeRequest.parse(await jsonBody(c.req.raw));const principal=c.get('principal');return c.json(await v1.createProposal(c.env.DB,c.get('ownerId'),principal.clientId,key(c.req.raw),body,{actor:principal.kind==='user'?'user':'model',channel:principal.kind==='user'?'ui':'mcp',client:principal.clientId}));});
  app.post('/v1/proposals/:id/decision',async c=>{userOnly(c.get('principal').kind);const body=ProposalDecisionRequest.parse(await jsonBody(c.req.raw));return c.json(await v1.proposalDecision(c.env.DB,c.get('ownerId'),key(c.req.raw),c.req.param('id'),body.decision,body.note,body.expectedRevision));});
  app.post('/v1/triggers/:id/decision',async c=>{userOnly(c.get('principal').kind);const body=TriggerDecisionRequest.parse(await jsonBody(c.req.raw));return c.json(await v1.triggerDecision(c.env.DB,c.get('ownerId'),key(c.req.raw),c.req.param('id'),body.decision,body.reason,body.expectedRevision));});
  app.get('/v1/export',async c=>{userOnly(c.get('principal').kind);const state=await v1.state(c.env.DB,c.get('ownerId'));return c.json({format:'lowkkey.v1',accountId:state.accountId,exportedAt:new Date().toISOString(),snapshot:Snapshot.parse(state)});});
  app.post('/v1/import',async c=>{userOnly(c.get('principal').kind);const body=z.strictObject({format:z.literal('lowkkey.v1'),accountId:z.string(),exportedAt:z.iso.datetime({offset:true}).optional(),snapshot:z.unknown()}).parse(await jsonBody(c.req.raw,8_000_000));return c.json(await v1.importBackup(c.env.DB,c.get('ownerId'),key(c.req.raw),body));});
  app.get('/v1/clients',async c=>{userOnly(c.get('principal').kind);return c.json(await v1.listClients(c.env.DB,c.get('ownerId')));});
  app.post('/v1/clients/:id/revoke',async c=>{userOnly(c.get('principal').kind);z.strictObject({}).parse(await jsonBody(c.req.raw));const result=await v1.revokeClient(c.env.DB,c.get('ownerId'),key(c.req.raw),c.req.param('id'));const client=await v1.oauthClient(c.env.DB,c.get('ownerId'),c.req.param('id'));if(client?.grant_id&&c.env.OAUTH_PROVIDER)await c.env.OAUTH_PROVIDER.revokeGrant(client.grant_id,c.get('ownerId'));return c.json(result);});
  app.get('/v1/reviews/:kind/:id',async c=>{allowed(c.get('principal'),'read');const kind=z.enum(['submission','proposal','held','trigger']).parse(c.req.param('kind'));return c.json(await reviewDetail(c.env.DB,c.get('ownerId'),kind,c.req.param('id'),new URL(c.req.url).origin));});
  app.get('/v1/events',async c=>{
    allowed(c.get('principal'),'read');
    const ownerId=c.get('ownerId'),db=c.env.DB,starting=Number(c.req.header('Last-Event-ID')??c.req.query('after')??'0');
    if(!Number.isSafeInteger(starting)||starting<0)throw new StoreError('bad_request',400);
    const encoder=new TextEncoder();let closed=false,polling=false;let cursor=starting, timer:ReturnType<typeof setInterval>|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
    const stream=new ReadableStream<Uint8Array>({start(controller){
      const poll=async()=>{if(polling||closed)return;polling=true;try{for(const row of await v1.eventsAfter(db,ownerId,cursor)){if(closed)break;cursor=row.id;controller.enqueue(encoder.encode(`id: ${row.id}\ndata: ${JSON.stringify(row.event)}\n\n`));}}catch{closed=true;controller.error(new Error('SSE_FAILED'));if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);}finally{polling=false;}};
      void poll();timer=setInterval(()=>void poll(),2000);timeout=setTimeout(()=>{closed=true;if(timer)clearInterval(timer);controller.close();},25000);
    },cancel(){closed=true;if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);}});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
  });
  app.onError((error,c) => {
    const status = error instanceof StoreError ? error.status : error instanceof ZodError ? 400 : error instanceof NotFoundError ? 404 : error instanceof ForbiddenError ? 403 : 500;
    const code = error instanceof StoreError ? error.code : error instanceof ZodError ? 'bad_request' : error instanceof NotFoundError ? 'not_found' : error instanceof ForbiddenError ? 'forbidden' : 'internal';
    if (status === 500) console.error(JSON.stringify({event:'request.failed',requestId:c.get('requestId'),code}));
    return Response.json({ error:{ code,message:code,requestId:c.get('requestId'),retryable:status>=500,fields:error instanceof ZodError?error.issues.map(i=>({path:i.path,message:i.message})):undefined } },{ status, headers:{ 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' } });
  });
  app.notFound(context => context.json({ error:{ code:'NOT_FOUND' } },404));
  return app;
}
