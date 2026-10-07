import { z } from 'zod';

/**
 * 验证器：确定性代码，负责一切数字结论。模型不得自行计算这些值并当作事实展示。
 * 实现见 @lowkkey/core；每个验证器带版本，派生值记录 ruleVersion。
 */
export const VerifierId = z.enum(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10']);
export type VerifierId = z.infer<typeof VerifierId>;

export const VERIFIERS: Record<VerifierId, { name: string; summary: string; version: string }> = {
  V1: { name: 'trend_slope', summary: '体重 OLS 斜率 × 7 = kg/周（7 日窗口与全程）', version: '1.1.0' },
  V2: { name: 'e1rm', summary: 'Epley：有效负荷 × (1 + 次数/30)；>12 次标记偏差大，>20 次不计算', version: '1.1.0' },
  V3: { name: 'net_load', summary: '辅助动作有效负荷 = 当日体重 − 辅助（kg）', version: '1.1.0' },
  V4: { name: 'warmup_tag', summary: '仅明确标记的热身组不计入正式组；未知分类单独展示', version: '1.1.0' },
  V5: { name: 'intra_session', summary: '本场录入参考：同动作同组别实际重量优先，已确认安排单独展示；不自动加减重量', version: '2.0.0' },
  V6: { name: 'double_progression', summary: '跨场录入参考：沿用最近实际重量，无历史才使用已确认安排；组次读取用户安排', version: '2.0.0' },
  V7: { name: 'weekly_volume', summary: '每肌群每周有效组 = Σ 组 × 肌群权重；用户约束优先', version: '1.1.0' },
  V8: { name: 'calorie_trigger', summary: '用户确认的观察期与目标 → 待审建议；只有采用才追加指令', version: '1.1.0' },
  V9: { name: 'waist_ratio', summary: 'Δ腰围 / Δ体重，仅作描述，不判合格', version: '1.1.0' },
  V10: { name: 'weighin_condition', summary: '称重条件仅作背景标注', version: '1.1.0' },
};

/**
 * 写入闸门：决定一条草稿能否直接入账。任何一道不过 → 进入「需要确认」。
 * 闸门是代码，不是模型（外生性）。
 */
export const GateId = z.enum(['G1', 'G2', 'G3', 'G4', 'G5']);
export type GateId = z.infer<typeof GateId>;

export const GATES: Record<GateId, { name: string; summary: string }> = {
  G1: { name: 'ambiguity', summary: '解析出多个可行解' },
  G2: { name: 'date', summary: '日期不是今天，且不是用户原话里写明的' },
  G3: { name: 'overwrite', summary: '同日同类已有记录（如今天已有体重）' },
  G4: { name: 'outlier', summary: '体重日变化 > 1.5 kg；e1RM 较历史最佳 > +15%；疑似单位错误' },
  G5: { name: 'low_confidence', summary: '模型解析置信度 < 0.85' },
};

export const GATE_THRESHOLDS = {
  weightDailyDeltaKg: 1.5,
  e1rmJumpRatio: 1.15,
  modelConfidence: 0.85,
} as const;

/** 杠铃片（单侧，从大到小）与空杆。 */
export const PLATES = {
  lb: [45, 25, 10, 5, 2.5],
  kg: [20, 15, 10, 5, 2.5, 0.5],
} as const;
export const BAR = { lb: 45, kg: 20 } as const;

/** 默认 8 周周期：系数作用于组数，并给出目标 RIR。 */
export const DEFAULT_RAMP = [
  { week: 1, setMultiplier: 0.7, targetRir: 4, label: '重新适应' },
  { week: 2, setMultiplier: 0.85, targetRir: 3, label: '容量爬坡' },
  { week: 3, setMultiplier: 1, targetRir: 3, label: '满容量' },
  { week: 4, setMultiplier: 1, targetRir: 2, label: '满容量' },
  { week: 5, setMultiplier: 1, targetRir: 2, label: '加重期' },
  { week: 6, setMultiplier: 1, targetRir: 1, label: '加重期' },
  { week: 7, setMultiplier: 1, targetRir: 1, label: '峰值周' },
  { week: 8, setMultiplier: 0.5, targetRir: 4, label: '减载' },
];

export const LB_PER_KG = 2.20462;
