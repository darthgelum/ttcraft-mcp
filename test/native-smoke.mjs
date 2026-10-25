// Optional integration against a real compiled tableweb server. Runs only in a
// new temporary game directory on isolated ports; never touches a live table.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const binary = process.argv[2] || process.env.TTCRAFT_TABLEWEB_BINARY;
const repo = resolve(process.argv[3] || '../../tableweb');
if (!binary) throw new Error('Usage: npm run test:native -- <absolute tableweb-server executable> [tableweb repo]');
const temp = await mkdtemp(join(tmpdir(), 'ttcraft-mcp-native-'));
const port = Number(process.env.TTCRAFT_TEST_PORT || 19077);
if (port === 9001 || port === 9002) throw new Error('Refusing development server ports.');
// Reserve-check both ports. The actual native server owns them after launch.
for (const p of [port, port + 1]) await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.on('error', reject); probe.listen(p, '127.0.0.1', () => probe.close(resolve));
});
let native, client, site, output = '';
try {
  await mkdir(join(temp, 'library')); await mkdir(join(temp, 'tmp'));
  await cp(join(repo, 'games'), join(temp, 'games'), { recursive: true });
  await copyFile(join(repo, 'system.lua'), join(temp, 'system.lua'));
  native = spawn(resolve(binary), [], { cwd: temp, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, TABLEWEB_PORT: String(port), TABLEWEB_WS_PORT: String(port + 1), TABLEWEB_AUTH_SECRET: '',
    TTCRAFT_S2S_URL: '', TTCRAFT_S2S_TOKEN: '', TEMP: join(temp, 'tmp'), TMP: join(temp, 'tmp'), TMPDIR: join(temp, 'tmp'),
  } });
  native.on('error', e => { output += e.message; });
  native.stdout.on('data', b => { output += b; }); native.stderr.on('data', b => { output += b; });
  for (let i = 0; i < 200 && !output.includes('listening on http'); i++) { if (native.exitCode !== null) break; await delay(50); }
  assert.ok(output.includes('listening on http'), output);
  site = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/connect')) return res.end(JSON.stringify({ table_id: 42, token: '', caps: 'owner', connection_kind: 'tool', ws_url: `ws://127.0.0.1:${port + 1}/ws`, http_url: `http://127.0.0.1:${port}`, expires_in: 120 }));
    res.end(JSON.stringify({ user: { id: 1, username: 'Native test' }, tables: [{ id: 42, running: true }] }));
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], env: {
    ...process.env, TTCRAFT_URL: `http://127.0.0.1:${site.address().port}`, TTCRAFT_TOKEN: 'local-test', TTCRAFT_CONFIG_DIR: join(temp, 'mcp'),
  } });
  client = new Client({ name: 'TTCraft native smoke', version: '1' }); await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const value = JSON.parse(result.content[0].text);
    assert.ok(!result.isError, `${name}: ${JSON.stringify(value)}`);
    return value;
  };
  const connected = await call('table_connect', { table_id: 42 });
  const first = await call('objects_list');
  const read = await call('script_read');
  await call('script_write', { code: 'function onLoad() print("mcp-native-ok") end', expected_sha256: read.sha256 });
  const blueprint = { id: 'native-demo', plan: { shape: [{ kind: 'rect', w: 2.4, d: 1.6 }], seats: { count: 4 } },
    templates: [{ key: 'token', spec: { name: 'MCP token', category: 'MCP test', kind: 'chip', tint: '#ff3344' } }],
    objects: [{ key: 'token-1', template: '$token', name: 'MCP token one', position: [0.2, 0.1, 0], locked: true, script: '-- native object script' }] };
  await call('blueprint_apply', { blueprint, dry_run: false });
  const once = await call('objects_list'); assert.equal(once.total, first.total + 1);
  blueprint.objects[0].position = [0.4, 0.1, 0];
  await call('blueprint_apply', { blueprint, dry_run: false });
  const twice = await call('objects_list'); assert.equal(twice.total, once.total);
  const obj = twice.objects.find(o => o.name === 'MCP token one'); assert.ok(obj?.guid);
  assert.ok(Math.abs(obj.position[0] - 0.4) < 0.002, JSON.stringify(obj));
  assert.equal(obj.locked, true);
  const image = join(temp, 'pixel.png');
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
  const asset = await call('asset_upload', { file_path: image }); assert.match(asset.path, /^library\/assets\//);
  await call('table_save', { name: 'MCP native smoke' });
  const example = JSON.parse(await readFile('examples/four-player-table.json', 'utf8'));
  await call('blueprint_apply', { blueprint: example, dry_run: false });
  const withExample = await call('objects_list'); assert.equal(withExample.total, twice.total + 3);
  await call('archives_export', { output_path: join(temp, 'native.zip') });
  await call('archives_import', { file_path: join(temp, 'native.zip') });
  const imported = await call('objects_list'); assert.ok(imported.objects.some(o => o.guid === obj.guid));
  console.log(JSON.stringify({ native_protocol: connected.protocol, initial_objects: first.total, final_objects: withExample.total,
    blueprint_repeat: 'passed', bundled_example: 'passed', position_and_lock: 'passed', lua_compile: 'passed', asset_upload: 'passed', named_snapshot: 'passed', export_import: 'passed' }, null, 2));
} catch (error) { process.stderr.write(output.slice(-6000) + '\n'); throw error; }
finally {
  await client?.close();
  if (site) await new Promise(resolve => site.close(resolve));
  if (native && native.exitCode === null) { const exited = new Promise(resolve => native.once('exit', resolve)); native.kill(); await exited; }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
