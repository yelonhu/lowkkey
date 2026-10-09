/** Read only literal data from the supplied private reference; never execute HTML. */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { Facts, SessionInput, PlanInput, WeightInput, GainTarget, CurationInput } from '@lowkkey/protocol';
import { localToday } from '@lowkkey/core';
function literal(node:ts.Expression):unknown {
  if(ts.isStringLiteral(node)||ts.isNumericLiteral(node))return ts.isNumericLiteral(node)?Number(node.text):node.text;
  if(node.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(node.kind===ts.SyntaxKind.NullKeyword)return null;
  if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.MinusToken&&ts.isNumericLiteral(node.operand))return -Number(node.operand.text);
  if(ts.isArrayLiteralExpression(node))return node.elements.map(n=>literal(n));
  if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.map(p=>{
    if(!ts.isPropertyAssignment(p)||!(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name)||ts.isNumericLiteral(p.name)))throw new Error('Reference must contain data literals only');
    return [p.name.text,literal(p.initializer)];
  }));
  throw new Error('Reference must contain data literals only');
}
export function readPrototype(path:string,stamp=new Date().toISOString()) {
  const html=readFileSync(path,'utf8'),source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!source)throw new Error('No prototype data');
  const ast=ts.createSourceFile('reference.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),values:Record<string,unknown>={};
  for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name)&&['DATA','PLANS','GAIN','CURATION'].includes(d.name.text)&&d.initializer)values[d.name.text]=literal(d.initializer);
  const data=values.DATA as {sessions:unknown[];weights:Record<string,number>},rawPlans=values.PLANS as Record<string,unknown>[],raw=values.CURATION as Record<string,unknown>;
  const sessions=data.sessions.map(s=>({...SessionInput.parse(s),updated_at:stamp}));
  const weights=Object.entries(data.weights).map(([date,lb])=>({...WeightInput.parse({date,lb}),updated_at:stamp}));
  const plans=rawPlans.map(p=>({...PlanInput.parse({...p,items:(p.items as Record<string,unknown>[]).map(({assist,...item})=>({...item,loadKind:assist?'assist':['pull_up','dip'].includes(String(item.ex))?'bodyweight':'external'}))}),updated_at:stamp}));
  const curation=CurationInput.parse({...raw,week:'2026-10-05',next:{date:'2026-10-09',text:raw.next},body:{date:'2026-10-08',text:raw.body}});
  const facts=Facts.parse({sessions,weights,plans,profile:{gain_target:GainTarget.parse(values.GAIN),body_notes:null},preferences:{theme:'ink',manual_week:null},curations:[{...curation,revision:1,updated_at:stamp}],annotations:curation.log??{},plan_history:[]});
  if(new Set(sessions.map(s=>s.date)).size!==sessions.length||new Set(plans.map(p=>p.weekday)).size!==plans.length)throw new Error('Duplicate prototype dates or weekdays');
  if(sessions.length!==16||sessions.reduce((n,s)=>n+s.sets.length,0)!==252||weights.length!==23||plans.length!==4)throw new Error('Unexpected reference counts');
  return facts;
}
const sql=(value:unknown)=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
export function importStatements(facts:Facts,owner:string,stamp=new Date().toISOString()) {
  const id=sql(owner),revision=`(SELECT data_revision FROM users WHERE id=${id})`,statements=[`INSERT INTO mutation_guard(owner_id,ok) VALUES (${id},CASE WHEN (SELECT count(*) FROM users WHERE id=${id})=1 THEN 1 ELSE 0 END) ON CONFLICT(owner_id) DO UPDATE SET ok=excluded.ok`,`UPDATE users SET data_revision=data_revision+1 WHERE id=${id}`];
  for(const s of facts.sessions)statements.push(`INSERT INTO showroom_sessions(owner_id,date,title,note,sets_json,updated_at) VALUES (${id},${sql(s.date)},${sql(s.title)},${sql(s.note)},${sql(JSON.stringify(s.sets))},${sql(stamp)}) ON CONFLICT(owner_id,date) DO UPDATE SET title=excluded.title,note=excluded.note,sets_json=excluded.sets_json,updated_at=excluded.updated_at`);
  for(const w of facts.weights)statements.push(`INSERT INTO showroom_weights VALUES (${id},${sql(w.date)},${w.lb},${sql(stamp)}) ON CONFLICT(owner_id,date) DO UPDATE SET lb=excluded.lb,updated_at=excluded.updated_at`);
  // The UNIQUE weekday constraint deliberately aborts a conflict with another title.
  for(const p of facts.plans)statements.push(`INSERT INTO showroom_plans VALUES (${id},${sql(p.title)},${p.weekday},${sql(p.coach)},${sql(JSON.stringify(p.items))},${sql(stamp)}) ON CONFLICT(owner_id,title) DO UPDATE SET weekday=excluded.weekday,coach=excluded.coach,items_json=excluded.items_json,updated_at=excluded.updated_at`);
  statements.push(`INSERT INTO profiles(owner_id,gain_target_json) VALUES (${id},${sql(JSON.stringify(facts.profile.gain_target))}) ON CONFLICT(owner_id) DO UPDATE SET gain_target_json=excluded.gain_target_json`);
  const curation=facts.curations[0],json=sql(JSON.stringify({...curation,updated_at:stamp})),saved=`json_set(${json},'$.revision',${revision})`;
  statements.push(`INSERT INTO curations VALUES (${id},${sql(curation.week)},${saved}) ON CONFLICT(owner_id,week) DO UPDATE SET value_json=excluded.value_json`,`INSERT INTO curation_versions VALUES (${id},${revision},${sql(curation.week)},${saved},${sql(stamp)})`);
  for(const [date,text] of Object.entries(facts.annotations))statements.push(`INSERT INTO annotations VALUES (${id},${sql(date)},${sql(text)}) ON CONFLICT(owner_id,date) DO UPDATE SET text=excluded.text`);
  statements.push(`INSERT INTO plan_history SELECT ${id},${revision},${sql(localToday(new Date(stamp)))},json_group_array(json_object('title',title,'weekday',weekday,'coach',coach,'items',json(items_json),'updated_at',updated_at)) FROM showroom_plans WHERE owner_id=${id}`);
  return statements;
}
