import { decimalSchema, scaledSchema, unitSchema } from './primitives.ts';

function ratio(value: string): [bigint, bigint] {
  decimalSchema.parse(value);
  const [whole, fractional = ''] = value.split('.');
  return [BigInt(`${whole}${fractional}`), 10n ** BigInt(fractional.length)];
}
function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) throw new Error('UNSAFE_SCALED_NUMBER');
  return scaledSchema.parse(Number(value));
}
export function compareDecimal(left: string, right: string): -1 | 0 | 1 {
  const [a, b] = ratio(left), [c, d] = ratio(right);
  return a * d < c * b ? -1 : a * d > c * b ? 1 : 0;
}
export function compareDecimalProduct(value: string, bound: string, numerators: string[] = [], denominators: string[] = []): -1 | 0 | 1 {
  let [top, bottom] = ratio(value);
  for (const factor of numerators) { const [n, d] = ratio(factor); top *= n; bottom *= d; }
  for (const factor of denominators) { const [n, d] = ratio(factor); if (n === 0n) throw new Error('ZERO_DENOMINATOR'); top *= d; bottom *= n; }
  const [limit, divisor] = ratio(bound);
  return top * divisor < limit * bottom ? -1 : top * divisor > limit * bottom ? 1 : 0;
}
export function scaledDecimal(value: string, scale: bigint, rounding: 'half-up' | 'ceil' = 'half-up'): number {
  if (scale <= 0n) throw new Error('INVALID_SCALE');
  const [numerator, denominator] = ratio(value);
  const product = numerator * scale;
  return safe(rounding === 'ceil' ? (product + denominator - 1n) / denominator : (2n * product + denominator) / (2n * denominator));
}
/** Apply all portion factors before the single storage rounding boundary. */
export function scaledProduct(value: string, scale: bigint, numerators: string[] = [], denominators: string[] = []): number {
  if (scale <= 0n) throw new Error('INVALID_SCALE');
  let [top, bottom] = ratio(value);
  top *= scale;
  for (const factor of numerators) { const [n, d] = ratio(factor); top *= n; bottom *= d; }
  for (const factor of denominators) { const [n, d] = ratio(factor); if (n === 0n) throw new Error('ZERO_DENOMINATOR'); top *= d; bottom *= n; }
  return safe((2n * top + bottom) / (2n * bottom));
}
export function decimalFromScaled(value: number, places = 3): string {
  scaledSchema.parse(value);
  if (!Number.isInteger(places) || places < 0 || places > 12) throw new Error('INVALID_SCALE');
  const digits = String(value).padStart(places + 1, '0');
  return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}
export function sumScaled(values: number[]): number { return safe(values.reduce((total, value) => total + BigInt(scaledSchema.parse(value)), 0n)); }
/** Exact terminating decimal addition for the explicitly selected 4/4/9 estimate. */
export function sumDecimalProducts(terms: Array<{ value: string; coefficient: number }>): string {
  const decimals = terms.map(term => { decimalSchema.parse(term.value); if (!Number.isSafeInteger(term.coefficient) || term.coefficient < 0) throw new Error('INVALID_COEFFICIENT'); return { ...term, digits: term.value.split('.')[1]?.length ?? 0 }; });
  const places = Math.max(0, ...decimals.map(term => term.digits));
  const total = decimals.reduce((sum, term) => sum + BigInt(term.value.replace('.', '')) * BigInt(term.coefficient) * 10n ** BigInt(places - term.digits), 0n);
  const digits = String(total).padStart(places + 1, '0');
  return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}
export function normalizeMass(value: string, unit: 'kg' | 'lb', minKg = 0, maxKg = 1000) {
  unitSchema.parse(unit);
  const [raw, denominator] = ratio(value);
  const numerator = raw * (unit === 'lb' ? 45_359_237n : 100_000_000n);
  const divisor = denominator * 100_000_000n;
  if (numerator < BigInt(minKg) * divisor || numerator > BigInt(maxKg) * divisor) throw new Error('MASS_OUT_OF_RANGE');
  const kgMicros = safe((2n * numerator * 1_000_000n + divisor) / (2n * divisor));
  if (kgMicros < minKg * 1_000_000 || kgMicros > maxKg * 1_000_000) throw new Error('MASS_OUT_OF_RANGE');
  return { value, unit, kgMicros };
}
export function normalizeManualDecimal(input: string): string {
  const value = input.replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xff10)).replace(/．/g, '.').trim();
  return decimalSchema.parse(value);
}
