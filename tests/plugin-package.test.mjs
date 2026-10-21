import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDraft, validateConfig, materialize, scanText } from '../scripts/plugin-package.mjs';
const valid = {
  publisher: 'Review Fixture',
  origin: 'https://lowkkey-review-fixture.com',
  demoVideo: 'https://video-review-fixture.com/demo',
};
test('draft preserves OAuth, review cases and a self-contained onboarding skill', async () => {
  const draft = await readDraft();
  assert.equal(draft.plugin.extensions['com.openai'].review.test_cases.positive.length, 5);
  const ready = await materialize(valid);
  assert.equal(ready.mcp.mcpServers.lowkkey.url, valid.origin + '/mcp');
  assert.equal(ready.plugin.author.name, valid.publisher);
  assert.ok(!JSON.stringify(ready).includes('{{'));
});
test('packaging rejects missing identity, temporary URLs and credentials', () => {
  for (const publisher of ['', 'TODO', '{{publisher}}']) assert.throws(() => validateConfig({ ...valid, publisher }));
  for (const origin of [
    '',
    'http://lowkkey.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://example.com',
    'https://foo.example.org',
    'https://preview.local',
    'https://beta.workers.dev',
    'https://your-domain.com',
    'https://lowkkey.com/mcp',
    'https://user:password@lowkkey.com',
  ])
    assert.throws(() => validateConfig({ ...valid, origin }), origin);
  assert.throws(() => validateConfig({ ...valid, demoVideo: '' }));
  assert.throws(() => validateConfig({ ...valid, clientSecret: 'must-not-be-accepted' }));
  assert.throws(() => scanText('{"refresh_token":"secret"}'));
  assert.throws(() => scanText('-----BEGIN PRIVATE KEY-----'));
  assert.doesNotThrow(() => scanText('OAuth access is granted by the user.'));
});
