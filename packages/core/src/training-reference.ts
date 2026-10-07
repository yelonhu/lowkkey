import type {Entry,Exercise,LocalDate,ProgramItem,SetEntry,TrainingReference} from '@lowkkey/protocol';
import {active,type Session} from './ledger.ts';

/** V5/V6 share the same actual-first reference. Never turn reps/RIR into a load change. */
export function trainingReference(entries:Entry[],exercise:Exercise,asOf:LocalDate,options:{session?:Session|null;item?:Partial<Pick<ProgramItem,'startLoad'|'repMin'>>;role?:'work'|'warmup'}={}):TrainingReference {
  const {session,item,role='work'}=options;
  const history=active(entries).filter((entry):entry is SetEntry=>entry.kind==='set'&&entry.exerciseId===exercise.id&&entry.setRole===role&&entry.date<=asOf)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
  const previous=session?history.filter(set=>set.sessionId===session.id).at(-1):undefined;
  const actual=previous??history.at(-1);
  const confirmed=!session||session.prescriptionOrigin==='confirmed_arrangement';
  const planned=role==='work'?item?.startLoad??null:null;
  const arrangement=confirmed&&planned!=null?{load:planned,unit:exercise.unit}:null;
  if(actual)return {source:previous?'session':'history',load:actual.load,unit:actual.unit,entryId:actual.id,date:actual.date,reps:actual.reps>0?actual.reps:null,arrangement};
  return {source:planned==null?'none':confirmed?'arrangement':'legacy_snapshot',load:planned,unit:exercise.unit,entryId:null,date:null,reps:role==='work'?item?.repMin??null:null,arrangement};
}
