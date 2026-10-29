#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './config.js';
import { createServer } from './server.js';
import { Auth } from './auth.js';
import { createRemoteGateway } from './remote.js';

async function main(): Promise<void> {
  const command = process.argv[2] || 'serve';
  if (command === 'serve-http') {
    const base = configFromEnv();
    if (process.env.TTCRAFT_TOKEN) throw new Error('Do not configure a shared TTCRAFT_TOKEN for the remote gateway.');
    const gateway = createRemoteGateway({resource:process.env.MCP_RESOURCE_URL || base.baseUrl+'/mcp',
      apiOrigin:base.baseUrl,introspectionUrl:process.env.MCP_INTROSPECTION_URL || base.baseUrl+'/internal/mcp/introspect',
      gatewaySecret:process.env.MCP_GATEWAY_SECRET || '', dataDir:process.env.MCP_DATA_DIR || '/data',
      allowedOrigins:(process.env.MCP_ALLOWED_ORIGINS || base.baseUrl).split(',').map(s=>s.trim()),
    });
    const port = Number(process.env.PORT || 8090);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
    gateway.http.listen(port,process.env.HOST || '127.0.0.1',()=>process.stderr.write('TTCraft MCP HTTP gateway ready\n'));
    const stop=()=>{void gateway.close().finally(()=>{process.exitCode=0;});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    return;
  }
  if (['--help', '-h', 'help'].includes(command)) {
    process.stdout.write(`ttcraft-mcp 0.1.2\n\nUsage: ttcraft-mcp [serve|login|logout|status|setup]\n\nserve   Start the MCP stdio server (default; stdout is protocol only)\nlogin   Print browser approval URL/code and wait for sign-in\nlogout  Remove local credentials (revoke the device in TTCraft Settings → Security)\nstatus  Check the current identity\nsetup   Print copyable Claude Code/Codex/client configuration\n\nEnvironment:\n  TTCRAFT_URL         Origin (default https://ttcraft.net; loopback HTTP allowed)\n  TTCRAFT_CONFIG_DIR  Login/build storage (default ~/.ttcraft-mcp)\n  TTCRAFT_TOKEN       Optional explicit token override; never printed\n\nNode.js >=22 required. No VS Code extension or API key required.\n`);
    return;
  }
  if (command === '--version') { process.stdout.write('0.1.2\n'); return; }
  if (command === 'setup') {
    const binary = fileURLToPath(import.meta.url).replaceAll('\\', '/');
    const node = process.execPath.replaceAll('\\', '/');
    if (process.argv.includes('--json')) {
      process.stdout.write(JSON.stringify({
        version: '0.1.2', transport: 'stdio', command: node, args: [binary],
        claude: ['claude', 'mcp', 'add', '--transport', 'stdio', '--scope', 'user', 'ttcraft', '--', node, binary],
        codex: ['codex', 'mcp', 'add', 'ttcraft', '--', node, binary],
        mcpServers: { ttcraft: { command: node, args: [binary] } },
        vscode: { servers: { ttcraft: { type: 'stdio', command: node, args: [binary] } } },
      }, null, 2) + '\n');
      return;
    }
    process.stdout.write(`Claude Code:\nclaude mcp add --transport stdio --scope user ttcraft -- "${node}" "${binary}"\n\nCodex:\ncodex mcp add ttcraft -- "${node}" "${binary}"\n\nCodex config.toml:\n[mcp_servers.ttcraft]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(binary)}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 300\n\nOther clients (mcpServers JSON):\n${JSON.stringify({ mcpServers: { ttcraft: { command: node, args: [binary] } } }, null, 2)}\n`);
    return;
  }
  const config = configFromEnv();
  if (['login', 'logout', 'status'].includes(command)) {
    const auth = new Auth(config);
    if (command === 'login') await auth.loginCli();
    else process.stdout.write(JSON.stringify(command === 'logout' ? await auth.logout() : await auth.status(), null, 2) + '\n');
    return;
  }
  if (command !== 'serve' && command !== '--stdio') throw new Error(`Unknown command ${command}. Run --help.`);
  const { server, sessions } = createServer(config);
  const transport = new StdioServerTransport();
  const shutdown = () => { sessions.dispose(); void server.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  server.server.onclose = () => sessions.dispose();
  await server.connect(transport);
}
main().catch(error => { process.stderr.write(`TTCraft MCP: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
