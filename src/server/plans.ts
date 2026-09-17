import type { D1Database } from '@cloudflare/workers-types';
import { addDays, localDateAt } from '../domain/primitives.ts';
import { planActivationInputSchema, planInputSchema, planSelectionSchema, scheduleInputSchema, schedulePatchSchema } from '../domain/training.ts';
import type { PlanSelection, PlanVersion, ScheduledSession } from '../domain/training.ts';
import type { PlanSnapshot } from '../domain/snapshots.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan, Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { exerciseGuard, readExercise } from './exercises.ts';
import { expectRevision, mergePlans, newMetadata, reviseRecord } from './record-store.ts';
import { plans, schedules, setups } from './training-store.ts';
import { versionGuard } from './training.ts';

export async function readPlanSelection(db: D1Database, owner: string, localDate: string): Promise<PlanSelection | null> {
  const row = await db.prepare('SELECT id,owner_id AS ownerId,plan_version_id AS planVersionId,effective_local_date AS effectiveLocalDate,data_revision AS dataRevision,operation_id AS operationId FROM plan_selections WHERE owner_id=? AND effective_local_date<=? ORDER BY effective_local_date DESC,data_revision DESC LIMIT 1').bind(owner, localDate).first();
  return row ? planSelectionSchema.parse(row) : null;
}
export async function readActivePlan(db: D1Database, owner: string, localDate: string) {
  const selection = await readPlanSelection(db, owner, localDate);
  return selection?.planVersionId ? plans.read(db, owner, selection.planVersionId) : null;
}
function effectiveDate(context: CommandContext, input: { effectiveLocalDate?: string; confirmToday: boolean; confirmHistorical: boolean }) {
  const today = localDateAt(new Date(context.now), context.auth.timezone), date = input.effectiveLocalDate ?? addDays(today, 1);
  if (date === today && !input.confirmToday) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'planToday' });
  if (date < today && !input.confirmHistorical) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'planHistorical' });
  return date;
}
async function basePlan(context: CommandContext, date: string, expected: { id: string; revision: number } | null) {
  const current = await readActivePlan(context.db, context.auth.id, date);
  if ((current?.id ?? null) !== (expected?.id ?? null) || (current && current.revision !== expected?.revision)) throw new DomainError('REVISION_CONFLICT', 409, { reason: 'activePlanChanged' });
  return current;
}
async function snapshotGuards(context: CommandContext, snapshot: PlanSnapshot): Promise<Guard[]> {
  if (snapshot.templates.length > 30 || snapshot.templates.some(template => template.title.length < 1 || template.title.length > 120 || template.exercises.length > 100 || new Set(template.exercises.map(exercise => exercise.ordinal)).size !== template.exercises.length || template.exercises.some(exercise => (exercise.note?.length ?? 0) > 500))) throw new DomainError('INVALID_INPUT', 400, { reason: 'planBounds' });
  const guards: Guard[] = [];
  for (const id of new Set(snapshot.templates.flatMap(template => template.exercises.map(exercise => exercise.setupId)))) {
    const setup = await setups.read(context.db, context.auth.id, id), exercise = await readExercise(context.db, context.auth.id, setup.exerciseId);
    guards.push(versionGuard('exercise_setups', context.auth.id, setup), exerciseGuard(context.auth.id, exercise.id, exercise.revision));
  }
  return guards;
}
function select(context: CommandContext, plan: CommandPlan, id: string | null, localDate: string) {
  const selection: PlanSelection = { id: crypto.randomUUID(), ownerId: context.auth.id, planVersionId: id, effectiveLocalDate: localDate, dataRevision: context.dataRevision, operationId: context.operationId };
  plan.statements.push(context.db.prepare('INSERT INTO plan_selections(id,owner_id,plan_version_id,effective_local_date,data_revision,operation_id) VALUES (?,?,?,?,?,?)').bind(selection.id, selection.ownerId, id, localDate, selection.dataRevision, selection.operationId));
  // The sync endpoint includes these typed timeline rows at the same batch cutoff.
  plan.result = { ...plan.result, selection };
}
export function createPlan(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = planInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'plan.create', payload: input, entryPoint: 'manual', plan: async context => {
    const date = effectiveDate(context, input), previous = await basePlan(context, date, input.basePlan), guards = await snapshotGuards(context, input.snapshot);
    const record: PlanVersion = { ...newMetadata(context, input.id), title: input.title, effectiveLocalDate: date, status: input.activate ? 'published' : 'draft', snapshot: input.snapshot, supersedesId: previous?.id ?? null };
    const plan = plans.plan(context, null, record); plan.guards.push(...guards); plan.undoable = false;
    if (input.activate) select(context, plan, record.id, date);
    return plan;
  } }, clock);
}
export function changePlanSelection(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, action: 'activate' | 'archive', clock?: () => Date) {
  const input = planActivationInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: `plan.${action}`, payload: { id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await plans.read(db, auth.id, id); expectRevision(before, revision);
    const date = effectiveDate(context, input), current = await basePlan(context, date, input.basePlan);
    const plan = plans.plan(context, before, reviseRecord(before, context, { status: action === 'activate' ? 'published' : 'archived' })); plan.undoable = false;
    if (action === 'activate') { plan.guards.push(...await snapshotGuards(context, before.snapshot)); select(context, plan, id, date); }
    else if (current?.id === id) select(context, plan, null, date);
    return plan;
  } }, clock);
}
export function createSchedule(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = scheduleInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'schedule.create', payload: input, entryPoint: 'manual', plan: async context => {
    const source = input.planVersionId ? await plans.read(db, auth.id, input.planVersionId) : null;
    if (source && !source.snapshot.templates.some(template => template.templateId === input.templateId)) throw new DomainError('INVALID_INPUT', 400, { reason: 'templateMissing' });
    if (input.overrideMode === 'template') {
      const selected = await readActivePlan(db, auth.id, input.localDate);
      const weekday = ((new Date(`${input.localDate}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
      if (selected?.id !== source?.id || !selected?.snapshot.weeklySchedule.find(day => day.weekday === weekday)?.templateIds.includes(input.templateId!)) throw new DomainError('CONTEXT_STALE', 422, { reason: 'weeklyTemplateChanged' });
    }
    const record: ScheduledSession = { ...newMetadata(context, input.id), ...input, status: 'planned', movedFromId: null, overrideSnapshot: source?.snapshot ?? null };
    const plan = schedules.plan(context, null, record); plan.undoable = false;
    if (source) plan.guards.push(versionGuard('plan_versions', auth.id, source), ...await snapshotGuards(context, source.snapshot));
    if (input.overrideMode === 'template') plan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM scheduled_sessions WHERE owner_id=? AND local_date=? AND plan_version_id=? AND template_id=? AND override_mode='template' AND deleted_at IS NULL)", values: [auth.id, input.localDate, input.planVersionId, input.templateId], error: new DomainError('DUPLICATE_CANDIDATE', 409, { reason: 'weeklyTemplateAlreadyOverridden' }) });
    return plan;
  } }, clock);
}
export function editSchedule(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, clock?: () => Date) {
  const input = schedulePatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: `schedule.${input.action}`, payload: { sourceId: id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await schedules.read(db, auth.id, id); expectRevision(before, revision);
    if (before.status !== 'planned') throw new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'scheduleUnavailable' });
    const changed = schedules.plan(context, before, reviseRecord(before, context, { status: input.action === 'move' ? 'moved' : input.action === 'skip' ? 'skipped' : 'cancelled' }));
    const children = [changed];
    if (input.action === 'move') children.push(schedules.plan(context, null, { ...before, ...newMetadata(context, input.id), localDate: input.localDate, entryTimezone: input.entryTimezone, status: 'planned', movedFromId: before.id, overrideMode: 'additional' }));
    const plan = mergePlans(children, { sourceId: id, movedToId: input.action === 'move' ? input.id : null }, false);
    plan.guards.push({ predicate: "NOT EXISTS(SELECT 1 FROM workout_sessions WHERE owner_id=? AND scheduled_session_id=? AND deleted_at IS NULL AND status<>'cancelled')", values: [auth.id, id], error: new DomainError('DAY_STATE_CONFLICT', 409, { reason: 'scheduleAlreadyStarted' }) });
    return plan;
  } }, clock);
}
export async function readScheduleDay(db: D1Database, owner: string, date: string) {
  const plan = await readActivePlan(db, owner, date), explicit = await schedules.list(db, owner, 'local_date=?', [date]);
  const weekday = ((new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  const weekly = plan?.snapshot.weeklySchedule.find(day => day.weekday === weekday);
  const dayOverride = explicit.some(item => item.overrideMode === 'day');
  const replaced = new Set(explicit.filter(item => item.overrideMode === 'template' && item.planVersionId === plan?.id).map(item => item.templateId));
  const templateIds = dayOverride ? [] : (weekly?.templateIds ?? []).filter(id => !replaced.has(id));
  return { localDate: date, planVersionId: plan?.id ?? null, scheduledSessions: explicit, weeklyTemplates: templateIds.map(id => ({ planVersionId: plan!.id, planRevision: plan!.revision, template: plan!.snapshot.templates.find(template => template.templateId === id)! })), plannedRest: dayOverride || explicit.some(item => item.status === 'planned') ? false : weekly?.plannedRest ?? false };
}
