import { it,expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { Facts } from '@lowkkey/protocol';
import { importStatements } from '../scripts/prototype-data.ts';
import { state } from '../src/server/store.ts';
import type { D1Database } from '@cloudflare/workers-types';
it('migrates legacy facts, blocks interleaved old writes, rolls back, imports atomically and retires only old tables',async()=>{
 const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-30',cf:false,d1Databases:{DB:'migration'},outboundService:()=>{throw new Error('No network');}});
 try{
 const db=await runtime.getD1Database('DB') as D1Database;
 const migration=async(name:string)=>{const sql=await readFile('db/showroom-migrations/'+name,'utf8');await db.batch(sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));};
 await migration('0000_schema.sql');
 const stamp='2026-10-08T18:00:00.000Z';
 for(const id of ['one','two'])await db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').bind(id,id,id+'@example.com',5,stamp).run();
 const sets=JSON.stringify([{exerciseId:'bench_press',load:100,unit:'lb',loadKind:'external',reps:8,rir:2,setRole:'work'}]);
 await db.prepare('INSERT INTO training_sessions VALUES (?,?,?,?,?)').bind('one','2026-09-01','Original must remain in backup',sets,stamp).run();
 await db.prepare('INSERT INTO weights VALUES (?,?,?,?)').bind('two','2026-10-08',190,stamp).run();
 await db.prepare('INSERT INTO plans VALUES (?,?,?,?,?,?,?,?,?)').bind('one','胸（周三）','[]',null,'older',JSON.stringify({start_date:'2026-09-01',start_lb:140,weekly_lb_min:.55,weekly_lb_max:.77}),1,1,stamp).run();
 await db.prepare('INSERT INTO plans VALUES (?,?,?,?,?,?,?,?,?)').bind('one','背','[]',null,null,null,2,null,stamp).run();
 await migration('0001_v5.sql');
 const migrated=await state(db,'one');expect(migrated.profile).toEqual({body_notes:null,gain_target:{start:'2026-09-01',startLb:140,min:.55,max:.77}});expect(migrated.sessions[0].sets[0]).toMatchObject({ex:'bench_press',kind:'external',role:'work'});
 await expect(db.prepare('INSERT INTO weights VALUES (?,?,?,?)').bind('one','2026-10-08',140,stamp).run()).rejects.toThrow('v5_migration_retry');
 await db.prepare('CREATE TABLE d1_migrations(name TEXT)').run();await db.prepare("INSERT INTO d1_migrations VALUES ('0001_v5.sql')").run();
 const rollback=(await readFile('db/showroom-release/rollback-before-cutover.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean);await db.batch(rollback.map(s=>db.prepare(s)));
 expect((await db.prepare('SELECT raw_text FROM training_sessions').first<{raw_text:string}>())?.raw_text).toBe('Original must remain in backup');
 await db.prepare('INSERT INTO weights VALUES (?,?,?,?)').bind('one','2026-10-08',140,stamp).run();await migration('0001_v5.sql');
 const restored=await state(db,'one');const facts=Facts.parse(Object.fromEntries(Object.keys(Facts.shape).map(key=>[key,restored[key as keyof typeof restored]])));

 // Build a literal facts object: strict schema excludes REST metadata.
 facts.sessions=[{date:'2026-10-08',title:'胸',note:'用户原话',sets:migrated.sessions[0].sets,updated_at:stamp}];facts.weights=[{date:'2026-10-08',lb:145,updated_at:stamp}];facts.plans=[{title:'胸',weekday:3,items:[{ex:'bench_press',load:100,unit:'lb',loadKind:'external',sets:3,min:8,max:10}],updated_at:stamp}];facts.curations=[{week:'2026-10-05',recap:{title:'本周',letter:['正文']},revision:1,updated_at:stamp}];facts.annotations={'2026-10-08':'批注'};
 await db.batch(importStatements(facts,'one',stamp).map(s=>db.prepare(s)));
 let imported=await state(db,'one');expect(imported.sessions).toHaveLength(2);expect(imported.weights[0].lb).toBe(145);expect(imported.annotations['2026-10-08']).toBe('批注');expect(imported.plan_history[0].effective_date).toBe('2026-10-08');expect((await state(db,'two')).weights[0].lb).toBe(190);
 const invalid=structuredClone(facts);invalid.weights[0].lb=999;invalid.plans.push({...facts.plans[0],title:'冲突'});
 await expect(db.batch(importStatements(invalid,'one',stamp).map(s=>db.prepare(s)))).rejects.toThrow();imported=await state(db,'one');expect(imported.weights[0].lb).toBe(145);
 const retire=(await readFile('db/showroom-release/retire-v4.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean);await db.batch(retire.map(s=>db.prepare(s)));expect((await state(db,'one')).sessions).toHaveLength(2);expect((await db.prepare("SELECT name FROM sqlite_master WHERE name='auth_user'").all()).results).toHaveLength(1);expect((await db.prepare("SELECT name FROM sqlite_master WHERE name='training_sessions'").all()).results).toHaveLength(0);
 }finally{await runtime.dispose();}
});
