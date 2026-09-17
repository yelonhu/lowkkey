import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { uuidSchema } from '../src/domain/primitives.ts';

export function localRestoreEpoch() {
  const filename = '.local/state/restore-epoch';
  try { return uuidSchema.parse(readFileSync(filename, 'utf8').trim()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const epoch = randomUUID();
  try { writeFileSync(filename, epoch + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return uuidSchema.parse(readFileSync(filename, 'utf8').trim());
}
