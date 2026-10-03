import { writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const [operation,email,config,location]=process.argv.slice(2);
if(!['add','revoke'].includes(operation)||!email||!/^\S+@\S+\.\S+$/.test(email)||!config||!['--local','--remote'].includes(location))throw new Error('Usage: node scripts/invite.mjs add|revoke email config --local|--remote');
const address=email.trim().toLowerCase().replaceAll("'","''"),now=new Date().toISOString();
const sql=operation==='add'?`INSERT INTO auth_invites(email,created_at) VALUES ('${address}','${now}') ON CONFLICT(email) DO UPDATE SET revoked_at=NULL;`:`UPDATE auth_invites SET revoked_at='${now}' WHERE email='${address}'; DELETE FROM auth_session WHERE userId IN (SELECT id FROM auth_user WHERE email='${address}'); UPDATE v1_clients SET status='revoked',revoked_at='${now}' WHERE owner_id IN (SELECT owner_id FROM auth_owners JOIN auth_user ON auth_user.id=auth_owners.user_id WHERE email='${address}');`;
const folder=await mkdtemp(join(tmpdir(),'lowkkey-invite-'));try{const file=join(folder,'invite.sql');await writeFile(file,sql,{mode:0o600});const child=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB',location,'--config',config,'--file',file,'--yes',...(location==='--local'?['--persist-to',process.env.LOWKKEY_DATA_DIR??'.data/v02']:[])],{stdio:'inherit'});process.exitCode=child.status??1;}finally{await rm(folder,{recursive:true,force:true});}
