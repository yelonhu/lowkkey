import { z } from 'zod';
export { LB_PER_KG, PROTOCOL_VERSION } from './constants.ts';
export const Id = z.string().min(1).max(64);
export const LocalDate = z.iso.date();
export type LocalDate = z.infer<typeof LocalDate>;
export const Instant = z.iso.datetime({ offset: true });
export const Unit = z.enum(['lb', 'kg']);
export type Unit = z.infer<typeof Unit>;
