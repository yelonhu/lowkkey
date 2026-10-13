import type { D1Database } from '@cloudflare/workers-types';
import { DailyNote, LocalDate, NoteInput, ReadNotesInput, type NotesPage } from '@lowkkey/protocol';
import { StoreError } from './account.ts';

export async function readNote(db:D1Database,owner:string,date:string):Promise<DailyNote> {
  LocalDate.parse(date);
  const row=await db.prepare("SELECT date,text,revision,updated_at FROM daily_notes WHERE owner_id=? AND date=? AND owner_id IN (SELECT id FROM users WHERE lifecycle='active')").bind(owner,date).first();
  return row?DailyNote.parse(row):{date,text:'',revision:0,updated_at:null};
}
export async function readNotes(db:D1Database,owner:string,args:unknown={}):Promise<NotesPage> {
  const input=ReadNotesInput.parse(args),where=["owner_id=?","text<>''","owner_id IN (SELECT id FROM users WHERE lifecycle='active')"],values:(string|number)[]=[owner];
  for(const [key,op] of [['from','>='],['to','<='],['before','<']] as const)if(input[key]){where.push('date'+op+'?');values.push(input[key]);}
  const rows=await db.prepare('SELECT date,text,revision,updated_at FROM daily_notes WHERE '+where.join(' AND ')+' ORDER BY date DESC LIMIT ?').bind(...values,input.limit+1).all();
  const notes=rows.results.slice(0,input.limit).map(row=>DailyNote.parse(row));
  return {notes,next_cursor:rows.results.length>input.limit?notes.at(-1)!.date:null};
}
export async function saveNote(db:D1Database,owner:string,date:string,value:unknown):Promise<DailyNote> {
  LocalDate.parse(date);const input=NoteInput.parse(value),now=new Date().toISOString();
  if(!await db.prepare("SELECT id FROM users WHERE id=? AND lifecycle='active'").bind(owner).first())throw new StoreError('account_unavailable',401);
  const prior=await readNote(db,owner,date);
  // An identical retry may follow a lost response. It never overwrites a newer value.
  if(prior.text===input.text)return prior;
  const result=input.revision===0
    ?await db.prepare("INSERT INTO daily_notes(owner_id,date,text,revision,updated_at) SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND lifecycle='active') ON CONFLICT(owner_id,date) DO NOTHING RETURNING date,text,revision,updated_at").bind(owner,date,input.text,now,owner).first()
    :await db.prepare("UPDATE daily_notes SET text=?,revision=revision+1,updated_at=? WHERE owner_id=? AND date=? AND revision=? AND owner_id IN (SELECT id FROM users WHERE lifecycle='active') RETURNING date,text,revision,updated_at").bind(input.text,now,owner,date,input.revision).first();
  if(result)return DailyNote.parse(result);
  throw new StoreError('note_conflict',409);
}
export async function notesSummary(db:D1Database,owner:string) {
  const row=await db.prepare("SELECT count(*) AS count,max(date) AS latest_date,max(updated_at) AS updated_at FROM daily_notes WHERE owner_id=? AND text<>''").bind(owner).first<{count:number;latest_date:string|null;updated_at:string|null}>();
  return row!;
}
export async function exportNotes(db:D1Database,owner:string) {
  return (await db.prepare('SELECT date,text,revision,updated_at FROM daily_notes WHERE owner_id=? ORDER BY date').bind(owner).all()).results.map(row=>DailyNote.parse(row));
}
