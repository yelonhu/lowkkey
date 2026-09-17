import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './environment.mjs';
const target = path.join(root, '.artifacts/clean-room');
if (existsSync(target)) throw new Error('Clean room already exists; retain its evidence and choose a fresh checkout for another full audit.');
mkdirSync(target, { recursive: true });
const files = ['SPEC.md', '.gitignore', '.env.example', 'package.json', 'package-lock.json', 'tsconfig.json', 'eslint.config.mjs', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'drizzle.config.ts', 'wrangler.json', 'index.html', 'src', 'scripts', 'db', 'tests', 'public'];
for (const file of files) cpSync(path.join(root, file), path.join(target, file), { recursive: true });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
mkdirSync(path.join(target, '.artifacts'), { recursive: true });
writeFileSync(path.join(target, '.artifacts/baseline.json'), JSON.stringify({ createdAt: new Date().toISOString(), originalLockHash: hash(path.join(root, 'package-lock.json')), global: globalSnapshot() }, null, 2));
console.log('Prepared an empty runtime/dependency/data directory at .artifacts/clean-room.');
function globalSnapshot() {
  return Object.fromEntries(['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile', '.npmrc', '.gitconfig'].map(name => {
    const file = path.join(process.env.HOME, name);
    return [name, existsSync(file) ? { sha256: hash(file), mode: statSync(file).mode } : null];
  }));
}
