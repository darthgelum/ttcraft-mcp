import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Auth } from '../dist/auth.js';
import { fixture } from './fixture.mjs';

let mock, temp, client, transport;
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { ...JSON.parse(result.content[0].text), isError: result.isError || false };
};
before(async () => {
  mock = await fixture(); temp = await mkdtemp(join(tmpdir(), 'ttcraft-mcp-test-'));
  transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')],
    env: { ...process.env, TTCRAFT_URL: mock.baseUrl, TTCRAFT_CONFIG_DIR: temp, TTCRAFT_TOKEN: 'private-dev-token' }, stderr: 'pipe' });
  client = new Client({ name: 'ttcraft-mcp-test', version: '1.0' });
  await client.connect(transport);
});
after(async () => { await client?.close(); await mock?.close(); if (temp) await rm(temp, { recursive: true, force: true }); });

test('stdio initialization, discovery, documentation resources and prompts', async () => {
  const listed = await client.listTools();
  assert.ok(listed.tools.length >= 30);
  assert.ok(listed.tools.some(t => t.name === 'blueprint_apply'));
  assert.equal(listed.tools.find(t => t.name === 'objects_remove').annotations.destructiveHint, true);
  assert.ok((await client.listResources()).resources.some(r => r.uri === 'ttcraft://guide'));
  assert.match((await client.readResource({ uri: 'ttcraft://docs/table-plan' })).contents[0].text, /metres/);
  assert.ok((await client.listPrompts()).prompts.some(p => p.name === 'build-table'));
  const docs = await call('docs_search', { query: 'Table.set' }); assert.equal(docs.isError, false);
  const read = await call('docs_read', { slug: 'table-plan', max_characters: 300 }); assert.equal(read.text.length, 300); assert.equal(read.next_offset, 300);
});
test('identity, explicit table selection and authoritative positions', async () => {
  assert.equal((await call('auth_status')).user.username, 'тест');
  assert.equal((await call('objects_list')).isError, true);
  assert.equal((await call('tables_list')).tables[0].id, 42);
  assert.equal((await call('table_connect', { table_id: 42 })).connected, true);
  const objects = await call('objects_list');
  assert.equal(objects.objects[0].guid, 'guid-one');
  assert.deepEqual(objects.objects[0].position, [0.1, 0.02, -0.2]);
  const read = await call('object_read', { object: 'guid-one', refresh: true });
  assert.equal(JSON.parse(read.text).guid, 'guid-one');
  const section = await call('state_read', { section: 'zones' }); assert.equal(section.isError, false);
});
test('concurrent script reads are serialized despite replies without requestId', async () => {
  const [global, object] = await Promise.all([
    call('script_read'), call('script_read', { target: 'object', object: 'guid-one' }),
  ]);
  assert.match(global.text, /onLoad/); assert.equal(object.text, '-- chip');
  const mismatch = await call('script_write', { code: '-- unsafe overwrite', expected_sha256: '0'.repeat(64) });
  assert.equal(mismatch.isError, true); assert.match(mismatch.error, /changed/);
  const saved = await call('script_write', { code: '-- updated', expected_sha256: global.sha256 }); assert.equal(saved.isError, false);
  const failed = await call('script_write', { code: 'syntaxerror' }); assert.equal(failed.isError, true); assert.match(failed.error, /syntax error/);
  assert.equal((await call('script_read')).text, '-- updated');
  assert.ok((await call('console_read')).events.length >= 2);
});
test('server refusals and commands without acknowledgement are distinguished', async () => {
  const denied = await call('table_command', { command: 'setperms', arguments: { player: 1, caps: 'owner' } });
  assert.equal(denied.isError, true); assert.match(denied.error, /noPermission/);
  assert.equal((await call('table_command', { command: 'chat', arguments: { text: 'not sent' } })).isError, true);
  const move = await call('objects_move', { object: 'guid-one', position: [0.3, 0.1, 0.2] });
  assert.equal(move.status, 'processed_unverified');
  assert.deepEqual((await call('objects_list')).objects[0].position, [0.3, 0.1, 0.2]);
  assert.equal((await call('table_command', { command: 'containerlist', arguments: { id: 1 } })).response.type, 'contlist');
  assert.equal((await call('table_save', { name: 'Backup' })).response.type, 'tablesaved');
});
test('library patch preserves fields, and native spawning/removal update the binary state', async () => {
  const created = await call('library_save', { spec: { name: 'Custom', category: 'Test', kind: 'chip', script: '-- template' } });
  const id = created.response.id;
  assert.equal((await call('library_save', { id, spec: { name: 'Renamed' } })).isError, false);
  const item = mock.templates.find(t => t.id === id); assert.equal(item.script, '-- template'); assert.equal(item.category, 'Test');
  assert.equal((await call('script_read', { target: 'template', template_id: id })).text, '-- template');
  const spawned = await call('objects_spawn', { spec: { kind: 'chip', label: 'Extra' }, position: [0, 0.2, 0] });
  assert.equal(spawned.observed_new_objects.length, 1);
  const guid = spawned.observed_new_objects[0].guid;
  assert.equal((await call('objects_remove', { objects: [guid] })).isError, false);
  assert.equal((await call('objects_list', { query: guid })).total, 0);
});
test('blueprint dry run, tracked repeat builds and locked-object updates do not duplicate', async () => {
  const blueprint = { id: 'demo', plan: { seats: { count: 4 } }, templates: [{ key: 'token', spec: { kind: 'chip', name: 'Demo token', category: 'Demo' } }],
    objects: [{ key: 'red', template: '$token', name: 'Red token', position: [0.4, 0.1, 0], locked: true, script: '-- red' }] };
  const before = mock.objects.size;
  assert.equal((await call('blueprint_apply', { blueprint })).dry_run, true);
  assert.equal(mock.objects.size, before);
  const first = await call('blueprint_apply', { blueprint, dry_run: false });
  assert.equal(first.isError, false, JSON.stringify(first));
  assert.equal(mock.objects.size, before + 1);
  const id = first.completed.find(c => c.key === 'red').id;
  const templateCount = mock.templates.length;
  blueprint.objects[0].position = [0.6, 0.1, 0];
  const again = await call('blueprint_apply', { blueprint, dry_run: false }); assert.equal(again.isError, false, JSON.stringify(again));
  assert.equal(mock.objects.size, before + 1); assert.equal(mock.templates.length, templateCount);
  assert.deepEqual(mock.objects.get(id).position, [0.6, 0.1, 0]); assert.equal(mock.objects.get(id).locked, true);
  const invalid = { ...blueprint, objects: [...blueprint.objects, blueprint.objects[0]] };
  const calls = mock.calls.length;
  assert.equal((await call('blueprint_apply', { blueprint: invalid, dry_run: false })).isError, true);
  assert.equal(mock.calls.length, calls);
});
test('batch dry run and partial failure stop without replaying later commands', async () => {
  const commands = [{ command: 'setperms', arguments: {} }, { command: 'spawn', arguments: { kind: 'chip' } }];
  assert.equal((await call('batch_execute', { commands })).dry_run, true);
  const before = mock.objects.size;
  const applied = await call('batch_execute', { commands, dry_run: false });
  assert.equal(applied.isError, true); assert.equal(applied.completed, 1); assert.equal(mock.objects.size, before);
});
test('simultaneous blueprint applications serialize and reload persisted identities', async () => {
  const blueprint = { id: 'parallel', objects: [{ key: 'one', name: 'Parallel token', spec: { kind: 'chip' }, position: [0, 0.1, 0], locked: true }] };
  const before = mock.objects.size;
  const replies = await Promise.all([call('blueprint_apply', { blueprint, dry_run: false }), call('blueprint_apply', { blueprint, dry_run: false })]);
  for (const reply of replies) assert.equal(reply.isError, false, JSON.stringify(reply));
  assert.equal(mock.objects.size, before + 1);
  const path = replies[0].index_path;
  await writeFile(path + '.lock', JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const locked = await call('blueprint_apply', { blueprint, dry_run: false });
    assert.equal(locked.isError, true); assert.match(locked.error, /locked by another build/);
    assert.equal(mock.objects.size, before + 1);
  } finally { await rm(path + '.lock'); }
});
test('chunked local uploads, export protection, archive and additive module imports', async () => {
  const image = join(temp, 'image.png'), zip = join(temp, 'backup.zip');
  await writeFile(image, Buffer.from('test-image-bytes'));
  const uploaded = await call('asset_upload', { file_path: image }); assert.equal(uploaded.path, 'library/assets/mock.png');
  assert.equal(mock.uploads.get('1').toString(), 'test-image-bytes');
  const assets = await call('assets_list'); assert.equal(assets.total, 1);
  const exported = await call('archives_export', { output_path: zip }); assert.equal(exported.bytes, 8);
  assert.equal((await call('archives_export', { output_path: zip })).isError, true);
  assert.equal((await call('archives_import', { file_path: zip })).isError, false);
  assert.equal(mock.zipBytes.length, 8);
  assert.equal((await call('modules_import', { packages: [{ path: zip }] })).packages, 1);
  for (const req of mock.calls.filter(c => c.kind === 'http' && ['/upload', '/blob.chunk', '/export.zip', '/import.zip'].includes(c.path))) {
    assert.equal(req.auth, 'Bearer short-token'); assert.equal('token' in req.query, false);
  }
});
test('EOF shuts down server sockets cleanly; credentials never appear in protocol results', async () => {
  const state = await call('connections_status'); assert.equal(JSON.stringify(state).includes('short-token'), false);
  assert.equal(JSON.stringify(state).includes('private-dev-token'), false);
  assert.equal((await call('table_disconnect')).isError, false);
});
test('a timeout drops the connection, prevents stale reply reuse, and never replays the command', async () => {
  await call('table_connect', { table_id: 42 });
  const before = mock.calls.filter(c => c.kind === 'ws' && c.type === 'getglobalscript').length;
  const timed = await call('table_command', { command: 'getglobalscript', response_type: 'never-arrives', timeout_ms: 1000 });
  assert.equal(timed.isError, true); assert.match(timed.error, /timed out/);
  assert.equal((await call('objects_list')).isError, true);
  assert.equal(mock.calls.filter(c => c.kind === 'ws' && c.type === 'getglobalscript').length, before + 1);
  assert.equal((await call('table_reconnect', { table_id: 42 })).connected, true);
  assert.equal((await call('script_read')).text, '-- updated');
});
test('device sign-in pacing, private credential persistence and origin isolation', async () => {
  const authDir = join(temp, 'auth');
  const config = { baseUrl: mock.baseUrl, configDir: authDir };
  const auth = new Auth(config);
  const start = await auth.begin(); assert.equal(start.user_code, 'ABCD-EFGH');
  assert.equal(JSON.stringify(start).includes('private-device-code'), false);
  const before = mock.polls;
  assert.equal((await auth.poll()).status, 'authorization_pending'); assert.equal(mock.polls, before);
  await delay(2050); assert.equal((await auth.poll()).status, 'authorization_pending'); assert.equal(mock.polls, before + 1);
  mock.approve(); await delay(2050);
  const logged = await auth.poll(); assert.equal(logged.status, 'signed_in'); assert.equal(logged.user.username, 'тест');
  const stored = await readFile(join(authDir, (await readdir(authDir))[0]), 'utf8');
  if (process.platform === 'win32') { assert.equal(stored.includes('private-dev-token'), false); assert.equal(JSON.parse(stored).protection, 'dpapi'); }
  const restored = new Auth(config); assert.equal((await restored.status()).user.username, 'тест');
  const isolated = new Auth({ ...config, baseUrl: 'http://localhost:9999' }); assert.equal((await isolated.status()).status, 'signed_out');
  await restored.logout(); assert.equal((await restored.status()).status, 'signed_out');
});
