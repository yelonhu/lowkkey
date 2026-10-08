// Synthetic examples only. Never imported by the app or Worker.
const start = '2026-09-17';
const dateAt = day => new Date(Date.parse(start+'T00:00:00Z') + day*86400000).toISOString().slice(0,10);
export const fixturePlans = [
  {day:'胸与背',items:[
    {exerciseId:'bench_press',load:115,unit:'lb',loadKind:'external',sets:3,repMin:6,repMax:8,note:'肩胛收稳。每一组都留一点余地。'},
    {exerciseId:'pull_up',load:25,unit:'kg',loadKind:'assist',sets:3,repMin:6,repMax:10,note:'从完全伸展开始，不借惯性。'},
    {exerciseId:'seated_row',load:35,unit:'kg',loadKind:'external',sets:3,repMin:10,repMax:12},
  ],notes:{coach:'这次把注意力放在动作的完整性上。稳定完成，再考虑下一步。',body:'演练备注：肩部状态平稳。',gain_target:{start_date:start,start_lb:160,weekly_lb_min:.25,weekly_lb_max:.5}}},
  {day:'腿与肩',items:[
    {exerciseId:'back_squat',load:155,unit:'lb',loadKind:'external',sets:3,repMin:6,repMax:8,note:'下蹲有控制，起身时保持躯干稳定。'},
    {exerciseId:'db_shoulder_press',load:45,unit:'lb',loadKind:'external',sets:3,repMin:8,repMax:10,note:'重量为单只哑铃。'},
    {exerciseId:'lateral_raise',load:15,unit:'lb',loadKind:'external',sets:3,repMin:12,repMax:15},
  ],notes:{coach:'按自己的节奏，做好每一组。'}},
];
export const fixtureWeights = Array.from({length:21},(_,i)=>({date:dateAt(i),lb:160 + i*.065 + [0,.4,-.2,.1,-.3,.2,0][i%7]}));
export const fixtureSessions = Array.from({length:9},(_,i)=>({
  date:dateAt(i*2+1),
  raw_text:'演练记录 · '+dateAt(i*2+1)+'\n今天按计划完成。卧推最后一组比上次稳，深蹲没有着急加重量。\n推肩按单只哑铃记；引体用了辅助。练完收拾好，回家吃饭。',
  sets:[
    {exerciseId:'bench_press',load:65,unit:'lb',loadKind:'external',reps:8,setRole:'warmup'},
    {exerciseId:'bench_press',load:95+i*2.5,unit:'lb',loadKind:'external',reps:8,setRole:'work',rir:2},
    {exerciseId:'bench_press',load:95+i*2.5,unit:'lb',loadKind:'external',reps:6,setRole:'work',rir:1},
    {exerciseId:'back_squat',load:135+i*2.5,unit:'lb',loadKind:'external',reps:6,setRole:'work'},
    {exerciseId:'db_shoulder_press',load:35+i*1.25,unit:'lb',loadKind:'external',reps:8,setRole:'work'},
    {exerciseId:'pull_up',load:35-i*1.25,unit:'kg',loadKind:'assist',reps:8,setRole:'work'},
  ],
}));
export async function seedShowroom(tool) {
  for (const args of fixturePlans) await tool('set_plan',args);
  for (const args of fixtureWeights) await tool('log_weight',args);
  for (const args of fixtureSessions) await tool('log_session',args);
}
