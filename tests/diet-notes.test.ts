import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { localRuntime } from '../scripts/local-runtime.mjs';
import { applyMigrations } from '../scripts/migrations.mjs';
import { createMeal, editMeal, createMealDraft, readMealTree } from '../src/server/meals.ts';
import { nutritionDaySummary } from '../src/server/nutrition-days.ts';
import { patchDayClaim } from '../src/server/days.ts';
import { undoNutrition } from '../src/server/nutrition-undo.ts';
import { saveFavorite, copyFavorite } from '../src/server/nutrition-library.ts';
import { meals, mealDrafts } from '../src/server/nutrition-store.ts';
import { claims } from '../src/server/training-store.ts';
import { readArtifacts } from '../src/server/artifacts.ts';
import { emptyNutrients, mealInputSchema, mealNoteSnapshotSchema } from '../src/domain/nutrition.ts';
import { dayClaimInputSchema } from '../src/domain/day-claims.ts';
import { prepareMutation } from '../src/domain/manual-commands.ts';
import { noteOccurrence } from '../src/app/nutrition/note-input.ts';
import type { AuthContext } from '../src/server/auth.ts';

const owner = 'b3db19a3-7b84-4fb6-bb23-3d789d5a1641', other = '29a3d61a-d672-4359-834c-792af3bbce87';
const auth: AuthContext = { id: owner, role: 'member', locale: 'en', timezone: 'America/Chicago', status: 'active' };
const clock = () => new Date('2026-09-16T20:00:00.000Z'), op = () => crypto.randomUUID(), date = '2026-09-16';
const occurrence = { localDate: date, entryTimezone: auth.timezone, occurredAt: null, timePrecision: 'date' };
const note = (description = '小炒牛肉吃了一半、米饭一碗\n给自己留个便签') => ({ description, nutrients: { ...emptyNutrients } });
const input = () => ({ id: op(), ...occurrence, note: note() });
let runtime: ReturnType<typeof localRuntime>, db: D1Database;
beforeAll(async () => { runtime = localRuntime(); db = await runtime.getD1Database('DB') as unknown as D1Database; await applyMigrations(db); });
afterAll(async () => { await runtime.dispose(); });
beforeEach(async () => {
  const tables = ['change_batches','operation_revisions','command_operations','mutation_guards','import_drafts','meal_items','meals','favorites','day_claims','users'];
  await db.batch(['DROP TRIGGER IF EXISTS reject_note', ...tables.map(table => 'DELETE FROM ' + table)].map(sql => db.prepare(sql)));
  for (const id of [owner,other]) await db.prepare("INSERT INTO users(id,email_normalized,role,status,locale,timezone,created_at) VALUES (?,?,'member','active','en','America/Chicago',?)").bind(id,id+'@example.invalid',clock().toISOString()).run();
});
async function day() { return (await claims.list(db,owner,'local_date=?',[date]))[0]; }
async function complete() {
  const current = await day();
  return patchDayClaim(db,auth,op(),date,current?.revision,{id:current?.id ?? op(),entryTimezone:auth.timezone,nutritionCompleteness:'complete',expectedNutritionContentRevision:current?.nutritionContentRevision ?? 0},clock);
}
describe('durable food notes', () => {
  it('records verbatim text with all nutrition unknown, no fabricated items, and no expiry', async () => {
    const value=input(), operationId=op();
    const first=await createMeal(db,auth,operationId,value,clock);
    expect(await createMeal(db,auth,operationId,value,clock)).toEqual(first);
    const tree=await readMealTree(db,owner,value.id);
    expect(tree.items).toEqual([]);
    expect(tree.meal.note).toMatchObject({description:value.note.description,nutrients:emptyNutrients,nutrientSnapshot:{energyMkcal:null,provenance:'user_entered'}});
    expect(tree.meal).toMatchObject({timePrecision:'date',occurredAt:null,sourceKind:'manual'});
    expect('expiresAt' in tree.meal).toBe(false);
    await complete();
    expect(await nutritionDaySummary(db,owner,date)).toMatchObject({mealCount:1,completeness:'complete',knownSum:{energyMkcal:null,proteinMg:null},unknownCounts:{energy:1,protein:1,carbs:1,fat:1}});
    const views=await readArtifacts(db,auth,{localDate:date,kind:'DietArtifact'},clock);
    expect(JSON.stringify(views)).toContain(value.id);
    await expect(meals.read(db,other,value.id)).rejects.toMatchObject({code:'RECORD_NOT_FOUND'});
  });
  it('edits the same note, rounds once, and never interprets half as a multiplier',async()=>{
    const value=input();await createMeal(db,auth,op(),value,clock);
    await editMeal(db,auth,op(),value.id,1,{note:{...note(),nutrients:{...emptyNutrients,energyKcal:'123.4567',proteinG:'12.5'}}},false,clock);
    const current=await meals.read(db,owner,value.id);
    expect(current).toMatchObject({revision:2,note:{nutrients:{energyKcal:'123.4567'},nutrientSnapshot:{energyMkcal:123457,proteinMg:12500,carbsMg:null}}});
    expect((await nutritionDaySummary(db,owner,date)).knownSum.energyMkcal).toBe(123457);
    await editMeal(db,auth,op(),value.id,2,{note:note('同一餐，补一句')},false,clock);
    expect((await meals.list(db,owner)).length).toBe(1);
    expect((await meals.read(db,owner,value.id)).note?.nutrientSnapshot.energyMkcal).toBeNull();
  });
  it('rejects fabricated quantity, empty notes, forged snapshots, and large values without review',async()=>{
    expect(mealInputSchema.safeParse({...input(),items:[{id:op()}]}).success).toBe(false);
    expect(mealInputSchema.safeParse({...input(),note:note('   ')}).success).toBe(false);
    expect(mealInputSchema.safeParse({...input(),ownerId:other}).success).toBe(false);
    const value={...input(),note:{...note(),nutrients:{...emptyNutrients,energyKcal:'3001'}}};
    await expect(createMeal(db,auth,op(),value,clock)).rejects.toMatchObject({code:'NEEDS_CONFIRMATION'});
    await createMeal(db,auth,op(),{...value,note:{...value.note,confirmLargePortion:true}},clock);
    const snapshot=(await meals.read(db,owner,value.id)).note!;
    expect(mealNoteSnapshotSchema.safeParse({...snapshot,nutrientSnapshot:{...snapshot.nutrientSnapshot,energyMkcal:0}}).success).toBe(false);
    expect(()=>editMeal(db,auth,op(),value.id,1,{note:note('')},false,clock)).toThrow();
  });
  it('copies frozen note snapshots without fabricating food items',async()=>{
    const value=input();await createMeal(db,auth,op(),value,clock);const favoriteId=op();
    await saveFavorite(db,auth,op(),{id:favoriteId,title:'Repeat',mealRef:{id:value.id,revision:1}},undefined,clock);
    const copied=op();await copyFavorite(db,auth,op(),favoriteId,{id:copied,...occurrence,expectedRevision:1},clock);
    expect((await meals.read(db,owner,copied)).note).toEqual((await meals.read(db,owner,value.id)).note);
    expect((await readMealTree(db,owner,copied)).items).toEqual([]);
  });
  it('atomically preserves facts, review version and receipts when event writing fails',async()=>{
    const value=input();await createMeal(db,auth,op(),value,clock);await complete();
    const before=await day(), revision=await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision');
    await db.prepare("CREATE TRIGGER reject_note BEFORE INSERT ON change_batches BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
    const operationId=op();
    await expect(editMeal(db,auth,operationId,value.id,1,{note:note('changed')},false,clock)).rejects.toThrow();
    expect(await day()).toEqual(before);
    expect((await meals.read(db,owner,value.id)).revision).toBe(1);
    expect(await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(owner).first('data_revision')).toBe(revision);
    expect(await db.prepare('SELECT operation_id FROM command_operations WHERE operation_id=?').bind(operationId).first()).toBeNull();
  });
  it('retains old candidates until explicitly converted, including expired manual text',async()=>{
    const draft={id:op(),kind:'meal',...occurrence,description:'Original text only'};
    await createMealDraft(db,auth,op(),draft,clock);
    await db.prepare("UPDATE import_drafts SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(draft.id).run();
    expect((await meals.list(db,owner))).toEqual([]);
    const value={...input(),note:note(draft.description),draftRef:{id:draft.id,revision:1}};
    const receipt=await createMeal(db,auth,op(),value,clock);
    expect((await mealDrafts.read(db,owner,draft.id)).confirmedMealId).toBe(value.id);
    expect((await meals.read(db,owner,value.id)).sourceRef).toBe(draft.id);
    await undoNutrition(db,auth,op(),receipt.operationId,clock);
    expect((await mealDrafts.read(db,owner,draft.id)).status).toBe('needs_input');
    expect((await nutritionDaySummary(db,owner,date)).mealCount).toBe(0);
  });
});
describe('nutrition review binds the actual day contents',()=>{
  it('rejects unseen content even with a fresh claim revision and leaves other dates independent',async()=>{
    await createMeal(db,auth,op(),input(),clock);const seen=await day();
    await createMeal(db,auth,op(),input(),clock);const current=await day();
    expect(current.nutritionContentRevision).toBe(seen.nutritionContentRevision+1);
    await expect(patchDayClaim(db,auth,op(),date,current.revision,{id:current.id,entryTimezone:auth.timezone,nutritionCompleteness:'complete',expectedNutritionContentRevision:seen.nutritionContentRevision},clock)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await createMeal(db,auth,op(),{...input(),localDate:'2026-09-15'},clock);
    await patchDayClaim(db,auth,op(),date,current.revision,{id:current.id,entryTimezone:auth.timezone,nutritionCompleteness:'complete',expectedNutritionContentRevision:current.nutritionContentRevision},clock);
    expect((await day()).nutritionCompleteness).toBe('complete');
  });
  it('increments versions for changes, moves and undo without restoring complete',async()=>{
    const value=input(), receipt=await createMeal(db,auth,op(),value,clock);await complete();
    const before=await day();
    const edit=await editMeal(db,auth,op(),value.id,1,{localDate:'2026-09-15'},false,clock);
    expect(await day()).toMatchObject({nutritionContentRevision:before.nutritionContentRevision+1,nutritionCompleteness:'partial'});
    await undoNutrition(db,auth,op(),edit.operationId,clock);
    expect(await day()).toMatchObject({nutritionContentRevision:before.nutritionContentRevision+2,nutritionCompleteness:'partial'});
    await expect(undoNutrition(db,auth,op(),receipt.operationId,clock)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await editMeal(db,auth,op(),value.id,3,{},true,clock);
    expect((await nutritionDaySummary(db,owner,date)).knownSum.energyMkcal).toBeNull();
  });
  it('serializes concurrent first notes into one day version container',async()=>{
    const results=await Promise.all([createMeal(db,auth,op(),input(),clock),createMeal(db,auth,op(),input(),clock)]);
    expect(results).toHaveLength(2);
    expect((await claims.list(db,owner))).toHaveLength(1);
    expect((await day()).nutritionContentRevision).toBe(2);
    expect((await nutritionDaySummary(db,owner,date)).mealCount).toBe(2);
  });
  it('requires a content version in typed review commands and refuses unsupported fields',()=>{
    const base={id:op(),entryTimezone:auth.timezone,nutritionCompleteness:'complete'};
    expect(dayClaimInputSchema.safeParse(base).success).toBe(false);
    const review={kind:'day-claim.create',localDate:date,input:{...base,expectedNutritionContentRevision:0,explicitZeroIntake:true}};
    expect(prepareMutation(review)).toMatchObject({path:'/api/v1/days/'+date,method:'PATCH',expectedRevision:null});
    expect(()=>prepareMutation({...review,input:{...review.input,ownerId:other}})).toThrow();
  });
});
it('handles date-only notes and refuses ambiguous or missing DST times',()=>{
  expect(noteOccurrence('2026-09-16','','America/Chicago')).toEqual({occurredAt:null,timePrecision:'date'});
  expect(noteOccurrence('2020-01-01','12:30','America/Chicago').occurredAt).toBe('2020-01-01T18:30:00.000Z');
  expect(()=>noteOccurrence('2020-03-08','02:30','America/Chicago')).toThrow();
  expect(()=>noteOccurrence('2020-11-01','01:30','America/Chicago')).toThrow();
});
