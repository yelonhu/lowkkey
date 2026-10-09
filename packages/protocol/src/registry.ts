import { z } from 'zod';
import { TrainingSession, TrainingSet, Weight, Plan, PlanItem, GainTarget, Brief, Profile, Preferences, Curation, PlanHistory, ThemeState } from './entities.ts';
import { StateResponse, ApiError, Backup } from './api.ts';
for (const [id, schema] of Object.entries({ TrainingSession, TrainingSet, Weight, Plan, PlanItem, GainTarget, Brief, Profile, Preferences, Curation, PlanHistory, ThemeState, StateResponse, ApiError, Backup })) {
  if (!z.globalRegistry.has(schema)) z.globalRegistry.add(schema, { id });
}
