import { z } from 'zod';
import { EXERCISE_LIBRARY } from './catalog.ts';
import { Id, Instant, LocalDate, Unit } from './primitives.ts';
const text = (max: number) => z.string().refine(v => Array.from(v).length <= max, `最多 ${max} 字`);
const prose = (max: number) => text(max).refine(v => !/[!！]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(v), '不使用 emoji 或感叹号');
export const ExerciseId = z.enum(['custom', ...EXERCISE_LIBRARY.map(ex => ex.id)] as [string, ...string[]]);
export const MainExercise = z.enum(['back_squat','bench_press','db_shoulder_press','pull_up']);
export const LoadKind = z.enum(['external','assist','bodyweight']);
const load = z.number().min(0).max(5000);
const loadFields = { ex: ExerciseId, name: text(40).trim().min(1).optional(), load, unit: Unit, per: z.literal('side').optional() };
function validExercise(v: {ex:string;name?:string}) { return v.ex !== 'custom' || !!v.name; }
function validKind(ex: string, kind: string) { return ['pull_up','dip'].includes(ex) ? kind !== 'external' : kind === 'external'; }
export const TrainingSet = z.strictObject({ ...loadFields, kind: LoadKind, reps: z.number().int().min(0).max(100), rir: z.number().int().min(0).max(10).nullable().default(null), role: z.enum(['work','warmup','backoff','drop','unknown']).default('work'), cheat: z.number().int().min(0).max(20).optional(), partial: z.boolean().optional() })
  .refine(validExercise, {message:'custom 必须填写 name',path:['name']})
  .refine(v=>validKind(v.ex,v.kind), {message:'引体和双杠使用 assist/bodyweight；其他动作使用 external',path:['kind']})
  .refine(v=>(v.cheat??0)<=v.reps,{message:'借力次数不能超过总次数',path:['cheat']});
export type TrainingSet = z.infer<typeof TrainingSet>;
export const PlanItem = z.strictObject({ ...loadFields, load: load.nullable(), loadKind: LoadKind, sets:z.number().int().min(1).max(20), min:z.number().int().min(1).max(100), max:z.number().int().min(1).max(100), optional:z.boolean().optional(), note:text(2000).optional(), restSec:z.number().int().min(0).max(1800).optional(), targetRir:z.number().int().min(0).max(5).optional(), nextLoad:load.optional(), progressRule:z.enum(['all_sets_reach_max','top_set_reach_max']).optional() })
  .refine(validExercise,{message:'custom 必须填写 name',path:['name']})
  .refine(v=>validKind(v.ex,v.loadKind),{message:'负重类型与动作不符',path:['loadKind']})
  .refine(v=>v.min<=v.max,{message:'次数下限不能高于上限',path:['min']});
export type PlanItem = z.infer<typeof PlanItem>;
export const GainTarget = z.strictObject({ start:LocalDate,startLb:z.number().positive().max(1500),min:z.number().nonnegative().max(20),max:z.number().nonnegative().max(20) }).refine(v=>v.min<=v.max,{message:'下限不能高于上限',path:['min']});
export type GainTarget = z.infer<typeof GainTarget>;
export const Profile = z.strictObject({ gain_target:GainTarget.nullable(),body_notes:text(4000).nullable(),training_context:text(4000).nullable().default(null) });
export type Profile = z.infer<typeof Profile>;
export const ProfileInput = Profile.partial().extend({training_context:text(4000).nullable().optional()});
export const Theme = z.enum(['ink','gold','pearl']);
export const Preferences = z.strictObject({theme:Theme,manual_week:LocalDate.nullable()});
export type Preferences = z.infer<typeof Preferences>;
export const ThemeInput = z.strictObject({theme:Theme});
export const SessionInput = z.strictObject({date:LocalDate,title:text(40).trim().min(1),sets:z.array(TrainingSet).max(250),note:text(200).optional()});
export const WeightInput = z.strictObject({date:LocalDate,lb:z.number().positive().max(1500)});
export const PlanInput = z.strictObject({title:text(40).trim().min(1),weekday:z.number().int().min(0).max(6),coach:prose(4000).nullable().optional(),items:z.array(PlanItem).max(50)});
export const TrainingSession = SessionInput.extend({updated_at:Instant});
export type TrainingSession = z.infer<typeof TrainingSession>;
export const Weight = WeightInput.extend({updated_at:Instant});
export type Weight = z.infer<typeof Weight>;
export const Plan = PlanInput.extend({updated_at:Instant});
export type Plan = z.infer<typeof Plan>;
export const Pick = z.strictObject({kind:z.enum(['barbell','dumbbell','assist','weight','rhythm']),ex:ExerciseId.optional(),name:text(40).optional(),date:LocalDate,title:prose(24).min(1),note:prose(80)});
export type Pick = z.infer<typeof Pick>;
export const Recap = z.strictObject({ title:prose(12).nullable().optional(),letter:z.array(prose(240).min(1)).min(1).max(5).nullable().optional(),sign:z.string().regex(/^(?:claude|AI) · \d{2}\.\d{2}$/).nullable().optional(),picks:z.array(Pick).min(1).max(2).nullable().optional(),focus:z.strictObject({ex:MainExercise,why:prose(160).min(1)}).nullable().optional() });
const mondayDate = LocalDate.refine(d=>new Date(d+'T00:00:00Z').getUTCDay()===1,'week 必须为周一');
export const CurationInput = z.strictObject({ week:mondayDate, theme:z.strictObject({id:Theme,why:prose(40).min(1)}).nullable().optional(),next:z.strictObject({date:LocalDate,text:prose(120).min(1)}).nullable().optional(),recap:Recap.nullable().optional(),body:z.strictObject({date:LocalDate,text:prose(160).min(1)}).nullable().optional(),log:z.record(LocalDate,prose(100).nullable()).optional() });
export type CurationInput = z.infer<typeof CurationInput>;
export const Curation = CurationInput.extend({updated_at:Instant,revision:z.number().int()});
export type Curation = z.infer<typeof Curation>;
export const PlanHistory = z.strictObject({effective_date:LocalDate,revision:z.number().int(),plans:z.array(Plan)});
export type PlanHistory = z.infer<typeof PlanHistory>;
export const Facts = z.strictObject({sessions:z.array(TrainingSession),weights:z.array(Weight),plans:z.array(Plan),profile:Profile,preferences:Preferences,curations:z.array(Curation),annotations:z.record(LocalDate,z.string()),plan_history:z.array(PlanHistory)});
export type Facts = z.infer<typeof Facts>;
export const ThemeState = z.strictObject({user:Theme,active:Theme,manual_this_week:z.boolean()});
export const ClientPublic = z.strictObject({id:Id,name:z.string(),scopes:z.array(z.enum(['read','write'])),status:z.enum(['active','revoked']),createdAt:Instant,lastUsedAt:Instant.nullable(),firstReadAt:Instant.nullable(),firstWriteAt:Instant.nullable()});
export type ClientPublic = z.infer<typeof ClientPublic>;
export const DeleteInput = z.strictObject({kind:z.enum(['session','weight']),date:LocalDate});
export const Deleted = DeleteInput.extend({deleted:z.union([TrainingSession,Weight])});
export const BriefInput = z.strictObject({sessions:z.number().int().min(0).max(30).default(6),session_date:LocalDate.optional()});
export const WeightMean = z.strictObject({date:LocalDate,lb:z.number().nullable(),n:z.number().int()});
export const StrengthPoint = z.strictObject({date:LocalDate,e1rm:z.number(),set_index:z.number().int()});
export const StrengthSeries = z.strictObject({ex:MainExercise,points:z.array(StrengthPoint),first:StrengthPoint.nullable(),best:StrengthPoint.nullable(),latest:StrengthPoint.nullable()});
export type StrengthSeries = z.infer<typeof StrengthSeries>;
export type ExclusionReason = 'warmup'|'drop'|'partial_rom'|'unknown_total_load'|'reps_out_of_range'|'missing_bodyweight'|'non_positive_load';
export const Fact = z.union([
  z.strictObject({kind:z.literal('pr'),ex:MainExercise,date:LocalDate,e1rm:z.number(),prev_e1rm:z.number()}),
  z.strictObject({kind:z.literal('threshold'),ex:MainExercise,date:LocalDate,what:z.enum(['一片','两片','超过体重']),load:z.number()}),
  z.strictObject({kind:z.literal('stall'),ex:MainExercise,sessions:z.number().int()}),
  z.strictObject({kind:z.literal('unstuck'),ex:MainExercise,date:LocalDate,after_sessions:z.number().int()}),
  z.strictObject({kind:z.literal('first'),ex:ExerciseId,date:LocalDate,what:z.enum(['徒手','不借力做满'])}),
  z.strictObject({kind:z.literal('streak'),weeks:z.number().int()}),
  z.strictObject({kind:z.literal('weight'),status:z.enum(['above','within','below']).nullable(),rate14:z.number(),mean7:z.number().nullable()}),
  z.strictObject({kind:z.literal('missed'),date:LocalDate,title:z.string()}),
]);
export type Fact = z.infer<typeof Fact>;
const briefPoint = StrengthPoint.omit({set_index:true});
export const NOTE_LIMIT = 20_000;
export const DailyNote = z.strictObject({date:LocalDate,text:text(NOTE_LIMIT),revision:z.number().int().nonnegative(),updated_at:Instant.nullable()});
export type DailyNote = z.infer<typeof DailyNote>;
export const NoteInput = z.strictObject({text:text(NOTE_LIMIT),revision:z.number().int().nonnegative()});
export const ReadNotesInput = z.strictObject({from:LocalDate.optional(),to:LocalDate.optional(),before:LocalDate.optional(),limit:z.number().int().min(1).max(30).default(14)})
  .refine(v=>!v.from||!v.to||v.from<=v.to,{path:['to'],message:'结束日期不能早于开始日期'});
export const NotesPage = z.strictObject({notes:z.array(DailyNote),next_cursor:LocalDate.nullable()});
export type NotesPage = z.infer<typeof NotesPage>;
export const NotesSummary = z.strictObject({count:z.number().int().nonnegative(),latest_date:LocalDate.nullable(),updated_at:Instant.nullable()});

export const Brief = z.strictObject({generated_at:Instant,notes:NotesSummary.optional(),timezone:z.string().optional(),permissions:z.array(z.enum(['read','write'])).optional(),onboarding:z.object({completed:z.boolean(),entry:z.enum(['start','existing']).nullable(),next_step:z.string()}).optional(),session:TrainingSession.nullable().optional(),today:z.object({date:LocalDate,weekday:z.number().int()}),next:z.object({date:LocalDate,rel:z.string(),title:z.string()}).nullable(),plans:z.array(Plan),profile:Profile,theme_state:ThemeState,
  weight:z.object({latest:WeightInput.nullable(),mean7:WeightMean.nullable(),rate14:z.number().nullable(),status:z.enum(['above','within','below']).nullable()}),
  strength:z.array(z.object({ex:MainExercise,best:briefPoint.nullable(),latest:briefPoint.nullable(),first:briefPoint.nullable(),rel_bw:z.number().nullable(),assistance:z.object({date:LocalDate,kg:z.number(),reps:z.number(),self_percent:z.number().nullable()}).nullable()})),
  exercises:z.array(z.object({ex:ExerciseId,name:z.string(),last:z.object({date:LocalDate,compact:z.string()}),prev:z.object({date:LocalDate,compact:z.string()}).nullable()})),
  sessions:z.array(z.object({date:LocalDate,title:z.string(),note:z.string().optional(),compact_by_ex:z.record(z.string(),z.string()),prs:z.array(ExerciseId)})),
  week_facts:z.array(Fact),curation:z.object({current:Curation.nullable(),history:z.array(z.object({week:LocalDate,title:z.string().nullable(),theme:z.string().nullable()}))}),
});
export type Brief = z.infer<typeof Brief>;

export const Timezone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en',{timeZone:value}); return true; } catch { return false; } }, '请选择有效时区');
export const OnboardingInput = z.strictObject({ai:z.enum(['claude','chatgpt']).optional(),entry:z.enum(['start','existing']).optional(),skipped:z.boolean().optional(),step:z.enum(['choose','guide','chat']).optional()});
export const AccountPreferencesInput = z.strictObject({timezone:Timezone,initialize:z.boolean().optional()});
export const OnboardingState = z.object({ai:z.enum(['claude','chatgpt']).nullable(),entry:z.enum(['start','existing']).nullable(),skippedAt:Instant.nullable(),completedAt:Instant.nullable(),firstViewUrl:z.string().nullable(),hasContent:z.boolean(),clients:z.array(ClientPublic),connectionStartedAt:Instant.nullable().default(null),step:z.enum(['choose','guide','chat']).default('choose')});
export type OnboardingState = z.infer<typeof OnboardingState>;
export const AccountPublic = z.object({accountId:Id,email:z.string(),mode:z.string(),timezone:Timezone,timezoneInitialized:z.boolean(),providers:z.array(z.string()),fresh:z.boolean(),privacy:z.object({version:z.string(),acceptedAt:Instant.nullable()})});
export const AccountDeleteInput = z.strictObject({confirm:z.literal('DELETE')});
export const ProductEventInput = z.strictObject({event:z.enum(['returned','connection_help','connection_timeout','copy_failed'])});

export const PRIVACY_VERSION = "2026-10-12-notes";
export const ConsentInput = z.strictObject({version:z.literal(PRIVACY_VERSION),accepted:z.literal(true)});
export const ConsentStatus = z.object({version:z.literal(PRIVACY_VERSION),acceptedAt:Instant.nullable()});

export const PrivacyInfo = z.object({version:z.literal(PRIVACY_VERSION),contact:z.string().nullable()});
