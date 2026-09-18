import type { D1Database } from '@cloudflare/workers-types';
import type { z } from 'zod';
import { artifactQuerySchema, artifactViewSchema } from '../domain/artifacts.ts';
import type { ArtifactView, EntityRef } from '../domain/artifacts.ts';
import { addDays, localDateAt, scaledSchema } from '../domain/primitives.ts';
import { exerciseDisplaySnapshotSchema } from '../domain/training.ts';
import { weightTrend } from '../domain/weight.ts';
import { effectiveTimezone } from '../domain/time.ts';
import type { AuthContext } from './auth.ts';
import { readDailyWeight, listWeights } from './weights.ts';
import { meals, mealDrafts } from './nutrition-store.ts';
import { nutritionDaySummary } from './nutrition-days.ts';
import { claims, schedules, sessions } from './training-store.ts';
import { readTrainingDay } from './training.ts';
import { readActivePlan } from './plans.ts';
import { readGoal } from './goals.ts';
import { pageResult } from './pagination.ts';
import { readConsistent } from './read-model.ts';
import { DomainError } from './errors.ts';

type Query = z.infer<typeof artifactQuerySchema>;
const ref = (type: EntityRef['type'], record: { id: string; revision: number }): EntityRef => ({ type, id: record.id, revision: record.revision });
function week(date: string) {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7, from = addDays(date, 1 - weekday);
  return { from, to: addDays(from, 6) };
}
function checkedRange(range: { from: string; to: string }, maxDays: number) {
  if (range.from > range.to || new Date(range.to).getTime() - new Date(range.from).getTime() >= maxDays * 86400000) throw new DomainError('INVALID_INPUT', 400, { reason: 'dateRange' });
  return range;
}
export async function trainingVolume(db: D1Database, owner: string, from: string, to: string) {
  const rows = await db.prepare("SELECT e.display_snapshot_json AS snapshot,SUM(CASE WHEN s.set_type='work' THEN 1 ELSE 0 END) AS work,SUM(CASE WHEN s.set_type='unknown' THEN 1 ELSE 0 END) AS unknown,COUNT(*) AS total FROM workout_sets s JOIN session_exercises e ON e.owner_id=s.owner_id AND e.id=s.session_exercise_id JOIN workout_sessions w ON w.owner_id=e.owner_id AND w.id=e.session_id WHERE w.owner_id=? AND w.local_date BETWEEN ? AND ? AND w.status IN ('draft','in_progress','paused','completed','recorded') AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL GROUP BY e.id").bind(owner, from, to).all<{ snapshot: string; work: number; unknown: number; total: number }>();
  const volume = new Map<string, { muscleId: string; directSets: number; secondarySets: number }>();
  let completedWorkingSets = 0, unknownTypeSets = 0, actualSets = 0, unmappedWorkingSets = 0;
  for (const row of rows.results) {
    const display = exerciseDisplaySnapshotSchema.parse(JSON.parse(row.snapshot));
    completedWorkingSets = scaledSchema.parse(completedWorkingSets + row.work); unknownTypeSets = scaledSchema.parse(unknownTypeSets + row.unknown); actualSets = scaledSchema.parse(actualSets + row.total);
    if (!display.muscles.primary.length) unmappedWorkingSets += row.work;
    for (const [role, ids] of [['directSets', display.muscles.primary], ['secondarySets', display.muscles.secondary]] as const) for (const muscleId of ids) {
      if (!row.work) continue;
      const item = volume.get(muscleId) ?? { muscleId, directSets: 0, secondarySets: 0 };
      item[role] = scaledSchema.parse(item[role] + row.work); volume.set(muscleId, item);
    }
  }
  return { completedWorkingSets, unknownTypeSets, muscleVolume: [...volume.values()].sort((a, b) => a.muscleId.localeCompare(b.muscleId)), actualSets, unmappedWorkingSets };
}
/** Build all requested views inside one checked read cutoff. No model output is an input. */
export async function readArtifacts(db: D1Database, auth: AuthContext, payload: unknown, clock: () => Date = () => new Date()) {
  const query: Query = artifactQuerySchema.parse(payload), now = clock();
  const result = await readConsistent(db, auth.id, async () => {
    const calendar = await db.prepare('SELECT u.timezone,p.pending_timezone,p.timezone_effective_date FROM users u LEFT JOIN user_profiles p ON p.owner_id=u.id WHERE u.id=?').bind(auth.id).first<{ timezone: string; pending_timezone: string | null; timezone_effective_date: string | null }>();
    if (!calendar) throw new DomainError('MEMBER_SUSPENDED', 403);
    const localDate = query.localDate ?? localDateAt(now, effectiveTimezone(calendar.timezone, calendar.pending_timezone, calendar.timezone_effective_date, now));
    const ranges = { training: checkedRange(query.range && query.kind !== 'WeightArtifact' ? query.range : week(localDate), 90), weight: checkedRange(query.range && query.kind !== 'SessionArtifact' ? query.range : { from: addDays(localDate, -27), to: localDate }, 90) };
    const views: Array<Omit<ArtifactView, 'dataRevision'>> = [];
    const collections: Record<string, { nextCursor: string | null; previewCount: number }> = {};
    const common = { schemaVersion: 1 as const, projectedAt: now.toISOString(), localDate, insightRefs: [], recommendationIds: [] };
    const goal = await readGoal(db, auth.id, localDate), claim = (await claims.list(db, auth.id, 'local_date=?', [localDate]))[0] ?? null;
    const commonRefs = [...(goal ? [ref('goal_version', goal)] : []), ...(claim ? [ref('day_claim', claim)] : [])];
    if (!query.kind || query.kind === 'SessionArtifact') {
      const active = (await sessions.list(db, auth.id, "status='in_progress'", [], 'id LIMIT 1'))[0] ?? null;
      const selected = query.sessionId ? await sessions.read(db, auth.id, query.sessionId) : (await sessions.list(db, auth.id, "local_date=? AND status<>'cancelled'", [localDate], "CASE WHEN status='in_progress' THEN 0 ELSE 1 END,created_at DESC,id LIMIT 1"))[0] ?? null;
      const planned = await schedules.list(db, auth.id, "local_date=? AND status='planned'", [localDate], 'id LIMIT 21'), plan = await readActivePlan(db, auth.id, localDate);
      const preview = pageResult(planned, 20, auth.id, 'scheduled_session', { from: localDate, to: localDate, status: 'planned' });
      const day = await readTrainingDay(db, auth.id, localDate);
      const dayExerciseCount = new Set(day.sets.map(item => item.sessionExerciseId)).size;
      const volume = await trainingVolume(db, auth.id, ranges.training.from, ranges.training.to);
      const rootRefs = [...commonRefs, ...(active ? [ref('workout_session', active)] : []), ...(selected && selected.id !== active?.id ? [ref('workout_session', selected)] : []), ...(plan ? [ref('plan_version', plan)] : []), ...preview.items.map(item => ref('scheduled_session', item))];
      views.push({ ...common, kind: 'SessionArtifact', entityRefs: rootRefs, quality: volume.actualSets ? volume.unknownTypeSets || volume.unmappedWorkingSets ? 'partial' : 'sufficient' : selected || plan || planned.length ? 'partial' : 'empty', pendingDraftIds: [], props: { daySessionIds: day.sessions.map(item => item.id), dayExerciseCount, daySetCount: day.sets.length, activeSessionId: active?.id ?? null, selectedSessionId: selected?.id ?? null, plannedSessionIds: preview.items.map(item => item.id), completedWorkingSets: volume.completedWorkingSets, unknownTypeSets: volume.unknownTypeSets, muscleVolume: volume.muscleVolume } });
      collections.scheduledSessions = { nextCursor: preview.nextCursor, previewCount: preview.items.length };
    }
    if (!query.kind || query.kind === 'WeightArtifact') {
      const latest = await readDailyWeight(db, auth.id, localDate), entries = await listWeights(db, auth.id, addDays(ranges.weight.from, -13), ranges.weight.to);
      const trend = weightTrend(entries, ranges.weight.from, ranges.weight.to);
      views.push({ ...common, kind: 'WeightArtifact', entityRefs: [...commonRefs, ...(latest ? [ref('weight_entry', latest)] : [])], quality: trend.trend.some(point => point.meanKgMicros !== null) ? 'sufficient' : latest ? 'partial' : 'empty', pendingDraftIds: [], props: { primaryEntryId: latest?.id ?? null, primaryKgMicros: latest?.kgMicros ?? null, trend: trend.trend, algorithmVersion: trend.algorithmVersion, goalVersionId: goal?.id ?? null } });
    }
    if (!query.kind || query.kind === 'DietArtifact') {
      const summary = await nutritionDaySummary(db, auth.id, localDate);
      const mealPreview = pageResult(await meals.list(db, auth.id, 'local_date=?', [localDate], 'id LIMIT 21'), 20, auth.id, 'meal', { from: localDate, to: localDate });
      const draftPreview = pageResult(await mealDrafts.list(db, auth.id, "local_date=? AND status<>'confirmed'", [localDate], 'id LIMIT 21'), 20, auth.id, 'import_draft', { from: localDate, to: localDate });
      views.push({ ...common, kind: 'DietArtifact', entityRefs: [...commonRefs, ...mealPreview.items.map(item => ref('meal', item)), ...draftPreview.items.map(item => ref('import_draft', item))], quality: summary.completeness === 'complete' && !summary.pendingDraftCount && !Object.values(summary.unknownCounts).some(Boolean) ? 'sufficient' : summary.mealCount || summary.pendingDraftCount ? 'partial' : 'empty', pendingDraftIds: draftPreview.items.map(item => item.id), props: { mealIds: mealPreview.items.map(item => item.id), knownSum: summary.knownSum, unknownCounts: summary.unknownCounts, completeness: summary.completeness, goalVersionId: goal?.id ?? null } });
      collections.meals = { nextCursor: mealPreview.nextCursor, previewCount: mealPreview.items.length };
      collections.mealDrafts = { nextCursor: draftPreview.nextCursor, previewCount: draftPreview.items.length };
    }
    return { views, collections, localDate, ranges };
  });
  return { views: result.data.views.map(view => artifactViewSchema.parse({ ...view, dataRevision: result.dataRevision })), dataRevision: result.dataRevision, query: { localDate: result.data.localDate, sessionId: query.sessionId ?? null, kind: query.kind ?? null, ranges: result.data.ranges, collections: result.data.collections } };
}
