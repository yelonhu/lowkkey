import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const forbidden = ['VEYRA_CANARY_DEPLOY_SECRET', 'VEYRA_CANARY_MODEL_SECRET', 'synthetic-alice', 'DEVELOPMENT_IDENTITY_FORBIDDEN', 'test-only', 'lowkkey-local-fixture', 'local-member@example.invalid', 'lowkkey_local_session'];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(filename);
    else {
      const content = await readFile(filename, 'utf8');
      if (forbidden.some(token => content.includes(token))) throw new Error(`Unsafe build artifact: ${filename}`);
      if (filename.endsWith('.map') || /(?:^|\/)\.env/.test(filename)) throw new Error(`Unexpected build artifact: ${filename}`);
    }
  }
}
await scan('.artifacts/build');
console.log('Build scan passed: no secret canaries or test identity code.');
