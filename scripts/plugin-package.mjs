import { readFile, mkdir, mkdtemp, writeFile, copyFile, rename, rm, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const draft = resolve(root, 'plugins/lowkkey');
const placeholders = /\{\{(?:publisher|origin|demoVideo)\}\}/g;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function publicURL(value) {
  assert(typeof value === 'string' && value.trim() === value, 'A public HTTPS URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A public HTTPS URL is required');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  assert(
    url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && !url.search,
    'Use HTTPS without credentials, ports, queries or fragments',
  );
  assert(
    host.includes('.') &&
      !isIP(host) &&
      !host.includes(':') &&
      !/(^|\.)(localhost|local|internal|test|invalid|example|example\.com|example\.org|example\.net)$/.test(host),
    'Use a real public domain, not a local or placeholder address',
  );
  assert(!/\b(todo|replace|your-domain|yourdomain|placeholder)\b/i.test(host), 'Replace placeholder domains');
  return url;
}
export function validateConfig(config) {
  assert(config && typeof config === 'object' && !Array.isArray(config), 'Configuration must be an object');
  assert(
    Object.keys(config).sort().join(',') === 'demoVideo,origin,publisher',
    'Only publisher, origin and demoVideo are accepted; never supply secrets',
  );
  assert(
    typeof config.publisher === 'string' &&
      config.publisher.trim() === config.publisher &&
      config.publisher.length >= 2 &&
      config.publisher.length <= 80 &&
      !/[{}<>\n\r]/.test(config.publisher) &&
      !/\b(todo|unknown|placeholder|your name|publisher)\b/i.test(config.publisher),
    'Set the confirmed individual publisher name',
  );
  const origin = publicURL(config.origin);
  assert(
    origin.pathname === '/' && !origin.hostname.endsWith('.workers.dev'),
    'Set the confirmed independent origin before packaging',
  );
  publicURL(config.demoVideo);
  return { ...config, origin: origin.origin };
}
export function scanText(text) {
  assert(
    !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\bAIza[A-Za-z0-9_-]{25,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"(?:clientSecret|client_secret|access_token|refresh_token|headers|test_credentials|reviewer_instructions)"\s*:/i.test(
      text,
    ),
    'Secret or forbidden credential field found',
  );
}
export async function readDraft() {
  const plugin = JSON.parse(await readFile(resolve(draft, 'plugin.template.json'), 'utf8'));
  const mcp = JSON.parse(await readFile(resolve(draft, 'mcp.template.json'), 'utf8'));
  const skill = await readFile(resolve(draft, 'skills/lowkkey-start/SKILL.md'), 'utf8');
  const ext = plugin.extensions['com.openai'];
  assert(plugin.name === 'lowkkey' && /^\d+\.\d+\.\d+$/.test(plugin.version), 'Invalid package identity');
  assert(
    ext.interface.shortDescription.length <= 30 && ext.interface.longDescription.length <= 4000,
    'Listing exceeds limits',
  );
  assert(
    ext.review.test_cases.positive.length === 5 && ext.review.test_cases.negative.length === 3,
    'Review needs five positive and three negative cases',
  );
  assert(
    ext.review.test_cases.positive.every(c => c.prompt && c.description && c.tools_triggered && c.expected_behavior) &&
      ext.review.test_cases.negative.every(c => c.prompt && c.description),
    'Incomplete review cases',
  );
  assert(
    Object.keys(mcp.mcpServers).join(',') === 'lowkkey' && mcp.mcpServers.lowkkey.type === 'streamable-http',
    'One remote MCP server is required',
  );
  const auth = mcp.mcpServers.lowkkey.extensions['com.openai'].auth;
  assert(
    auth.type === 'oauth' &&
      auth.client.mode === 'dcr' &&
      auth.baseScopes.join(' ') === 'read' &&
      auth.defaultScopes.join(' ') === 'read write notes:write',
    'Keep OAuth scopes aligned with the existing consent screen',
  );
  assert(
    ext.onboardingSkill === './skills/lowkkey-start/SKILL.md' && ext.interface.logo === './assets/icon.png',
    'Unexpected packaged reference',
  );
  assert(/^---\nname: lowkkey-start\ndescription: .+\n---\n/.test(skill), 'Invalid skill frontmatter');
  for (const text of [JSON.stringify(plugin), JSON.stringify(mcp), skill]) scanText(text);
  assert((await lstat(resolve(root, 'public/icon-512.png'))).isFile(), 'Icon must be a regular file');
  return { plugin, mcp, skill };
}
export async function materialize(config) {
  const values = validateConfig(config),
    source = await readDraft();
  const replace = value => {
    if (typeof value === 'string') return value.replace(placeholders, token => values[token.slice(2, -2)]);
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
    return value;
  };
  const result = { plugin: replace(source.plugin), mcp: replace(source.mcp), skill: source.skill };
  scanText(JSON.stringify(result));
  assert(!JSON.stringify(result).includes('{{'), 'Unresolved template values');
  return result;
}
async function main() {
  if (process.argv[2] === '--check-draft' && process.argv.length === 3) {
    await readDraft();
    console.log(
      'Draft structure and credential-pattern checks passed. Publisher, domain, video and reviewer access still pending.',
    );
    return;
  }
  assert(process.argv.length === 3, 'Usage: plugin-package.mjs --check-draft | <config.json>');
  const bundle = await materialize(JSON.parse(await readFile(resolve(process.argv[2]), 'utf8')));
  const artifacts = resolve(root, '.artifacts');
  await mkdir(artifacts, { recursive: true });
  const staging = await mkdtemp(resolve(artifacts, 'plugin-stage-'));
  try {
    const folder = resolve(staging, 'package');
    await mkdir(resolve(folder, 'assets'), { recursive: true });
    await mkdir(resolve(folder, 'skills/lowkkey-start'), { recursive: true });
    await writeFile(resolve(folder, 'plugin.json'), JSON.stringify(bundle.plugin, null, 2) + '\n');
    await writeFile(resolve(folder, 'mcp.json'), JSON.stringify(bundle.mcp, null, 2) + '\n');
    await writeFile(resolve(folder, 'skills/lowkkey-start/SKILL.md'), bundle.skill);
    await copyFile(resolve(root, 'public/icon-512.png'), resolve(folder, 'assets/icon.png'));
    // Explicit allowlist: never recursively archive the repository or private config.
    execFileSync(
      '/usr/bin/zip',
      [
        '-q',
        resolve(staging, 'plugin.zip'),
        'plugin.json',
        'mcp.json',
        'assets/icon.png',
        'skills/lowkkey-start/SKILL.md',
      ],
      { cwd: folder },
    );
    const output = resolve(artifacts, 'lowkkey-plugin.zip');
    await rename(resolve(staging, 'plugin.zip'), output);
    console.log(output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
