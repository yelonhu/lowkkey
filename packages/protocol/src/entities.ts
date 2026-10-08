import { z } from 'zod';
import { EXERCISE_LIBRARY } from './catalog.ts';
import { Id, Instant, LocalDate, Unit } from './primitives.ts';

export const ExerciseId = z.enum(EXERCISE_LIBRARY.map(ex => ex.id) as [string, ...string[]]);
export const LoadKind = z.enum(['external', 'assist', 'bodyweight']);
const load = z.number().min(0).max(5000);
const loadFields = { exerciseId: ExerciseId, load, unit: Unit, loadKind: LoadKind };
function validLoadKind(value: { exerciseId: string; loadKind: string }) {
  return ['pull_up', 'dip'].includes(value.exerciseId) ? value.loadKind !== 'external' : value.loadKind === 'external';
}
export const TrainingSet = z.strictObject({
  ...loadFields, reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(10).nullable().optional(),
  setRole: z.enum(['work', 'warmup', 'unknown']).optional(),
}).refine(validLoadKind, '引体/双杠使用 assist 或 bodyweight；其他动作使用 external');
export type TrainingSet = z.infer<typeof TrainingSet>;
export const PlanItem = z.strictObject({
  ...loadFields, load: load.nullable(),
  sets: z.number().int().min(1).max(20),
  repMin: z.number().int().min(1).max(100),
  repMax: z.number().int().min(1).max(100),
  note: z.string().max(2000).optional(),
}).refine(v => v.repMin <= v.repMax, '次数下限不能高于上限')
  .refine(validLoadKind, '引体/双杠使用 assist 或 bodyweight；其他动作使用 external');
export type PlanItem = z.infer<typeof PlanItem>;
export const GainTarget = z.strictObject({
  start_date: LocalDate, start_lb: z.number().positive().max(1500),
  weekly_lb_min: z.number().nonnegative().max(20),
  weekly_lb_max: z.number().nonnegative().max(20),
}).refine(v => v.weekly_lb_min <= v.weekly_lb_max, '增重下限不能高于上限');
export type GainTarget = z.infer<typeof GainTarget>;
export const PlanNotes = z.strictObject({
  coach: z.string().max(4000).nullable().optional(),
  body: z.string().max(4000).nullable().optional(),
  gain_target: GainTarget.nullable().optional(),
});
export const SessionInput = z.strictObject({
  date: LocalDate,
  raw_text: z.string().min(1).max(20000).refine(v => v.trim().length > 0, '原话不能为空'),
  sets: z.array(TrainingSet).max(250),
});
export const WeightInput = z.strictObject({ date: LocalDate, lb: z.number().positive().max(1500) });
export const PlanInput = z.strictObject({ day: z.string().trim().min(1).max(80), items: z.array(PlanItem).max(50), notes: PlanNotes });
export const TrainingSession = SessionInput.extend({ updated_at: Instant });
export type TrainingSession = z.infer<typeof TrainingSession>;
export const Weight = WeightInput.extend({ updated_at: Instant });
export type Weight = z.infer<typeof Weight>;
export const Plan = PlanInput.extend({
  updated_at: Instant, body_revision: z.number().int().nullable(), gain_target_revision: z.number().int().nullable(),
});
export type Plan = z.infer<typeof Plan>;
export const Facts = z.strictObject({ sessions: z.array(TrainingSession), weights: z.array(Weight), plans: z.array(Plan) });
export type Facts = z.infer<typeof Facts>;
export const ClientPublic = z.strictObject({
  id: Id, name: z.string(), scopes: z.array(z.enum(['read', 'write'])),
  status: z.enum(['active', 'revoked']), createdAt: Instant, lastUsedAt: Instant.nullable(),
});
export type ClientPublic = z.infer<typeof ClientPublic>;
export const WeightMean = z.strictObject({ date: LocalDate, lb: z.number().nullable(), samples: z.number().int() });
export const StrengthPoint = z.strictObject({ date: LocalDate, lb: z.number(), set_index: z.number().int() });
export const StrengthSeries = z.strictObject({
  exerciseId: ExerciseId, name: z.string(), per_hand: z.boolean(), unit: z.literal('lb'),
  points: z.array(StrengthPoint), best: StrengthPoint.nullable(), latest: StrengthPoint.nullable(),
});
export type StrengthSeries = z.infer<typeof StrengthSeries>;
export const ExclusionReason = z.enum(['warmup', 'reps_out_of_range', 'missing_bodyweight', 'non_positive_load']);
export type ExclusionReason = z.infer<typeof ExclusionReason>;
const DateCoverage = z.strictObject({ first_date: LocalDate.nullable(), last_date: LocalDate.nullable(), total_dates: z.number().int().nonnegative() });
export const Brief = z.strictObject({
  generated_at: Instant,
  coverage: z.strictObject({ training: DateCoverage.extend({ returned_dates: z.number().int().nonnegative() }), weight: DateCoverage }),
  sessions: z.array(TrainingSession), plans: z.array(Plan),
  latest_weight: Weight.nullable(), weight_mean_7d: WeightMean.nullable(),
  body_notes: z.string().nullable(), gain_target: GainTarget.nullable(),
  strength: z.array(StrengthSeries.omit({ points: true }).extend({
    recorded_sets: z.number().int().nonnegative(),
    excluded_sets: z.array(z.strictObject({ reason: ExclusionReason, count: z.number().int().positive() })),
  })),
});
export type Brief = z.infer<typeof Brief>;
