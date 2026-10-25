import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Auth } from '../dist/auth.js';
import { TableSession } from '../dist/session.js';

for (const mode of ['old-site', 'old-table', 'html-fallback']) {
  test(`refuse ${mode} before opening a WebSocket and displacing a browser`, async () => {
    let upgrades = 0;
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/connect')) return res.end(JSON.stringify({ table_id: 42, token: 'test', caps: 'owner',
        ...(mode === 'old-site' ? {} : { connection_kind: 'tool' }),
        ws_url: `ws://127.0.0.1:${server.address().port}/ws`, http_url: `http://127.0.0.1:${server.address().port}` }));
      if (mode === 'html-fallback') { res.setHeader('content-type', 'text/html'); return res.end('<html>old client</html>'); }
      res.end(JSON.stringify({ tool_connections: false }));
    });
    server.on('upgrade', (_req, socket) => { upgrades++; socket.destroy(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const session = new TableSession(42, new Auth({ baseUrl: `http://127.0.0.1:${server.address().port}`, configDir: '', token: 'test' }));
    try {
      await assert.rejects(session.ensureConnected(), /update|restart/i);
      assert.equal(upgrades, 0, 'An incompatible table must never see a new WS connection');
    } finally { session.dispose(); await new Promise(resolve => server.close(resolve)); }
  });
}
