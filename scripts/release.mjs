import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { environment, root } from './environment.mjs';

process.chdir(root);
const config = 'wrangler.showroom-beta.json';
const settings = JSON.parse(readFileSync(config, 'utf8'));
if (settings.name !== 'lowkkey-showroom-beta' || settings.d1_databases[0].database_name !== 'lowkkey-showroom-beta' || settings.d1_databases[0].migrations_dir !== 'db/showroom-migrations' || settings.vars.AUTH_MODE !== 'customer') throw new Error('Unexpected release target');
const credentials = Object.fromEntries(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
const env = environment({ ...credentials, NODE_ENV: 'production', LOWKKEY_WRANGLER_CONFIG: config });
const [command, ...args] = process.argv.slice(2);
const secretsFile = '.local/config/showroom-beta.secrets.json';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function run(argv, extra = {}) {
  const child = spawnSync(process.execPath, argv, { env, stdio: 'inherit', ...extra });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
const wrangler = (...args) => run(['node_modules/wrangler/bin/wrangler.js', ...args, '--config', config]);
function privateQuery(sql, file) {
  const output = execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--remote','--command',sql,'--json','--config',config],{env,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(output);if(result.some(r=>r.success===false))throw new Error('Remote query failed');
  if(file)writeFileSync(file,JSON.stringify(result,null,2),{mode:0o600});
  return result;
}
const privateDirectory='.local/v5';
mkdirSync(privateDirectory,{recursive:true,mode:0o700});
function privateExport(output) {
  // Wrangler prints a temporary signed download URL: keep the entire log private.
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','export','DB','--remote','--output',output,'--config',config],{env,encoding:'utf8'});
  writeFileSync(output+'.log',(result.stdout??'')+(result.stderr??''),{mode:0o600});
  if(result.status!==0)throw new Error('Backup failed; inspect its private log');
}
function provisioned() {
  if (!/^[\da-f-]{36}$/.test(settings.d1_databases[0].database_id) || !/^[\da-f]{32}$/.test(settings.kv_namespaces[0].id)) throw new Error('Provision new D1 and KV; replace release config placeholders first');
  const legacy = JSON.parse(readFileSync('wrangler.json', 'utf8'));
  if (legacy.d1_databases.some(db => db.database_id === settings.d1_databases[0].database_id) || legacy.kv_namespaces.some(kv => kv.id === settings.kv_namespaces[0].id)) throw new Error('Release must not use legacy storage');
}
switch (command) {
  case 'login': wrangler('login', '--browser=false', '--scopes', 'account:read', 'user:read', 'workers:write', 'workers_kv:write', 'workers_scripts:write', 'd1:write'); break;
  case 'whoami': wrangler('whoami'); break;
  case 'resources': wrangler('d1', 'list', '--json'); wrangler('kv', 'namespace', 'list'); break;
  case 'create-d1': wrangler('d1', 'create', settings.d1_databases[0].database_name, '--update-config=false'); break;
  case 'create-kv': wrangler('kv', 'namespace', 'create', 'lowkkey-showroom-beta-oauth', '--update-config=false'); break;
  case 'init-secrets': {
    if (existsSync(secretsFile)) throw new Error('Secrets file already exists; it will not be overwritten');
    writeFileSync(secretsFile, JSON.stringify({ BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, null, 2) + '\n', { mode: 0o600 });
    console.log('Created ignored, private secrets file. Fill Google credentials locally; do not paste them into chat.');
    break;
  }
  case 'backup-v5': {
    provisioned();
    const stamp=new Date().toISOString().replaceAll(':','-');
    const output=privateDirectory+'/before-v5-'+stamp+'.sql';
    privateExport(output);
    chmodSync(output,0o600);
    const rows=privateQuery("SELECT u.id,u.email,u.data_revision,(SELECT count(*) FROM training_sessions WHERE owner_id=u.id) sessions,(SELECT coalesce(sum(json_array_length(sets_json)),0) FROM training_sessions WHERE owner_id=u.id) sets,(SELECT count(*) FROM weights WHERE owner_id=u.id) weights,(SELECT count(*) FROM plans WHERE owner_id=u.id AND json_array_length(items_json)>0) plans FROM users u",privateDirectory+'/preflight.json');
    const unknown=privateQuery("SELECT day FROM plans WHERE json_array_length(items_json)>0 AND day NOT IN ('胸','背','肩','腿','肩（周五）','腿（周日）','背（周二）','胸（周三）')");
    if(unknown[0].results.length)throw new Error('Unmapped plan weekdays: review private backup before migrating');
    writeFileSync(privateDirectory+'/backup-manifest.json',JSON.stringify({output,sha:git('rev-parse','HEAD'),created_at:stamp}),{mode:0o600});
    console.log('Private backup saved. Account counts:', rows[0].results.map(({sessions,sets,weights,plans})=>({sessions,sets,weights,plans})));
    break;
  }
  case 'import-v5': {
    provisioned();
    if(args.length!==2)throw new Error('Usage: release import-v5 PRIVATE_HTML EMAIL');
    const backup=JSON.parse(readFileSync(privateDirectory+'/backup-manifest.json','utf8'));if(!existsSync(backup.output))throw new Error('Private backup required');
    const {readPrototype,importStatements}=await import('./prototype-data.ts');
    const facts=readPrototype(args[0]);
    const owner=privateQuery("SELECT id FROM users WHERE email='"+args[1].replaceAll("'","''")+"'")[0].results;
    if(owner.length!==1)throw new Error('Expected exactly one existing account');
    const statements=importStatements(facts,owner[0].id);
    const file=privateDirectory+'/import.sql';writeFileSync(file,statements.join(';\n')+';\n',{mode:0o600});
    wrangler('d1','execute','DB','--remote','--file',file,'--yes');
    const id=owner[0].id.replaceAll("'","''");
    const saved=privateQuery("SELECT date,title,note,sets_json FROM showroom_sessions WHERE owner_id='"+id+"'; SELECT date,lb FROM showroom_weights WHERE owner_id='"+id+"'; SELECT title,weekday,coach,items_json FROM showroom_plans WHERE owner_id='"+id+"'; SELECT gain_target_json FROM profiles WHERE owner_id='"+id+"'; SELECT value_json FROM curations WHERE owner_id='"+id+"'",privateDirectory+'/verified-v5.json');
    const assert=(ok)=>{if(!ok)throw new Error('Import verification failed; legacy fields retained');};
    for(const s of facts.sessions){const row=saved[0].results.find(r=>r.date===s.date);assert(row&&row.title===s.title&&row.note===(s.note??null)&&JSON.stringify(JSON.parse(row.sets_json))===JSON.stringify(s.sets));}
    for(const w of facts.weights)assert(saved[1].results.some(r=>r.date===w.date&&r.lb===w.lb));
    for(const p of facts.plans)assert(saved[2].results.some(r=>r.title===p.title&&r.weekday===p.weekday&&r.coach===(p.coach??null)&&JSON.stringify(JSON.parse(r.items_json))===JSON.stringify(p.items)));
    assert(JSON.stringify(JSON.parse(saved[3].results[0].gain_target_json))===JSON.stringify(facts.profile.gain_target));
    const c=JSON.parse(saved[4].results.find(r=>JSON.parse(r.value_json).week===facts.curations[0].week).value_json);const content={...c},expected={...facts.curations[0]};for(const value of [content,expected]){delete value.revision;delete value.updated_at;}assert(JSON.stringify(content)===JSON.stringify(expected));
    writeFileSync(privateDirectory+'/import-verified.json',JSON.stringify({owner:owner[0].id,commit:git('rev-parse','HEAD'),sessions:facts.sessions.length,sets:facts.sessions.reduce((n,s)=>n+s.sets.length,0),weights:facts.weights.length,plans:facts.plans.length}),{mode:0o600});
    console.log('Verified all reference fields: 16 sessions, 252 sets, 23 weights, 4 plans, profile and curation. Other dates retained.');break;
  }
  case 'retire-v4': {
    provisioned();
    const proof=JSON.parse(readFileSync(privateDirectory+'/import-verified.json','utf8'));
    if(proof.commit!==git('rev-parse','HEAD'))throw new Error('Verify import at this release first');
    // Export again after verification so rollback also includes any intervening v5 writes.
    const output=privateDirectory+'/verified-before-retirement.sql';
    if(existsSync(output))throw new Error('Retirement backup already exists; inspect before retrying');
    privateExport(output);chmodSync(output,0o600);
    wrangler('d1','execute','DB','--remote','--file','db/showroom-release/retire-v4.sql','--yes');break;
  }
  case 'migrate': provisioned(); wrangler('d1', 'migrations', 'apply', 'DB', '--remote'); break;
  case 'invite': {
    provisioned();
    if (args.length !== 1) throw new Error('Usage: ./scripts/release invite EMAIL');
    run(['scripts/invite.mjs', 'add', args[0], config, '--remote']); break;
  }
  case 'build': run(['node_modules/vite/bin/vite.js', 'build']); break;
  case 'deploy': {
    provisioned();
    if (git('status', '--porcelain')) throw new Error('Commit the release before deployment so /healthz identifies the exact source');
    if (!existsSync(secretsFile)) throw new Error('Run init-secrets and configure Google credentials first');
    const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
    if (Object.keys(secrets).some(key => !['BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].includes(key)) || typeof secrets.BETTER_AUTH_SECRET !== 'string' || secrets.BETTER_AUTH_SECRET.length < 32 || typeof secrets.GOOGLE_CLIENT_ID !== 'string' || !secrets.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com') || typeof secrets.GOOGLE_CLIENT_SECRET !== 'string' || !secrets.GOOGLE_CLIENT_SECRET) throw new Error('Incomplete or unexpected release secrets');
    chmodSync(secretsFile, 0o600);
    const sha = git('rev-parse', 'HEAD');
    run(['node_modules/vite/bin/vite.js', 'build']);
    // The Vite plugin generates the worker entrypoint and asset paths here.
    const generated = JSON.parse(readFileSync('.wrangler/deploy/config.json', 'utf8'));
    run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', '.wrangler/deploy/' + generated.configPath, '--secrets-file', secretsFile, '--tag', sha.slice(0, 12)]);
    console.log('Published commit ' + sha + ' at ' + settings.vars.APP_ORIGIN);
    break;
  }
  case 'status': {
    for (const path of ['/healthz', '/api/auth/config', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await fetch(settings.vars.APP_ORIGIN + path);
      console.log(path, response.status, await response.text());
    }
    break;
  }
  default: console.log('Usage: ./scripts/release login|whoami|resources|create-d1|create-kv|init-secrets|backup-v5|migrate|import-v5 PRIVATE_HTML EMAIL|retire-v4|invite EMAIL|build|deploy|status');
}
