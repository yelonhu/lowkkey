import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
export async function applyMigrations(db, directory = 'db/migrations') {
  await db.prepare('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)').run();
  const applied = [];
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    const previous = await db.prepare('SELECT sha256 FROM _migrations WHERE name = ?').bind(name).first();
    if (previous) { if (previous.sha256 !== sha256) throw new Error('Applied migration checksum changed'); continue; }
    const statements = sql.split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean);
    await db.batch([...statements.map(statement => db.prepare(statement)), db.prepare('INSERT INTO _migrations (name,sha256) VALUES (?,?)').bind(name, sha256)]);
    applied.push(name);
  }
  return applied;
}
