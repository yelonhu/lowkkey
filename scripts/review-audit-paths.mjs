import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { root } from './environment.mjs';
const report = JSON.parse(readFileSync('.artifacts/file-audit/summary.json', 'utf8'));
const inventory = [];
function collect(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const filename = `${directory}/${item.name}`;
    inventory.push(filename);
    if (item.isDirectory()) collect(filename);
  }
}
collect(`${root}/.artifacts/clean-room`);
const reviewed = report.unresolvedOutside.map(line => {
  const paths = [...line.replace(/\/dev\/disk\S+\s+/g, '').matchAll(/(?:^|\s)(\/[^\s].*?)(?=\s{2,}|$)/g)].map(match => match[1]);
  return { line, paths: paths.map(path => {
    const candidates = inventory.filter(filename => filename.endsWith(path) || `/System/Volumes/Data${filename}`.endsWith(path));
    // Deleted Playwright traces no longer appear in the final inventory. Their
    // retained project suffix identifies the original in-project location.
    const anchor = '/.artifacts/clean-room/';
    const position = path.indexOf(anchor);
    const prefix = position > -1 ? path.slice(0, position) : null;
    const knownPrefix = prefix !== null && (root.endsWith(prefix) || `/System/Volumes/Data${root}`.endsWith(prefix));
    return { displayedPath: path, candidates, projectSuffixPath: knownPrefix ? root + path.slice(position) : null };
  }) };
});
const unresolved = reviewed.filter(entry => entry.paths.some(path => !path.candidates.length && !path.projectSuffixPath));
writeFileSync('.artifacts/file-audit/path-review.json', JSON.stringify({ at: new Date().toISOString(), inventoryEntries: inventory.length, reviewed, unresolved,
  method: 'Resolve fs_usage wide-mode left-truncated suffixes against the project inventory and retained clean-room prefix. Review alongside inherited kernel write denial; these are not literal root-level paths.' }, null, 2));
console.log({ reviewed: reviewed.length, unresolved: unresolved.length, unresolvedExamples: unresolved.slice(0, 10) });
if (unresolved.length) process.exit(1);
