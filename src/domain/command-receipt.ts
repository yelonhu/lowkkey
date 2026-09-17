import { z } from 'zod';
import { entityRefSchema } from './artifacts.ts';
import { scaledSchema, utcSchema, uuidSchema } from './primitives.ts';

export const commandReceiptSchema = z.strictObject({
  operationId: uuidSchema, dataRevision: scaledSchema, recordRefs: z.array(entityRefSchema).max(300),
  committedAt: utcSchema, undoAvailable: z.boolean(), result: z.record(z.string(), z.json()),
});
export type CommandReceipt = z.infer<typeof commandReceiptSchema>;
