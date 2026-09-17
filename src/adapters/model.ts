import { z } from 'zod';
import { localeSchema } from '../domain/primitives.ts';
export const modelResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('answer'), text: z.string(), evidence: z.array(z.never()) }),
  z.strictObject({ kind: z.literal('clarification'), question: z.string(), choices: z.array(z.string()).optional() }),
  z.strictObject({ kind: z.literal('unsupported'), messageCode: z.literal('AI_SCOPE_LIMIT') }),
  z.strictObject({ kind: z.literal('unavailable'), errorCode: z.enum(['MODEL_UNAVAILABLE', 'AI_BUDGET_EXHAUSTED']), manualAction: z.literal('continue_manually') }),
]);
export type ModelResult = z.infer<typeof modelResultSchema>;
export interface ModelAdapter { respond(input: { text: string; locale: z.infer<typeof localeSchema> }): Promise<ModelResult> }
export type MockScenario = 'success' | 'ambiguous' | 'timeout' | 'invalid' | 'budget' | 'injection';
const answers = { en: ['This is a preview response.', 'Which record do you mean?'], 'zh-Hans': ['这是一条预览回复。', '你指的是哪条记录？'], 'zh-Hant': ['這是一則預覽回覆。', '你指的是哪筆紀錄？'] };
export function mockModel(scenario: MockScenario): ModelAdapter {
  return { async respond(input) {
    const locale = localeSchema.parse(input.locale);
    z.string().max(8000).parse(input.text);
    let result: unknown;
    switch (scenario) {
      case 'success': result = { kind: 'answer', text: answers[locale][0], evidence: [] }; break;
      case 'ambiguous': result = { kind: 'clarification', question: answers[locale][1] }; break;
      case 'injection': result = { kind: 'unsupported', messageCode: 'AI_SCOPE_LIMIT' }; break;
      case 'budget': result = { kind: 'unavailable', errorCode: 'AI_BUDGET_EXHAUSTED', manualAction: 'continue_manually' }; break;
      case 'timeout': result = { kind: 'unavailable', errorCode: 'MODEL_UNAVAILABLE', manualAction: 'continue_manually' }; break;
      case 'invalid': result = { kind: 'executed', ownerId: 'forged' }; break;
    }
    return modelResultSchema.parse(result);
  } };
}
