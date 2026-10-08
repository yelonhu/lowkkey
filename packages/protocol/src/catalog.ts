import type { Unit } from './primitives.ts';

export type Exercise = { id: string; name: string; aliases: string[]; type: string; unit: Unit; perHand: boolean };


/**
 * 通用动作库。不含任何个人数据；只提供动作名称和重量语义，不包含个人计划。
 * load 单位按美国健身房常见读数：自由重量 lb，器械 kg。部署到其他地区时可整体切换。
 */
export const EXERCISE_LIBRARY: Exercise[] = [
  { id: 'bench_press', name: '杠铃平板卧推', aliases: ['卧推', '平板卧推', 'bench'], type: 'barbell', unit: 'lb', perHand: false },
  { id: 'incline_db_press', name: '上斜哑铃卧推', aliases: ['上斜', '哑铃上斜', '上斜卧推'], type: 'dumbbell', unit: 'lb', perHand: true },
  { id: 'dip', name: '双杠臂屈伸', aliases: ['双杠', 'dip', 'dips'], type: 'assisted', unit: 'kg', perHand: false },
  { id: 'pec_deck', name: '蝴蝶机夹胸', aliases: ['夹胸', '蝴蝶机', '飞鸟'], type: 'machine', unit: 'kg', perHand: false },
  { id: 'cable_fly', name: '绳索夹胸', aliases: ['龙门夹胸', '绳索飞鸟'], type: 'cable', unit: 'kg', perHand: false },
  { id: 'pull_up', name: '引体向上', aliases: ['引体'], type: 'assisted', unit: 'kg', perHand: false },
  { id: 'lat_pulldown', name: '高位下拉', aliases: ['下拉'], type: 'machine', unit: 'kg', perHand: false },
  { id: 'seated_row', name: '坐姿绳索划船', aliases: ['坐姿划船', '划船'], type: 'cable', unit: 'kg', perHand: false },
  { id: 'barbell_row', name: '俯身杠铃划船', aliases: ['杠铃划船', '俯身划船'], type: 'barbell', unit: 'lb', perHand: false },
  { id: 'face_pull', name: '面拉', aliases: ['face pull'], type: 'cable', unit: 'kg', perHand: false },
  { id: 'db_shoulder_press', name: '坐姿哑铃推肩', aliases: ['推肩', '哑铃推肩'], type: 'dumbbell', unit: 'lb', perHand: true },
  { id: 'lateral_raise', name: '侧平举', aliases: ['哑铃侧平举'], type: 'dumbbell', unit: 'lb', perHand: true },
  { id: 'ez_curl', name: 'EZ 杠弯举', aliases: ['弯举', 'EZ弯举'], type: 'barbell', unit: 'lb', perHand: false },
  { id: 'db_curl', name: '哑铃弯举', aliases: ['哑铃二头'], type: 'dumbbell', unit: 'lb', perHand: true },
  { id: 'skull_crusher', name: '仰卧臂屈伸', aliases: ['臂屈伸', '碎颅'], type: 'barbell', unit: 'lb', perHand: false },
  { id: 'triceps_pushdown', name: '绳索三头下压', aliases: ['下压', '三头下压'], type: 'cable', unit: 'kg', perHand: false },
  { id: 'back_squat', name: '杠铃深蹲', aliases: ['深蹲', '蹲'], type: 'barbell', unit: 'lb', perHand: false },
  { id: 'hack_squat', name: '哈克深蹲', aliases: ['哈克'], type: 'machine', unit: 'kg', perHand: false },
  { id: 'leg_press', name: '倒蹬', aliases: ['腿举'], type: 'machine', unit: 'kg', perHand: false },
  { id: 'romanian_deadlift', name: '罗马尼亚硬拉', aliases: ['RDL', '罗马尼亚'], type: 'barbell', unit: 'lb', perHand: false },
  { id: 'seated_leg_curl', name: '坐姿腿弯举', aliases: ['腿弯举'], type: 'machine', unit: 'kg', perHand: false },
  { id: 'leg_extension', name: '腿屈伸', aliases: [], type: 'machine', unit: 'kg', perHand: false },
  { id: 'hip_adduction', name: '髋内收', aliases: ['内收', '夹腿'], type: 'machine', unit: 'kg', perHand: false },
  { id: 'calf_raise', name: '提踵', aliases: [], type: 'machine', unit: 'kg', perHand: false },
];


export const STRENGTH_EXERCISES = ['bench_press', 'back_squat', 'db_shoulder_press', 'pull_up'] as const;
export const exerciseById = (id: string) => EXERCISE_LIBRARY.find(exercise => exercise.id === id)!;
