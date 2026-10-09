// Synthetic examples only. Never imported by the app or Worker.
export const fixtureToday = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateAt = day => new Date(Date.parse(fixtureToday+'T00:00:00Z') + day*86400000).toISOString().slice(0,10);
const weekday = date => new Date(date+'T12:00:00Z').getUTCDay();
export const fixtureWeek = dateAt(-((weekday(fixtureToday)+6)%7));
export const fixturePlans = [
  {title:'胸与背',weekday:weekday(dateAt(1)),items:[
    {ex:'bench_press',load:115,unit:'lb',loadKind:'external',sets:3,min:6,max:8,note:'肩胛收稳。每一组都留一点余地。'},
    {ex:'pull_up',load:25,unit:'kg',loadKind:'assist',sets:3,min:6,max:10,note:'从完全伸展开始，不借惯性。'},
    {ex:'seated_row',load:35,unit:'kg',loadKind:'external',sets:3,min:10,max:12},
  ],coach:'这次把注意力放在动作的完整性上。稳定完成，再考虑下一步。'},
  {title:'腿与肩',weekday:weekday(dateAt(3)),items:[
    {ex:'back_squat',load:175,unit:'lb',loadKind:'external',sets:3,min:6,max:8,note:'下蹲有控制，起身时保持躯干稳定。'},
    {ex:'db_shoulder_press',load:45,unit:'lb',loadKind:'external',sets:3,min:8,max:10,note:'重量为单只哑铃。'},
    {ex:'lateral_raise',load:15,unit:'lb',loadKind:'external',sets:3,min:12,max:15,optional:true},
  ],coach:'按自己的节奏，做好每一组。'},
];
export const fixtureWeights = Array.from({length:23},(_,i)=>({date:dateAt(i-22),lb:160 + i*.065 + [0,.4,-.2,.1,-.3,.2,0][i%7]}));
export const fixtureSessions = Array.from({length:9},(_,i)=>({
  date:dateAt(i*2-16),title:'胸与背',note:'今天按计划完成。卧推最后一组比上次稳。',
  sets:[
    {ex:'bench_press',load:65,unit:'lb',kind:'external',reps:8,role:'warmup'},
    {ex:'bench_press',load:95+i*2.5,unit:'lb',kind:'external',reps:8,role:'work',rir:2},
    {ex:'bench_press',load:95+i*2.5,unit:'lb',kind:'external',reps:8,cheat:2,role:'work',rir:1},
    {ex:'bench_press',load:85,unit:'lb',kind:'external',reps:6,role:'backoff'},
    {ex:'bench_press',load:65,unit:'lb',kind:'external',reps:6,role:'drop',partial:true},
    {ex:'back_squat',load:135+i*2.5,unit:'lb',kind:'external',reps:6,role:'work'},
    {ex:'db_shoulder_press',load:35+i*1.25,unit:'lb',kind:'external',reps:8,role:'work'},
    {ex:'pull_up',load:35-i*1.25,unit:'kg',kind:'assist',reps:8,role:'work'},
  ],
}));
export const fixtureCuration = {week:fixtureWeek,theme:{id:'gold',why:'主项稳步前进'},next:{date:dateAt(1),text:'先把动作做完整。'},recap:{title:'稳稳地向前',letter:['这周卧推完成得更稳。','下次留意动作的完整性。'],picks:[{kind:'barbell',ex:'bench_press',date:fixtureToday,title:'再多一点',note:'动作稳定之后再加重量。'},{kind:'assist',ex:'pull_up',date:fixtureToday,title:'靠近徒手',note:'记录来自严格完成的组。'}],focus:{ex:'bench_press',why:'这条线记录了几周的变化。'}},body:{date:fixtureToday,text:'看趋势，不用追着每天的变化走。'},log:{[fixtureToday]:'最后一组比上次稳。'}};
export async function seedShowroom(tool) {
  for (const args of fixturePlans) await tool('set_plan',args);
  await tool('set_profile',{body_notes:'演练备注：肩部状态平稳。',gain_target:{start:dateAt(-22),startLb:160,min:.25,max:.5}});
  for (const args of fixtureWeights) await tool('log_weight',args);
  for (const args of fixtureSessions) await tool('log_session',args);
  await tool('curate',fixtureCuration);
}
