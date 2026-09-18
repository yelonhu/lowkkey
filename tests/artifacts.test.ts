import { describe, expect, it } from 'vitest';
import { artifactQuerySchema, artifactViewSchema, interactionContextSchema } from '../src/domain/artifacts.ts';
import { changeBatchSchema, domainEventSchema } from '../src/domain/events.ts';

const id = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', operationId = '29a3d61a-d672-4359-834c-792af3bbce87';
const now = '2026-09-16T20:05:00.000Z';
const meta = { schemaVersion: 1, dataRevision: 0, projectedAt: now, localDate: '2026-09-16', entityRefs: [], quality: 'empty', pendingDraftIds: [], insightRefs: [], recommendationIds: [] };
const event = { schemaVersion: 1, eventId: `${operationId}:0`, operationId, dataRevision: 43, source: 'user', originThreadId: null, occurredAt: now, entity: { type: 'workout_set', id, revision: 4 }, beforeRevision: 3, afterRevision: 4, action: 'updated', changes: [{ field: 'reps', before: 8, after: 5 }] };
describe('fixed shared state contracts', () => {
  it('accepts three empty views while keeping unknown values null', () => {
    const views = [
      { ...meta, kind: 'SessionArtifact', props: { daySessionIds: [], dayExerciseCount: 0, daySetCount: 0, activeSessionId: null, selectedSessionId: null, plannedSessionIds: [], completedWorkingSets: 0, unknownTypeSets: 0, muscleVolume: [] } },
      { ...meta, kind: 'WeightArtifact', props: { primaryEntryId: null, primaryKgMicros: null, trend: [], algorithmVersion: 'weight-trailing-7d-v1', goalVersionId: null } },
      { ...meta, kind: 'DietArtifact', props: { mealIds: [], knownSum: { schemaVersion: 1, energyMkcal: null, proteinMg: null, carbsMg: null, fatMg: null, estimated: false, provenance: 'calculated', referenceVersion: null, calculationVersion: 'nutrition-v1' }, unknownCounts: { energy: 0, protein: 0, carbs: 0, fat: 0 }, completeness: 'unreviewed', goalVersionId: null } },
    ];
    for (const view of views) {
      expect(artifactViewSchema.parse(view)).toEqual(view);
      expect(artifactViewSchema.safeParse({ ...view, style: 'display:none' }).success).toBe(false);
      expect(artifactViewSchema.safeParse({ ...view, kind: 'InsightArtifact' }).success).toBe(false);
    }
  });
  it('does not let a thread or arbitrary kind choose a health snapshot', () => {
    expect(artifactQuerySchema.safeParse({ threadId: id }).success).toBe(false);
    expect(artifactQuerySchema.safeParse({ kind: 'html' }).success).toBe(false);
    expect(artifactQuerySchema.safeParse({ from: '2026-09-16' }).success).toBe(false);
    expect(artifactQuerySchema.safeParse({ kind: 'DietArtifact', sessionId: id }).success).toBe(false);
  });
  it('accepts bounded context clues without owner or permissions', () => {
    const context = { schemaVersion: 1, workspaceView: 'overview', artifactKind: null, localDate: null, entityRef: null, threadId: null, observedDataRevision: 4, capturedAt: now, hasPendingLocalChanges: true };
    expect(interactionContextSchema.parse(context)).toEqual(context);
    expect(interactionContextSchema.safeParse({ ...context, ownerId: id }).success).toBe(false);
    expect(interactionContextSchema.safeParse({ ...context, observedDataRevision: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });
  it('restricts events to entity-specific fields and exact revision steps', () => {
    expect(domainEventSchema.parse(event)).toEqual(event);
    for (const field of ['owner_id', 'protein_mg', '/props/reps', 'html']) expect(domainEventSchema.safeParse({ ...event, changes: [{ field, before: 8, after: 5 }] }).success).toBe(false);
    expect(domainEventSchema.safeParse({ ...event, afterRevision: 5 }).success).toBe(false);
    expect(domainEventSchema.safeParse({ ...event, changes: [{ field: 'reps', before: 8, after: { reps: 5 } }] }).success).toBe(false);
    expect(domainEventSchema.safeParse({ ...event, changes: [...event.changes, ...event.changes] }).success).toBe(false);
  });
  it('binds every ordered event to its operation, source and data revision', () => {
    const batch = { dataRevision: 43, operationId, source: 'user', originThreadId: null, createdAt: now, events: [event] };
    expect(changeBatchSchema.parse(batch)).toEqual(batch);
    expect(changeBatchSchema.safeParse({ ...batch, dataRevision: 42 }).success).toBe(false);
    expect(changeBatchSchema.safeParse({ ...batch, events: [{ ...event, eventId: `${operationId}:1` }] }).success).toBe(false);
    expect(changeBatchSchema.safeParse({ ...batch, source: 'assistant' }).success).toBe(false);
  });
});
