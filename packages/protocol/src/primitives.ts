import { z } from 'zod';

/** 协议版本。任何破坏性变更都要递增主版本，并在 docs/PROTOCOL.md 的变更记录里说明。 */
export const PROTOCOL_VERSION = '2.0.0';

/** 不透明 ID。推荐 ULID（可按时间排序），但消费方不得解析其内容。 */
export const Id = z.string().min(1).max(64).describe('不透明 ID，推荐 ULID');
export type Id = z.infer<typeof Id>;

/** 用户本地日期（用户所在时区的日历日）。所有「哪一天」的语义都用它，而不是 UTC 时间戳。 */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .describe('用户本地日期 YYYY-MM-DD');
export type LocalDate = z.infer<typeof LocalDate>;

/** UTC 时间戳，ISO 8601。只用于排序与审计，不用于判断「哪一天」。 */
export const Instant = z.iso.datetime({ offset: true }).describe('ISO 8601 时间戳');
export type Instant = z.infer<typeof Instant>;

export const Unit = z.enum(['kg', 'lb']);
export type Unit = z.infer<typeof Unit>;

/** 谁产生了这条数据。 */
export const Actor = z.enum(['user', 'model', 'rule']);
export type Actor = z.infer<typeof Actor>;

/** 数据从哪个通道进来。 */
export const Channel = z.enum(['text', 'voice', 'photo', 'ui', 'mcp', 'import']);
export type Channel = z.infer<typeof Channel>;

/**
 * 来源（provenance）。每一条记录、提议、派生值都必须带来源。
 * - actor=model 时，client 必须填写（如 "claude"、"chatgpt"）。
 * - rawText 保存用户原话或 OCR 原文，永不修改。
 */
export const Source = z.object({
  actor: Actor,
  channel: Channel,
  client: z.string().max(64).optional().describe('客户端标识：web / claude / chatgpt / …'),
  rawText: z.string().max(4000).optional(),
});
export type Source = z.infer<typeof Source>;

/** 日期是怎么确定的。只有 explicit 与 device 可以不经确认直接入账（闸门 G2）。 */
export const DateOrigin = z.enum(['explicit', 'device', 'inferred']);
export type DateOrigin = z.infer<typeof DateOrigin>;

export const Muscle = z.enum([
  'chest',
  'back',
  'shoulders',
  'rear_delts',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'adductors',
  'calves',
  'core',
]);
export type Muscle = z.infer<typeof Muscle>;

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: '胸',
  back: '背',
  shoulders: '肩',
  rear_delts: '后束',
  biceps: '二头',
  triceps: '三头',
  quads: '股四',
  hamstrings: '腘绳',
  glutes: '臀',
  adductors: '内收',
  calves: '小腿',
  core: '核心',
};
