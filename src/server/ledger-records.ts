import type { D1Database } from '@cloudflare/workers-types';
import { ledgerItemSchema, ledgerSupplementSchema } from '../domain/ledger.ts';
import type { LedgerItem, LedgerSupplement } from '../domain/ledger.ts';
import type { OwnedRecord, RecordStore } from './record-store.ts';
import { claims, exerciseAliases, personalExercises, plans, schedules, sessionExercises, sessions, sets, setups } from './training-store.ts';
import { favorites, foodAliases, mealDrafts, mealItems, meals, personalFoods, portions, recipes } from './nutrition-store.ts';
import { decodeWeight, weightSelect } from './weights.ts';
import { decodeGoal, goalSelect } from './goals.ts';
import { decodeProfile, profileSelect } from './profiles.ts';
import { decodeReference, referenceSelect, readFood } from './foods.ts';
import { readExercise } from './exercises.ts';
import { requestHash } from './commands.ts';

export type LedgerRow = { position: string; item: LedgerItem };
type Source = { kind: LedgerItem['kind']; read: (db: D1Database, owner: string, after: string, limit: number) => Promise<LedgerRow[]> };
function source(kind: LedgerItem['kind'], select: string, decode: (row: Record<string, unknown>) => unknown, ownerColumn = 'owner_id', idColumn = 'id'): Source {
  return { kind, read: async (db, owner, after, limit) => {
    const rows = await db.prepare(`${select} WHERE ${ownerColumn}=? AND ${idColumn}>? ORDER BY ${idColumn} LIMIT ?`).bind(owner, after, limit).all<Record<string, unknown>>();
    return rows.results.map(row => ({ position: String(row.id), item: ledgerItemSchema.parse({ kind, value: decode(row) }) }));
  } };
}
function stored<T extends OwnedRecord>(store: RecordStore<T>): Source { return source(store.type as LedgerItem['kind'], store.select, row => store.decode(row)); }
export const selectionSelect = 'SELECT id,owner_id AS ownerId,plan_version_id AS planVersionId,effective_local_date AS effectiveLocalDate,data_revision AS dataRevision,operation_id AS operationId FROM plan_selections';
export const recipeHistorySelect = 'SELECT owner_id AS ownerId,recipe_id AS recipeId,version,data_revision AS dataRevision,snapshot_json FROM recipe_versions';
export function decodeRecipeVersion(row: Record<string, unknown>) { const { snapshot_json, ...value } = row; return { ...value, snapshot: JSON.parse(String(snapshot_json)) }; }

function catalog(kind: 'catalog_exercise' | 'catalog_food'): Source {
  const isExercise = kind === 'catalog_exercise', table = isExercise ? 'exercise_definitions' : 'food_definitions', labels = isExercise ? 'exercise_labels' : 'food_labels', foreign = isExercise ? 'exercise_id' : 'food_id';
  return { kind, read: async (db, owner, after, limit) => {
    const ids = (await db.prepare(`SELECT id FROM ${table} WHERE scope='system' AND deleted_at IS NULL AND id>? ORDER BY id LIMIT ?`).bind(after, limit).all<{ id: string }>()).results;
    return Promise.all(ids.map(async ({ id }) => ({ position: id, item: ledgerItemSchema.parse({ kind, value: {
      definition: await (isExercise ? readExercise : readFood)(db, owner, id, true),
      labels: (await db.prepare(`SELECT locale,display_name AS displayName,search_terms AS searchTerms FROM ${labels} WHERE ${foreign}=? ORDER BY locale`).bind(id).all()).results,
    } }) })));
  } };
}

// This registry also includes children below tombstoned parents. Rehydrating an
// undo must not require resurrecting missing child content; selectors join the
// complete ancestor chain before showing records or calculating statistics.
export const ledgerSources: Source[] = [
  source('user_profile', profileSelect, decodeProfile, 'p.owner_id', 'p.id'), source('goal_version', goalSelect, decodeGoal), source('weight_entry', weightSelect, decodeWeight),
  stored(personalExercises), stored(exerciseAliases), stored(setups), stored(plans), stored(schedules), stored(sessions), stored(sessionExercises), stored(sets), stored(claims),
  stored(personalFoods), stored(foodAliases), stored(portions), stored(recipes), stored(favorites), stored(meals), stored(mealItems), stored(mealDrafts),
  source('plan_selection', selectionSelect, row => row),
  { kind: 'recipe_version', read: async (db, owner, after, limit) => {
    const key = "recipe_id || ':' || printf('%016d',version)";
    const rows = (await db.prepare(`${recipeHistorySelect} WHERE owner_id=? AND ${key}>? ORDER BY recipe_id,version LIMIT ?`).bind(owner, after, limit).all<Record<string, unknown>>()).results;
    return rows.map(row => ({ position: `${row.recipeId}:${String(row.version).padStart(16, '0')}`, item: ledgerItemSchema.parse({ kind: 'recipe_version', value: decodeRecipeVersion(row) }) }));
  } },
  { kind: 'nutrition_reference', read: async (db, owner, after, limit) => {
    const rows = (await db.prepare(`${referenceSelect} WHERE id>? AND food_id IN (SELECT id FROM food_definitions WHERE owner_id=? OR scope='system') ORDER BY id LIMIT ?`).bind(after, owner, limit).all<Record<string, unknown>>()).results;
    return Promise.all(rows.map(async row => {
      const food = await db.prepare('SELECT owner_id FROM food_definitions WHERE id=? AND (owner_id=? OR scope=\'system\')').bind(row.foodId, owner).first<{ owner_id: string | null }>();
      if (!food) throw new Error('Unresolved reference owner');
      return { position: String(row.id), item: ledgerItemSchema.parse({ kind: 'nutrition_reference', value: { ...decodeReference(row), ownerId: food.owner_id } }) };
    }));
  } },
  catalog('catalog_exercise'), catalog('catalog_food'),
];
ledgerSources.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/** Catalog releases do not belong to one user's health revision. The fingerprint
 * covers every public definition, label and immutable nutrient reference. */
export async function catalogRevision(db: D1Database): Promise<string> {
  const queries = [
    "SELECT * FROM exercise_definitions WHERE scope='system' ORDER BY id", "SELECT l.* FROM exercise_labels l JOIN exercise_definitions d ON d.id=l.exercise_id WHERE d.scope='system' ORDER BY l.exercise_id,l.locale",
    "SELECT * FROM food_definitions WHERE scope='system' ORDER BY id", "SELECT l.* FROM food_labels l JOIN food_definitions d ON d.id=l.food_id WHERE d.scope='system' ORDER BY l.food_id,l.locale",
    "SELECT r.* FROM nutrition_references r JOIN food_definitions d ON d.id=r.food_id WHERE d.scope='system' ORDER BY r.id",
  ];
  return requestHash((await db.batch(queries.map(sql => db.prepare(sql)))).map(result => result.results));
}

export async function batchSupplements(db: D1Database, owner: string, revision: number, operationId: string): Promise<LedgerSupplement[]> {
  const [selections, recipes, operation] = await db.batch<Record<string, unknown>>([
    db.prepare(`${selectionSelect} WHERE owner_id=? AND data_revision=?`).bind(owner, revision),
    db.prepare(`${recipeHistorySelect} WHERE owner_id=? AND data_revision=? ORDER BY recipe_id,version`).bind(owner, revision),
    db.prepare("SELECT response_json FROM command_operations WHERE owner_id=? AND operation_id=? AND kind='food.create'").bind(owner, operationId),
  ]);
  const supplements: LedgerSupplement[] = [];
  for (const row of selections.results) supplements.push(ledgerSupplementSchema.parse({ kind: 'plan_selection', value: row }));
  for (const row of recipes.results) supplements.push(ledgerSupplementSchema.parse({ kind: 'recipe_version', value: decodeRecipeVersion(row) }));
  // The immutable receipt is written with the food and reference. Reading it
  // avoids attaching a subsequently added reference to an older command.
  for (const row of operation.results) {
    const receipt = JSON.parse(String(row.response_json)) as { result?: { reference?: unknown } };
    if (receipt.result?.reference) {
      const reference = ledgerSupplementSchema.parse({ kind: 'nutrition_reference', value: { ...(receipt.result.reference as Record<string, unknown>), ownerId: owner } });
      supplements.push(reference);
    }
  }
  return supplements;
}
