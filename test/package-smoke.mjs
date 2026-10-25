import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const archive = resolve(process.argv[2] || 'ttcraft-mcp-0.1.1.tgz');
const temp = await mkdtemp(join(tmpdir(), 'ttcraft-mcp-package-'));
let client;
try {
  assert.ok(process.env.npm_execpath, 'Run through npm run test:package');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, 'install', '--prefix', temp, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', archive],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(output)));
  });
  const env = { ...process.env, TTCRAFT_CONFIG_DIR: join(temp, 'config'), TTCRAFT_URL: 'http://127.0.0.1:9' };
  delete env.TTCRAFT_TOKEN;
  const setup = JSON.parse(execFileSync(process.execPath, [join(temp, 'node_modules/ttcraft-mcp/dist/index.js'), 'setup', '--json'], { encoding: 'utf8', env }));
  assert.equal(setup.command, process.execPath.replaceAll('\\', '/'));
  assert.equal(setup.transport, 'stdio');
  assert.equal(setup.mcpServers.ttcraft.args[0], join(temp, 'node_modules/ttcraft-mcp/dist/index.js').replaceAll('\\', '/'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(temp, 'node_modules/ttcraft-mcp/dist/index.js')], cwd: temp, env });
  client = new Client({ name: 'package-smoke', version: '1' }); await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 37);
  const read = await client.callTool({ name: 'docs_read', arguments: { slug: 'table-plan' } });
  assert.equal(read.isError, undefined); assert.match(read.content[0].text, /metres/);
  const auth = await client.callTool({ name: 'auth_status', arguments: {} });
  assert.equal(JSON.parse(auth.content[0].text).status, 'signed_out');
  console.log('Packed install: 37 tools, bundled manual and signed-out startup passed outside the source tree.');
} finally { await client?.close(); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
