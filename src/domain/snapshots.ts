import { z } from 'zod';
import { rpeSchema, scaledSchema, uuidSchema } from './primitives.ts';

export const provenanceSchema = z.enum(['label', 'reference', 'user_entered', 'recipe', 'ai_estimate', 'calculated']);
export const nutrientSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1), energyMkcal: scaledSchema.nullable(), proteinMg: scaledSchema.nullable(),
  carbsMg: scaledSchema.nullable(), fatMg: scaledSchema.nullable(), estimated: z.boolean(),
  provenance: provenanceSchema, referenceVersion: z.string().nullable(), calculationVersion: z.string().nullable(),
}).refine(value => value.provenance !== 'ai_estimate' || value.estimated, 'AI estimates must remain estimated');
const plannedExerciseSchema = z.strictObject({
  setupId: uuidSchema, ordinal: z.number().int().positive(), plannedSets: z.number().int().min(1).max(30).nullable(),
  repMin: z.number().int().min(1).max(200).nullable(), repMax: z.number().int().min(1).max(200).nullable(),
  targetRpe: rpeSchema.nullable(), note: z.string().nullable(),
}).refine(value => value.repMin === null || value.repMax === null || value.repMin <= value.repMax, 'Invalid rep interval');
export const planSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  templates: z.array(z.strictObject({ templateId: uuidSchema, title: z.string(), exercises: z.array(plannedExerciseSchema) })),
  weeklySchedule: z.array(z.strictObject({ weekday: z.number().int().min(1).max(7), templateIds: z.array(uuidSchema), plannedRest: z.boolean() })),
}).superRefine((value, ctx) => {
  const ids = value.templates.map(template => template.templateId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate template ID' });
  const weekdays = value.weeklySchedule.map(day => day.weekday);
  if (new Set(weekdays).size !== weekdays.length) ctx.addIssue({ code: 'custom', message: 'Duplicate weekday' });
  for (const day of value.weeklySchedule) {
    if (day.plannedRest && day.templateIds.length) ctx.addIssue({ code: 'custom', message: 'Rest cannot include training' });
    if (day.templateIds.some(id => !ids.includes(id))) ctx.addIssue({ code: 'custom', message: 'Unresolved template reference' });
  }
});
export const recoveryNoteSchema = z.strictObject({
  schemaVersion: z.literal(1), sleepHours: z.number().min(0).max(24).nullable(),
  readiness: z.enum(['good', 'normal', 'low', 'unknown']), discomfortText: z.string().nullable(),
});
export type NutrientSnapshot = z.infer<typeof nutrientSnapshotSchema>;
export type PlanSnapshot = z.infer<typeof planSnapshotSchema>;
export type RecoveryNote = z.infer<typeof recoveryNoteSchema>;
