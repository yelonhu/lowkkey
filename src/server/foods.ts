import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { foodAliasInputSchema, foodDefinitionSchema, foodInputSchema, nutritionReferenceSchema, personalFoodSchema, portionInputSchema } from '../domain/nutrition.ts';
import type { NutritionReference } from '../domain/nutrition.ts';
import type { Locale } from '../domain/primitives.ts';
import { scaledDecimal } from '../domain/numbers.ts';
import { normalizeAlias } from '../domain/training.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { expectRevision, newMetadata, reviseRecord } from './record-store.ts';
import { favorites, foodAliases, personalFoods, portions } from './nutrition-store.ts';
import { pageAfter, pageResult } from './pagination.ts';

export async function readFood(db: D1Database, owner: string, id: string, includeArchived = false) {
  const row = await db.prepare(`SELECT id,owner_id AS ownerId,revision,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt,scope,catalog_version AS catalogVersion,kind,reference_state AS referenceState,preparation,cut_or_part AS cutOrPart,brand,status,personal_name AS personalName,personal_locale AS personalLocale FROM food_definitions WHERE id=? AND (scope='system' OR owner_id=?) AND deleted_at IS NULL${includeArchived ? '' : " AND status='active'"}`).bind(id, owner).first();
  if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
  return foodDefinitionSchema.parse(row);
}
export function foodGuard(owner: string, id: string, revision: number): Guard {
  return { predicate: "EXISTS(SELECT 1 FROM food_definitions WHERE id=? AND revision=? AND (scope='system' OR owner_id=?) AND status='active' AND deleted_at IS NULL)", values: [id, revision, owner], error: new DomainError('CONTEXT_STALE', 422) };
}
export const referenceSelect = 'SELECT id,food_id AS foodId,basis,serving_quantity AS servingQuantity,serving_unit AS servingUnit,nutrients_json,source_name AS sourceName,source_entry_id AS sourceEntryId,source_url AS sourceUrl,source_version AS sourceVersion,provenance,estimated,retrieved_at AS retrievedAt FROM nutrition_references';
export function decodeReference(row: Record<string, unknown>) { const { nutrients_json, ...fields } = row; return nutritionReferenceSchema.parse({ ...fields, nutrients: JSON.parse(String(nutrients_json)), estimated: fields.estimated === 1 }); }
export async function readReference(db: D1Database, owner: string, id: string) {
  const row = await db.prepare(`${referenceSelect} WHERE id=?`).bind(id).first<Record<string, unknown>>();
  if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
  const reference = decodeReference(row), food = await readFood(db, owner, reference.foodId);
  return { reference, food };
}
export async function foodReferences(db: D1Database, owner: string, foodId: string) {
  await readFood(db, owner, foodId, true);
  return (await db.prepare(`${referenceSelect} WHERE food_id=? ORDER BY retrieved_at,id`).bind(foodId).all<Record<string, unknown>>()).results.map(decodeReference);
}
function insertReference(context: CommandContext, reference: NutritionReference) {
  return context.db.prepare('INSERT INTO nutrition_references(id,food_id,basis,serving_quantity,serving_unit,nutrients_json,source_name,source_entry_id,source_url,source_version,provenance,estimated,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(reference.id, reference.foodId, reference.basis, reference.servingQuantity, reference.servingUnit, JSON.stringify(reference.nutrients), reference.sourceName, reference.sourceEntryId, reference.sourceUrl, reference.sourceVersion, reference.provenance, Number(reference.estimated), reference.retrievedAt);
}
export function createCustomFood(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = foodInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'food.create', payload: input, entryPoint: 'manual', plan: async context => {
    const record = personalFoodSchema.parse({ ...newMetadata(context, input.id), scope: 'personal', catalogVersion: 'personal-v1', kind: input.kind, referenceState: input.referenceState, preparation: input.preparation, cutOrPart: input.cutOrPart, brand: input.brand, status: 'active', personalName: input.name, personalLocale: input.locale });
    const plan = personalFoods.plan(context, null, record);
    if (input.reference) {
      plan.guards.push({ predicate: 'NOT EXISTS(SELECT 1 FROM nutrition_references WHERE id=?)', values: [input.reference.id], error: new DomainError('DUPLICATE_CANDIDATE', 409) });
      const reference = nutritionReferenceSchema.parse({ ...input.reference, foodId: record.id, retrievedAt: context.now });
      plan.statements.push(insertReference(context, reference));
      plan.result = { id: record.id, reference };
    }
    plan.undoable = false; return plan;
  } }, clock);
}
const portionFields = portionInputSchema.shape;
const portionPatchSchema = z.strictObject({ foodId: portionFields.foodId.removeDefault().optional(), label: portionFields.label.optional(), quantityDecimal: portionFields.quantityDecimal.optional(), unit: portionFields.unit.optional(), gramsDecimal: portionFields.gramsDecimal.removeDefault().optional(), mlDecimal: portionFields.mlDecimal.removeDefault().optional(), densityDecimal: portionFields.densityDecimal.removeDefault().optional(), estimated: portionFields.estimated.removeDefault().optional() });
export function savePortion(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, edit?: { id: string; revision: number; deleting?: boolean }, clock?: () => Date) {
  const input = edit ? (edit.deleting ? z.strictObject({}).parse(payload) : portionPatchSchema.parse(payload)) : portionInputSchema.parse(payload);
  if (edit && !edit.deleting && !Object.keys(input).length) throw new DomainError('INVALID_INPUT', 400);
  return executeCommand(db, auth, { operationId, kind: `portion.${edit ? edit.deleting ? 'delete' : 'patch' : 'create'}`, payload: { ...input, ...(edit ? { id: edit.id } : {}) }, expectedRevision: edit?.revision, entryPoint: 'manual', plan: async context => {
    const before = edit ? await portions.read(db, auth.id, edit.id) : null;
    if (before && edit) expectRevision(before, edit.revision);
    const raw = portionInputSchema.parse({ ...(before ? Object.fromEntries(Object.keys(portionInputSchema.shape).map(key => [key, before[key as keyof typeof before]])) : {}), ...input, ...(edit ? { id: edit.id } : {}) });
    const food = !edit?.deleting && raw.foodId ? await readFood(db, auth.id, raw.foodId) : null;
    const fields = { ...raw, gramsMilli: raw.gramsDecimal === null ? null : scaledDecimal(raw.gramsDecimal, 1000n), mlMilli: raw.mlDecimal === null ? null : scaledDecimal(raw.mlDecimal, 1000n), provenance: 'user_entered' as const };
    const record = before ? reviseRecord(before, context, edit?.deleting ? { deletedAt: context.now } : fields) : { ...newMetadata(context, raw.id), ...fields };
    const plan = portions.plan(context, before, record);
    if (food) plan.guards.push(foodGuard(auth.id, food.id, food.revision));
    plan.undoable = false; return plan;
  } }, clock);
}
const aliasPatchSchema = z.strictObject({ text: foodAliasInputSchema.shape.text.optional(), target: foodAliasInputSchema.shape.target.optional(), localeHint: foodAliasInputSchema.shape.localeHint.removeDefault().optional() }).refine(value => Object.keys(value).length > 0, 'Empty alias edit');
export function saveFoodAlias(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, edit?: { id: string; revision: number; deleting?: boolean }, clock?: () => Date) {
  const input = edit ? edit.deleting ? z.strictObject({}).parse(payload) : aliasPatchSchema.parse(payload) : foodAliasInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: `food_alias.${edit ? edit.deleting ? 'delete' : 'patch' : 'create'}`, payload: { ...input, ...(edit ? { id: edit.id } : {}) }, expectedRevision: edit?.revision, entryPoint: 'manual', plan: async context => {
    const before = edit ? await foodAliases.read(db, auth.id, edit.id) : null;
    if (before && edit) expectRevision(before, edit.revision);
    const parsed = foodAliasInputSchema.parse({ ...(before ? { id: before.id, type: 'food', text: before.aliasOriginal, localeHint: before.localeHint, target: before.foodId ? { type: 'food', id: before.foodId } : { type: 'favorite', id: before.favoriteId } } : {}), ...input });
    const target = edit?.deleting ? null : parsed.target.type === 'food' ? await readFood(db, auth.id, parsed.target.id) : await favorites.read(db, auth.id, parsed.target.id);
    const fields = { aliasOriginal: parsed.text, aliasNormalized: normalizeAlias(parsed.text), localeHint: parsed.localeHint, foodId: parsed.target.type === 'food' ? parsed.target.id : null, favoriteId: parsed.target.type === 'favorite' ? parsed.target.id : null, confirmedAt: context.now };
    const plan = foodAliases.plan(context, before, before ? reviseRecord(before, context, edit?.deleting ? { deletedAt: context.now } : fields) : { ...newMetadata(context, parsed.id), ...fields });
    if (target) plan.guards.push(parsed.target.type === 'food' ? foodGuard(auth.id, target.id, target.revision) : { predicate: 'EXISTS(SELECT 1 FROM favorites WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)', values: [auth.id, target.id, target.revision], error: new DomainError('CONTEXT_STALE', 422) });
    plan.undoable = false; return plan;
  } }, clock);
}
export async function searchFoods(db: D1Database, owner: string, query: { q: string; locale: Locale; limit: number; cursor?: string }) {
  const binding = { q: normalizeAlias(query.q), locale: query.locale }, after = pageAfter(owner, 'foods', binding, query.cursor), like = `%${binding.q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const rows = await db.prepare(`SELECT f.id,f.scope,f.kind,f.reference_state AS referenceState,f.preparation,f.cut_or_part AS cutOrPart,f.brand,f.personal_locale AS originalLocale,COALESCE(f.personal_name,l.display_name,en.display_name) AS name FROM food_definitions f LEFT JOIN food_labels l ON l.food_id=f.id AND l.locale=? LEFT JOIN food_labels en ON en.food_id=f.id AND en.locale='en' WHERE (f.scope='system' OR f.owner_id=?) AND f.status='active' AND f.deleted_at IS NULL AND (? IS NULL OR f.id>?) AND (lower(f.personal_name) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM food_labels x WHERE x.food_id=f.id AND (x.search_terms LIKE ? ESCAPE '\\' OR lower(x.display_name) LIKE ? ESCAPE '\\')) OR EXISTS(SELECT 1 FROM food_aliases a WHERE a.owner_id=? AND a.food_id=f.id AND a.deleted_at IS NULL AND a.alias_normalized LIKE ? ESCAPE '\\')) ORDER BY f.id LIMIT ?`).bind(query.locale, owner, after, after, like, like, like, owner, like, query.limit + 1).all<{ id: string; scope: string; kind: string; referenceState: string; preparation: string | null; cutOrPart: string | null; brand: string | null; originalLocale: string | null; name: string }>();
  const records = await Promise.all(rows.results.map(async food => ({ ...food, references: await foodReferences(db, owner, food.id) })));
  return pageResult(records, query.limit, owner, 'foods', binding);
}
