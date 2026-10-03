// Imported only by the local rehearsal runner, never by the app or Worker.
export function fixtureProgram(state) {
  const weekday=new Date(`${state.today}T12:00:00Z`).getUTCDay();
  return {...state.program,targets:{},ramp:[],cycleStart:null,constraints:[],days:[
    {id:'rehearsal_today',name:'胸与背',weekday,items:[
      {exerciseId:'bench_press',sets:2,repMin:6,repMax:8,startLoad:null,note:'按本组实际完成情况记录。'},
      {exerciseId:'seated_row',sets:2,repMin:8,repMax:12,startLoad:null},
    ]},
    {id:'rehearsal_next',name:'腿与肩',weekday:(weekday+2)%7,items:[
      {exerciseId:'leg_press',sets:2,repMin:8,repMax:12,startLoad:null},
      {exerciseId:'lateral_raise',sets:2,repMin:10,repMax:12,startLoad:null,note:'重量按单只哑铃记录。'},
    ]},
  ]};
}
export function fixtureRecords(today,actor='user') {
  const base={date:today,dateOrigin:'device',source:{actor,channel:actor==='model'?'mcp':'ui',client:actor==='model'?'rehearsal':'web'},confidence:1};
  return [
    {...base,kind:'weight',kg:68,raw:{value:68,unit:'kg'},condition:'unspecified'},
    ...[['bench_press',95,'lb',8],['seated_row',30,'kg',10],['leg_press',70,'kg',10],['lateral_raise',10,'lb',10]].map(([exerciseId,load,unit,reps])=>({...base,kind:'set',sessionId:`rehearsal_${today}`,exerciseId,setIndex:1,load,unit,loadKind:'external',reps,rir:null,setRole:'work'})),
  ];
}
