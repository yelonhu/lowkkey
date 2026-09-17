import { describe, expect, it } from 'vitest';
import { weightInputSchema, setInputSchema, profilePatchSchema, parseWriteHeaders, paginationSchema, errorEnvelopeSchema } from '../src/domain/contracts.ts';
import { localeSchema, loadSemanticsSchema, localDateSchema, scaledSchema, timezoneSchema, validateActualDate } from '../src/domain/primitives.ts';
import { normalizeManualDecimal, normalizeMass, scaledDecimal } from '../src/domain/numbers.ts';
import { nutrientSnapshotSchema, planSnapshotSchema, recoveryNoteSchema } from '../src/domain/snapshots.ts';

const id = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641';
const weight = { id, localDate: '2026-09-15', entryTimezone: 'America/Chicago', occurredAt: null, timePrecision: 'date', value: '75.2', unit: 'kg', condition: 'fasted' };
const set = { id, sessionExerciseId: 'fa682cd1-1d70-4f27-87f0-4b143f53b624', load: { value: '110', unit: 'lb', semantics: 'external_total' }, reps: 9, setType: 'unknown', rpe: null, ordinal: 4 };

describe('M0 shared contracts (§14–15; business ATs remain pending)', () => {
  it('accepts SPEC examples without inventing unknown values', () => { expect(weightInputSchema.parse(weight)).toEqual(weight); expect(setInputSchema.parse(set)).toEqual(set); });
  it.each(['ownerId', 'role', 'isPrimary', 'confirmed', 'model'])('rejects mass assignment: %s', field => expect(weightInputSchema.safeParse({ ...weight, [field]: 'forged' }).success).toBe(false));
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '26-01-01'])('rejects invalid date %s', value => expect(localDateSchema.safeParse(value).success).toBe(false));
  it('handles leap dates', () => expect(localDateSchema.parse('2024-02-29')).toBe('2024-02-29'));
  it('rejects unknown locale, semantics, timezone and unsafe numbers', () => {
    expect(localeSchema.safeParse('zh-CN').success).toBe(false); expect(loadSemanticsSchema.safeParse('unknown').success).toBe(false);
    expect(loadSemanticsSchema.parse('unspecified')).toBe('unspecified'); expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
    for (const number of [NaN, Infinity, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(scaledSchema.safeParse(number).success).toBe(false);
  });
  it('keeps date-only separate from timestamps', () => {
    expect(weightInputSchema.safeParse({ ...weight, occurredAt: '2026-09-15T00:00:00.000Z' }).success).toBe(false);
    expect(weightInputSchema.safeParse({ ...weight, timePrecision: 'instant' }).success).toBe(false);
    expect(weightInputSchema.safeParse({ ...weight, timePrecision: 'instant', occurredAt: '2026-09-15T12:00:00.000Z' }).success).toBe(true);
  });
  it('uses the effective timezone and injected clock for future facts', () => {
    const now = new Date('2026-09-16T02:00:00.000Z');
    expect(() => validateActualDate({ localDate: '2026-09-16', occurredAt: null }, 'America/Chicago', now)).toThrow('FUTURE_ACTUAL_DATE');
    expect(() => validateActualDate({ localDate: '2026-09-15', occurredAt: '2026-09-16T02:05:00.000Z' }, 'America/Chicago', now)).not.toThrow();
    expect(() => validateActualDate({ localDate: '2026-09-15', occurredAt: '2026-09-16T02:05:00.001Z' }, 'America/Chicago', now)).toThrow('CAPTURE_CLOCK_SKEW');
  });
  it('distinguishes omitted PATCH from explicit null', () => { expect(profilePatchSchema.parse({})).toEqual({}); expect(profilePatchSchema.parse({ constraintsText: null })).toEqual({ constraintsText: null }); expect(profilePatchSchema.safeParse({ displayName: null }).success).toBe(false); });
  it('requires UUID idempotency keys and quoted positive revisions', () => {
    expect(parseWriteHeaders(new Headers({ 'Idempotency-Key': id, 'If-Match': '"3"' }), true)).toEqual({ operationId: id, expectedRevision: 3 });
    for (const revision of ['', '3', '"0"', 'W/"3"', '"9007199254740992"']) expect(() => parseWriteHeaders(new Headers({ 'Idempotency-Key': id, 'If-Match': revision }), true)).toThrow();
    expect(() => parseWriteHeaders(new Headers(), false)).toThrow();
  });
  it('validates list limits and structured errors', () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 20 }); expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ error: { code: 'REVISION_CONFLICT', messageKey: 'errors.recordChanged', params: { expectedRevision: 3, currentRevision: 4 }, retryable: false }, meta: { requestId: 'request-example' } }).success).toBe(true);
  });
});
describe('exact units and input boundaries', () => {
  it('normalizes 110 lb exactly once, preserving the original decimal', () => expect(normalizeMass('110', 'lb')).toEqual({ value: '110', unit: 'lb', kgMicros: 49_895_161 }));
  it('does not add a bar or double a per-side load', () => {
    expect(setInputSchema.parse(set).load?.value).toBe('110');
    expect(setInputSchema.parse({ ...set, load: { value: '35', unit: 'lb', semantics: 'per_side' } }).load?.value).toBe('35');
  });
  it('retains null for bodyweight; load validation remains setup dependent', () => expect(setInputSchema.parse({ ...set, load: null }).load).toBeNull());
  it.each(['0.999999999', '500.000000001'])('checks raw weight before rounding: %s', value => expect(weightInputSchema.safeParse({ ...weight, value }).success).toBe(false));
  it('rejects excess normalized loads', () => expect(setInputSchema.safeParse({ ...set, load: { value: '2205', unit: 'lb', semantics: 'external_total' } }).success).toBe(false));
  it('rounds measurement half-up and budget upwards', () => { expect(scaledDecimal('1.2345', 1000n)).toBe(1235); expect(scaledDecimal('0.0000001', 1_000_000n, 'ceil')).toBe(1); });
  it('normalizes fullwidth digits, rejects commas and empty input', () => { expect(normalizeManualDecimal('３４．３')).toBe('34.3'); for (const text of ['', '34,3', '1,000', '2e3', '-1']) expect(() => normalizeManualDecimal(text)).toThrow(); });
});
describe('versioned snapshots', () => {
  const nutrients = { schemaVersion: 1, energyMkcal: 150000, proteinMg: null, carbsMg: 3750, fatMg: 7500, estimated: true, provenance: 'ai_estimate', referenceVersion: null, calculationVersion: null };
  it('does not turn unknown nutrition into zero or remove estimate provenance', () => { expect(nutrientSnapshotSchema.parse(nutrients).proteinMg).toBeNull(); expect(nutrientSnapshotSchema.safeParse({ ...nutrients, estimated: false }).success).toBe(false); });
  it('matches the SPEC portion calculation with integer scaling', () => { expect(scaledDecimal('15', 1000n)).toBe(15000); expect(scaledDecimal('3.75', 1000n)).toBe(3750); });
  const template = { templateId: id, title: 'Synthetic plan', exercises: [{ setupId: id, ordinal: 1, plannedSets: 3, repMin: 8, repMax: 10, targetRpe: null, note: null }] };
  const plan = { schemaVersion: 1, templates: [template], weeklySchedule: [{ weekday: 1, templateIds: [id], plannedRest: false }] };
  it('keeps unspecified weekdays absent', () => expect(planSnapshotSchema.parse(plan).weeklySchedule).toHaveLength(1));
  it('checks template references, weekdays, rest and rep intervals', () => {
    for (const candidate of [
      { ...plan, templates: [template, template] }, { ...plan, weeklySchedule: [plan.weeklySchedule[0], plan.weeklySchedule[0]] },
      { ...plan, weeklySchedule: [{ weekday: 1, templateIds: [id], plannedRest: true }] }, { ...plan, templates: [] },
      { ...plan, templates: [{ ...template, exercises: [{ ...template.exercises[0], repMin: 11 }] }] },
    ]) expect(planSnapshotSchema.safeParse(candidate).success).toBe(false);
  });
  it('rejects unversioned and arbitrary recovery fields', () => expect(recoveryNoteSchema.safeParse({ schemaVersion: 1, sleepHours: null, readiness: 'unknown', discomfortText: null, diagnosis: 'forged' }).success).toBe(false));
});
