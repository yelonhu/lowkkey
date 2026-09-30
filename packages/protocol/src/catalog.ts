import type { Exercise, Program } from './entities.ts';


/**
 * 通用动作库。不含任何个人数据；用户可在计划里引用，也可新增自定义动作。
 * load 单位按美国健身房常见读数：自由重量 lb，器械 kg。部署到其他地区时可整体切换。
 */
export const EXERCISE_LIBRARY: Exercise[] = [
  { id: 'bench_press', name: '杠铃平板卧推', aliases: ['卧推', '平板卧推', 'bench'], type: 'barbell', unit: 'lb', barLoad: 45, perHand: false, muscles: { chest: 1, triceps: 0.5, shoulders: 0.25 } },
  { id: 'incline_db_press', name: '上斜哑铃卧推', aliases: ['上斜', '哑铃上斜', '上斜卧推'], type: 'dumbbell', unit: 'lb', perHand: true, muscles: { chest: 1, triceps: 0.5, shoulders: 0.5 } },
  { id: 'dip', name: '双杠臂屈伸', aliases: ['双杠', 'dip', 'dips'], type: 'assisted', unit: 'kg', perHand: false, muscles: { chest: 0.5, triceps: 1 } },
  { id: 'pec_deck', name: '蝴蝶机夹胸', aliases: ['夹胸', '蝴蝶机', '飞鸟'], type: 'machine', unit: 'kg', perHand: false, muscles: { chest: 1 } },
  { id: 'cable_fly', name: '绳索夹胸', aliases: ['龙门夹胸', '绳索飞鸟'], type: 'cable', unit: 'kg', perHand: false, muscles: { chest: 1 } },
  { id: 'pull_up', name: '引体向上', aliases: ['引体'], type: 'assisted', unit: 'kg', perHand: false, muscles: { back: 1, biceps: 0.5 } },
  { id: 'lat_pulldown', name: '高位下拉', aliases: ['下拉'], type: 'machine', unit: 'kg', perHand: false, muscles: { back: 1, biceps: 0.5 } },
  { id: 'seated_row', name: '坐姿绳索划船', aliases: ['坐姿划船', '划船'], type: 'cable', unit: 'kg', perHand: false, muscles: { back: 1, biceps: 0.5, rear_delts: 0.25 } },
  { id: 'barbell_row', name: '俯身杠铃划船', aliases: ['杠铃划船', '俯身划船'], type: 'barbell', unit: 'lb', barLoad: 45, perHand: false, muscles: { back: 1, biceps: 0.5, rear_delts: 0.5 } },
  { id: 'face_pull', name: '面拉', aliases: ['face pull'], type: 'cable', unit: 'kg', perHand: false, muscles: { rear_delts: 1 } },
  { id: 'db_shoulder_press', name: '坐姿哑铃推肩', aliases: ['推肩', '哑铃推肩'], type: 'dumbbell', unit: 'lb', perHand: true, muscles: { shoulders: 1, triceps: 0.5 } },
  { id: 'lateral_raise', name: '侧平举', aliases: ['哑铃侧平举'], type: 'dumbbell', unit: 'lb', perHand: true, muscles: { shoulders: 1 } },
  { id: 'ez_curl', name: 'EZ 杠弯举', aliases: ['弯举', 'EZ弯举'], type: 'barbell', unit: 'lb', barLoad: 25, perHand: false, muscles: { biceps: 1 } },
  { id: 'db_curl', name: '哑铃弯举', aliases: ['哑铃二头'], type: 'dumbbell', unit: 'lb', perHand: true, muscles: { biceps: 1 } },
  { id: 'skull_crusher', name: '仰卧臂屈伸', aliases: ['臂屈伸', '碎颅'], type: 'barbell', unit: 'lb', barLoad: 25, perHand: false, muscles: { triceps: 1 } },
  { id: 'triceps_pushdown', name: '绳索三头下压', aliases: ['下压', '三头下压'], type: 'cable', unit: 'kg', perHand: false, muscles: { triceps: 1 } },
  { id: 'back_squat', name: '杠铃深蹲', aliases: ['深蹲', '蹲'], type: 'barbell', unit: 'lb', barLoad: 45, perHand: false, muscles: { quads: 1, glutes: 0.5, adductors: 0.25 } },
  { id: 'hack_squat', name: '哈克深蹲', aliases: ['哈克'], type: 'machine', unit: 'kg', perHand: false, muscles: { quads: 1, glutes: 0.5 } },
  { id: 'leg_press', name: '倒蹬', aliases: ['腿举'], type: 'machine', unit: 'kg', perHand: false, muscles: { quads: 1, glutes: 0.5 } },
  { id: 'romanian_deadlift', name: '罗马尼亚硬拉', aliases: ['RDL', '罗马尼亚'], type: 'barbell', unit: 'lb', barLoad: 45, perHand: false, muscles: { hamstrings: 1, glutes: 0.5, back: 0.25 } },
  { id: 'seated_leg_curl', name: '坐姿腿弯举', aliases: ['腿弯举'], type: 'machine', unit: 'kg', perHand: false, muscles: { hamstrings: 1 } },
  { id: 'leg_extension', name: '腿屈伸', aliases: [], type: 'machine', unit: 'kg', perHand: false, muscles: { quads: 1 } },
  { id: 'hip_adduction', name: '髋内收', aliases: ['内收', '夹腿'], type: 'machine', unit: 'kg', perHand: false, muscles: { adductors: 1 } },
  { id: 'calf_raise', name: '提踵', aliases: [], type: 'machine', unit: 'kg', perHand: false, muscles: { calves: 1 } },
];

/** 计划模板：通用、无起始重量（第一次由你自选）。 */
export const PROGRAM_TEMPLATES: { id: string; name: string; summary: string; program: Program }[] = [
  {
    id: 'upper_lower',
    name: '上肢 / 下肢',
    summary: '每周 4 练，上下肢交替',
    program: {
      cycleStart: null,
      ramp: [],
      constraints: [],
      targets: { bodyweightKg: null, rateKgPerWeek: null, weeklySets: null, calorieTrigger: null },
      days: [
        { id: 'upper_a', name: '上肢 A', weekday: 1, items: [
          { exerciseId: 'bench_press', sets: 4, repMin: 5, repMax: 8, startLoad: null },
          { exerciseId: 'seated_row', sets: 3, repMin: 8, repMax: 12, startLoad: null },
          { exerciseId: 'db_shoulder_press', sets: 3, repMin: 8, repMax: 10, startLoad: null },
          { exerciseId: 'lat_pulldown', sets: 3, repMin: 10, repMax: 12, startLoad: null },
        ] },
        { id: 'lower_a', name: '下肢 A', weekday: 2, items: [
          { exerciseId: 'back_squat', sets: 4, repMin: 6, repMax: 8, startLoad: null },
          { exerciseId: 'romanian_deadlift', sets: 3, repMin: 8, repMax: 10, startLoad: null },
          { exerciseId: 'seated_leg_curl', sets: 3, repMin: 10, repMax: 12, startLoad: null },
          { exerciseId: 'calf_raise', sets: 3, repMin: 10, repMax: 15, startLoad: null },
        ] },
        { id: 'upper_b', name: '上肢 B', weekday: 4, items: [
          { exerciseId: 'incline_db_press', sets: 3, repMin: 8, repMax: 10, startLoad: null },
          { exerciseId: 'pull_up', sets: 3, repMin: 5, repMax: 8, startLoad: null },
          { exerciseId: 'lateral_raise', sets: 4, repMin: 12, repMax: 15, startLoad: null },
          { exerciseId: 'ez_curl', sets: 3, repMin: 8, repMax: 12, startLoad: null },
          { exerciseId: 'triceps_pushdown', sets: 3, repMin: 10, repMax: 15, startLoad: null },
        ] },
        { id: 'lower_b', name: '下肢 B', weekday: 5, items: [
          { exerciseId: 'hack_squat', sets: 3, repMin: 8, repMax: 12, startLoad: null },
          { exerciseId: 'leg_press', sets: 3, repMin: 10, repMax: 12, startLoad: null },
          { exerciseId: 'leg_extension', sets: 3, repMin: 12, repMax: 15, startLoad: null },
          { exerciseId: 'hip_adduction', sets: 3, repMin: 12, repMax: 15, startLoad: null },
        ] },
      ],
    },
  },
  {
    id: 'push_pull_legs',
    name: '推 / 拉 / 腿',
    summary: '每周 3 练，推、拉、腿各一天',
    program: {
      cycleStart: null,
      ramp: [],
      constraints: [],
      targets: { bodyweightKg: null, rateKgPerWeek: null, weeklySets: null, calorieTrigger: null },
      days: [
        { id: 'push', name: '推', weekday: 1, items: [
          { exerciseId: 'bench_press', sets: 4, repMin: 5, repMax: 8, startLoad: null },
          { exerciseId: 'incline_db_press', sets: 3, repMin: 8, repMax: 10, startLoad: null },
          { exerciseId: 'lateral_raise', sets: 4, repMin: 12, repMax: 15, startLoad: null },
          { exerciseId: 'triceps_pushdown', sets: 3, repMin: 10, repMax: 15, startLoad: null },
        ] },
        { id: 'pull', name: '拉', weekday: 3, items: [
          { exerciseId: 'pull_up', sets: 4, repMin: 5, repMax: 8, startLoad: null },
          { exerciseId: 'seated_row', sets: 3, repMin: 8, repMax: 12, startLoad: null },
          { exerciseId: 'face_pull', sets: 3, repMin: 15, repMax: 20, startLoad: null },
          { exerciseId: 'ez_curl', sets: 3, repMin: 8, repMax: 12, startLoad: null },
        ] },
        { id: 'legs', name: '腿', weekday: 5, items: [
          { exerciseId: 'back_squat', sets: 4, repMin: 6, repMax: 8, startLoad: null },
          { exerciseId: 'romanian_deadlift', sets: 3, repMin: 8, repMax: 10, startLoad: null },
          { exerciseId: 'seated_leg_curl', sets: 3, repMin: 10, repMax: 12, startLoad: null },
          { exerciseId: 'hip_adduction', sets: 3, repMin: 12, repMax: 15, startLoad: null },
        ] },
      ],
    },
  },
];

export const EMPTY_PROGRAM: Program = {
  cycleStart: null,
  ramp: [],
  days: [],
  constraints: [],
  targets: { bodyweightKg: null, rateKgPerWeek: null, weeklySets: null, calorieTrigger: null },
};
