import type { ProgramItem } from '@lowkkey/protocol';
import type { Session } from '@lowkkey/core';
import type { V1State } from '../server/v1-store.ts';

// A session owns the prescription captured when it started, even if the
// current weekly plan is later edited or removed on another device.
export function sessionItems(state:V1State,session:Session|null):ProgramItem[]{
  return session?.prescription??state.program.days.find(day=>day.id===session?.dayId)?.items??[];
}

export type TrainingItem={exerciseId:string;sets?:number;repMin?:number;repMax?:number;startLoad?:number|null;note?:string};
export function trainingItems(state:V1State,session:Session|null,selected?:string|null):TrainingItem[]{
  const prescribed:TrainingItem[]=[...sessionItems(state,session)];
  const ids=[...new Set([...(session?.sets.map(set=>set.exerciseId)??[]),...(selected?[selected]:[])])];
  for(const exerciseId of ids)if(!prescribed.some(item=>item.exerciseId===exerciseId)&&state.exercises.some(ex=>ex.id===exerciseId))prescribed.push({exerciseId});
  return prescribed;
}
