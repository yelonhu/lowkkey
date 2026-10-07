import type { ProgramItem } from '@lowkkey/protocol';
import type { Session } from '@lowkkey/core';
import type { V1State } from '../server/v1-store.ts';

// A session owns the prescription captured when it started, even if the
// current weekly plan is later edited or removed on another device.
export function sessionItems(state:V1State,session:Session|null):ProgramItem[]{
  return session?.prescription??state.program.days.find(day=>day.id===session?.dayId)?.items??[];
}
