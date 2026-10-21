import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { seedShowroom, fixtureToday, fixtureWeek, fixtureSessions } from '../scripts/rehearsal/fixtures.mjs';
import { rehearsalClient } from '../scripts/rehearsal/client.mjs';
const origin = process.env.LOWKKEY_TEST_ORIGIN ?? 'http://127.0.0.1:5174';
const client = await rehearsalClient(Number(new URL(origin).port), ['read', 'write', 'notes:write']);
const tools = await client.rpc('tools/list', {});
assert.deepEqual(tools.tools.map(t => t.name).sort(), [
  'curate',
  'delete',
  'get_brief',
  'log_session',
  'log_weight',
  'read_notes',
  'set_plan',
  'set_profile',
  'write_note',
]);
const prompts = await client.rpc('prompts/list', {});
assert.deepEqual(prompts.prompts.map(p => p.name).sort(), ['log_today', 'start', 'weekly_letter']);
const prompted = await client.rpc('prompts/get', { name: 'log_today', arguments: { text: '卧推 95 × 8' } });
assert.ok(prompted.messages[0].content.text.includes('卧推 95 × 8'));
const contract = JSON.parse(await readFile('docs/lowkkey-handoff/protocol/mcp-tools.json', 'utf8'));
for (const declared of contract.tools) {
  const actual = tools.tools.find(t => t.name === declared.name);
  assert.deepEqual(actual.inputSchema.properties, declared.inputSchema.properties, declared.name + ' input');
  assert.deepEqual(actual.outputSchema.properties, declared.outputSchema.properties, declared.name + ' output');
  assert.deepEqual(actual.annotations, declared.annotations);
  assert.deepEqual(actual.securitySchemes, [
    {
      type: 'oauth2',
      scopes:
        declared.name === 'write_note'
          ? ['read', 'notes:write']
          : [['get_brief', 'read_notes'].includes(declared.name) ? 'read' : 'write'],
    },
  ]);
}
assert.match(client.consentHtml, /name="scope" value="notes:write"\s*>/);
const legacy = await rehearsalClient(Number(new URL(origin).port), ['read', 'write']);
assert.equal((await legacy.rpc('tools/list', {})).tools.length, 8);
assert.equal(
  (
    await legacy.rpc('tools/call', {
      name: 'write_note',
      arguments: { date: '2026-10-08', text: 'forbidden', revision: 0 },
    })
  ).isError,
  true,
);
const before = await client.tool('get_brief', {});
assert.equal(before.sessions.length, 0);
const first = await client.tool('log_weight', { date: fixtureToday, lb: 160 });
assert.deepEqual(await client.tool('log_weight', { date: fixtureToday, lb: 160 }), first);
await seedShowroom(client.tool);
const brief = await client.tool('get_brief', {});
assert.equal(brief.weight.mean7.n, 7);
assert.equal(brief.sessions.length, 6);
assert.equal(brief.guide.stage, 'active');
assert.ok(Array.isArray(brief.guide.missing));
assert.equal(brief.guide.week.start, fixtureWeek);
assert.equal(brief.curation.current.week, fixtureWeek);
assert.ok(brief.generated_at);
const receipt = await client.rpc('tools/call', { name: 'log_session', arguments: fixtureSessions.at(-1) });
assert.equal(receipt.structuredContent.view_url, origin + '/#log?date=' + fixtureToday);
assert.deepEqual(JSON.parse(receipt.content[0].text), receipt.structuredContent);
assert.equal((await client.tool('get_brief', { sessions: 0 })).sessions.length, 0);
await client.tool('set_profile', { body_notes: null });
assert.equal((await client.tool('get_brief', {})).profile.body_notes, null);
await client.tool('curate', { week: fixtureWeek, recap: { title: '更新后的标题' } });
assert.equal((await client.tool('get_brief', {})).curation.current.recap.letter.length, 2);
const removed = await client.tool('delete', { kind: 'session', date: fixtureToday });
assert.equal(removed.deleted.date, fixtureToday);
assert.equal(
  (await client.rpc('tools/call', { name: 'delete', arguments: { kind: 'session', date: fixtureToday } })).isError,
  true,
);
const forbidden = await client.rpc('tools/call', {
  name: 'log_session',
  arguments: { ...fixtureSessions[0], raw_text: 'old' },
});
assert.equal(forbidden.isError, true);
assert.equal(forbidden.structuredContent.result.error.code, 'invalid_arguments');
assert.ok(forbidden.structuredContent.result.error.fields.length);
const invalid = await client.rpc('tools/call', { name: 'log_weight', arguments: { date: '2026-02-30', lb: 160 } });
assert.equal(invalid.isError, true);
const readonly = await rehearsalClient(Number(new URL(origin).port), ['read']);
assert.deepEqual(
  (await readonly.rpc('tools/list', {})).tools.map(t => t.name),
  ['get_brief', 'read_notes'],
);
assert.equal((await readonly.rpc('prompts/list', {})).prompts.length, 3);
await client.user('/v1/notes/2026-10-08', { text: '原文\n  135lb × 8 🙂', revision: 0 }, 'PUT');
assert.equal((await readonly.tool('read_notes', {})).notes[0].text, '原文\n  135lb × 8 🙂');
assert.equal((await readonly.tool('get_brief', {})).notes.count, 1);
const dated = (await client.tool('read_notes', { date: '2026-10-08' })).notes[0];
const appended = await client.tool('write_note', {
  date: dated.date,
  text: dated.text + '\n明确请求的转录',
  revision: dated.revision,
});
assert.equal(appended.revision, dated.revision + 1);
assert.deepEqual(
  await client.tool('write_note', { date: dated.date, text: appended.text, revision: dated.revision }),
  appended,
);
assert.equal(
  (
    await client.rpc('tools/call', {
      name: 'write_note',
      arguments: { date: dated.date, text: 'stale', revision: dated.revision },
    })
  ).structuredContent.result.error.code,
  'note_conflict',
);
assert.equal((await client.user('/v1/notes/' + dated.date, undefined, 'GET')).text, appended.text);
const cleared = await client.tool('write_note', { date: dated.date, text: '', revision: appended.revision });
assert.equal((await client.tool('read_notes', { date: dated.date })).notes[0].revision, cleared.revision);
assert.equal(
  (
    await client.rpc('tools/call', {
      name: 'write_note',
      arguments: { date: dated.date, text: 'stale resurrection', revision: 0 },
    })
  ).isError,
  true,
);
assert.equal(
  (await client.rpc('tools/call', { name: 'read_notes', arguments: { date: dated.date, limit: 1 } })).isError,
  true,
);
const renewed = await fetch(origin + '/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: client.registered.client_id,
    refresh_token: client.token.refresh_token,
    resource: origin + '/mcp',
  }),
});
assert.equal(renewed.ok, true);
const renewedToken = await renewed.json();
Object.assign(client.token, renewedToken);
client.headers.Authorization = 'Bearer ' + renewedToken.access_token;
assert.equal((await client.rpc('tools/list', {})).tools.length, 9);
const deniedWrite = await readonly.rpc('tools/call', {
  name: 'log_weight',
  arguments: { date: '2026-10-07', lb: 999 },
});
assert.equal(deniedWrite.isError, true);
assert.equal((await client.tool('get_brief', {})).weight.latest.lb, brief.weight.latest.lb);
for (const path of ['/v1/capture', '/v1/entries', '/v1/submissions/x/decision']) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: { Authorization: client.headers.Authorization, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 401);
}
const resources = await client.raw('resources/list', {});
const resourceReply = await resources.json();
assert.ok(resourceReply.error || !resourceReply.result?.resources?.length, 'no review resource');
const clients = await client.user('/v1/clients', undefined, 'GET');
for (const record of clients) await client.user('/v1/clients/' + record.id + '/revoke', {});
assert.equal((await client.raw('tools/list', {})).status, 401);
const refresh = await fetch(origin + '/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: client.registered.client_id,
    refresh_token: client.token.refresh_token,
    resource: origin + '/mcp',
  }),
});
assert.equal(refresh.ok, false);
console.log('Nine-tool OAuth/MCP end-to-end passed');
