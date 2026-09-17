import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { root } from './environment.mjs';
const directory = '.artifacts/file-audit';
const filename = `${directory}/fs-usage.txt`;
const threads = new Map();
const matchThread = line => /\s([^\s]+)\.(\d+)\s*$/.exec(line);
const tool = name => /^(node|workerd|curl|tar|shasum|chrome)/i.test(name);
const normalize = path => path.replace(/^\/System\/Volumes\/Data(?=\/)/, '');
const digest = createHash('sha256');
for await (const chunk of createReadStream(filename)) digest.update(chunk);
// Per macOS fs_usage(1), -w appends a THREAD id, not a process id.
// Physical disk events may bypass its executable filters. Exclude unrelated
// threads and normalize the APFS Data-volume alias before reviewing paths.
for await (const line of createInterface({ input: createReadStream(filename), crlfDelay: Infinity })) {
  const match = matchThread(line);
  if (match && tool(match[1]) && line.includes(root + '/')) threads.set(match[2], match[1]);
}
const output = createWriteStream(`${directory}/project-filesystem.txt`);
const writes = createWriteStream(`${directory}/project-writes.txt`);
let retained = 0, writeLines = 0, firstEvent, lastEvent;
const deniedOutside = [], unresolvedOutside = [];
const operation = /\s(?:write(?:v|_nocancel)?|pwrite(?:v)?|WrData\[[AS]\]|mkdir|mkdirat|rename|unlink|rmdir|truncate|ftruncate|symlink|chmod|fchmod|chown|fchown|setxattr|removexattr)\s|\bopen\s.*\([RW_]*[WCT][A-Z_]*\)/;
for await (const line of createInterface({ input: createReadStream(filename), crlfDelay: Infinity })) {
  const match = matchThread(line);
  if (!match || !threads.has(match[2])) continue;
  retained++; firstEvent ??= line.slice(0, 15); lastEvent = line.slice(0, 15);
  if (!output.write(line + '\n')) await once(output, 'drain');
  if (!operation.test(line)) continue;
  writeLines++;
  if (!writes.write(line + '\n')) await once(writes, 'drain');
  const paths = [...line.replace(/\/dev\/disk\S+\s+/g, '').matchAll(/(?:^|\s)(\/[^\s].*?)(?=\s{2,}|$)/g)].map(match => normalize(match[1]));
  const external = paths.filter(path => path !== root && !path.startsWith(root + '/') && !/^\/dev\/(?:disk\S*|null|tty|stdout|stderr)$/.test(path));
  if (external.length) (/\[\s*(?:1|13)\]/.test(line) ? deniedOutside : unresolvedOutside).push(line);
}
await Promise.all([new Promise(resolve => output.end(resolve)), new Promise(resolve => writes.end(resolve))]);
const commands = readFileSync('.artifacts/clean-room/.logs/processes.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line));
const report = { at: new Date().toISOString(), rawSha256: digest.digest('hex'), firstEvent, lastEvent, retained, writeLines, threadCount: threads.size, executableNames: [...new Set(threads.values())], commands, deniedOutside, unresolvedOutside,
  coverageMethod: 'Thread IDs are not PIDs. Review executable names, project path references and trace time coverage against launcher command times; kernel write restrictions are inherited by all children.',
  status: 'requires-evidence-review-not-automatic-pass' };
writeFileSync(`${directory}/summary.json`, JSON.stringify(report, null, 2));
console.log({ retained, writeLines, threads: threads.size, deniedOutside: deniedOutside.length, unresolvedOutside: unresolvedOutside.length });
