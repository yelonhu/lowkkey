import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Vitest 5.0.1 unconditionally persists an API token, even with api/ui disabled.
// M0 only runs its CLI: keep the random per-process token in memory instead.
// A dependency upgrade must explicitly review this adapter; unknown bytes fail.
const directory = 'node_modules/vitest/dist/chunks';
const filename = `${directory}/index.DzobfTyw.js`;
const originalHash = '26c9c3d31efea8bb6e5f6f495db89968ba820a26c0676341f3682ec5377d584d';
const marker = '\t// VEYRA: CLI-only ephemeral API token; see docs/M0.md.\n\treturn { token: crypto.randomUUID(), tokenCreated: false };\n';
const original = 'function resolveApiToken(root) {\n\tconst tokenPaths = [join(getUserDataDir(), "vitest", API_TOKEN_FILE), join(searchForWorkspaceRoot(root), "node_modules/.vitest", API_TOKEN_FILE)];\n\tfor (const tokenPath of tokenPaths) try {\n\t\treturn {\n\t\t\t...resolveTokenFromPath(tokenPath),\n\t\t\ttokenPath\n\t\t};\n\t} catch {}\n\tthrow new Error(`Failed to create Vitest API token at ${tokenPaths.join(" or ")}`);\n}';
const replacement = `function resolveApiToken(root) {\n${marker}}`;
const version = JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version;
if (version !== '5.0.1' || !readdirSync(directory).includes('index.DzobfTyw.js')) throw new Error('Vitest adapter requires explicit review for this version');
const source = readFileSync(filename, 'utf8');
const unpatched = source.includes(marker) ? source.replace(replacement, original) : source;
if (createHash('sha256').update(unpatched).digest('hex') !== originalHash || !unpatched.includes(original)) throw new Error('Vitest adapter checksum mismatch');
if (source === unpatched) writeFileSync(filename, source.replace(original, replacement));
// Remove only the obsolete project-local token made before this adaptation.
const legacyToken = 'node_modules/.vitest/.vitest-secret-token';
if (existsSync(legacyToken)) unlinkSync(legacyToken);
console.log('Verified Vitest CLI token adapter (version and source checksum).');
