import type { ExerciseDefinition } from './training.ts';
import { setupInputSchema } from './training.ts';
import type { z } from 'zod';
export function defaultSetup(definition: ExerciseDefinition, unit: 'kg' | 'lb', id: string): z.infer<typeof setupInputSchema> {
  const approved = definition.scope === 'system' && definition.catalogReview?.status === 'approved';
  const assistance = ['bdeba6ce-c5ba-4a1b-9910-000000000003', 'bdeba6ce-c5ba-4a1b-9910-000000000006'].includes(definition.id);
  const semantics = !approved ? 'unspecified' : assistance ? 'assistance' : definition.equipmentType === 'barbell' || definition.equipmentType === 'cable' ? 'external_total' : definition.equipmentType === 'dumbbell' ? 'per_side' : definition.equipmentType === 'bodyweight' ? 'bodyweight_only' : 'unspecified';
  const bar = approved && definition.equipmentType === 'barbell';
  return setupInputSchema.parse({ id, exerciseId: definition.id, loadUnit: unit, loadSemantics: semantics,
    includesBar: bar ? true : null, barWeightDecimal: bar ? unit === 'lb' ? '45' : '20' : null, barUnit: bar ? unit : null,
    defaultsOrigin: approved ? { schemaVersion: 1, ruleVersion: 'training-defaults-v1', catalogVersion: definition.catalogVersion,
      defaultedFields: bar ? ['loadSemantics', 'includesBar', 'barWeightDecimal', 'barUnit'] : ['loadSemantics'], overriddenFields: [] } : null });
}
