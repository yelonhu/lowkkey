import { LB_PER_KG, type LocalDate, type Unit } from '@lowkkey/protocol';
export const dayIndex = (date: LocalDate) => Date.parse(date + 'T00:00:00Z') / 86400000;
export const addDays = (date: LocalDate, days: number): LocalDate => new Date((dayIndex(date) + days) * 86400000).toISOString().slice(0, 10);
export const diffDays = (a: LocalDate, b: LocalDate) => dayIndex(a) - dayIndex(b);
export const toLb = (load: number, unit: Unit) => unit === 'kg' ? load * LB_PER_KG : load;
export const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
