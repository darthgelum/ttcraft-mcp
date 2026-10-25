import http from 'node:http';
import { WebSocketServer } from 'ws';

export function stateFrame(objects = [], { tag = 1, removed = [], generation = 1, revision = 1, time = 10 } = {}) {
  const delta = tag === 2 || tag === 12;
  const buf = Buffer.alloc(3 + objects.length * 35 + (delta ? 2 + removed.length * 4 + 6 : 4) + 8);
  buf[0] = tag; buf.writeUInt16LE(objects.length, 1);
  for (const [i, obj] of objects.entries()) {
    const o = 3 + i * 35;
    buf.writeUInt32LE(obj.id, o); buf[o + 4] = ['die', 'chip', 'coin', 'deck', 'card', 'prop', 'tablet', 'counter', 'clock', 'note'].indexOf(obj.kind || 'chip');
    buf[o + 5] = obj.locked ? 2 : 1;
    for (let k = 0; k < 3; k++) buf.writeInt16LE(Math.round((obj.position || [0, 0.1, 0])[k] * 10000), o + 6 + k * 2);
    buf.writeInt16LE(32767, o + 18);
  }
  let o = 3 + objects.length * 35;
  if (delta) {
    buf.writeUInt16LE(removed.length, o); o += 2;
    for (const id of removed) { buf.writeUInt32LE(id, o); o += 4; }
  }
  buf.writeUInt32LE(time, o); o += 4;
  if (delta) o += 2;
  buf.writeUInt32LE(generation, o); buf.writeUInt32LE(revision, o + 4);
  return buf;
}

export async function fixture() {
  const calls = [], sockets = new Set(), uploads = new Map();
  const objects = new Map([[1, { id: 1, guid: 'guid-one', kind: 'chip', position: [0.1, 0.02, -0.2], label: 'First chip' }]]);
  const templates = [{ id: 'builtin-chip', name: 'Chip', category: 'Basics', kind: 'chip', locked: true }];
  const scripts = new Map([[0, 'function onLoad() print("ready") end'], [1, '-- chip']]);
  let nextObject = 1, nextTemplate = 0, polls = 0, approved = false, zipBytes;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    calls.push({ kind: 'http', path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, bytes: body.length });
    const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/api/devices/code') return json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: baseUrl + '/device', verification_uri_complete: baseUrl + '/device?code=ABCD-EFGH', expires_in: 600, interval: 2 });
    if (url.pathname === '/api/devices/token') {
      polls++;
      if (!approved) { res.statusCode = 400; return json({ error: 'authorization_pending' }); }
      return json({ access_token: 'private-dev-token', user: { id: 7, username: 'тест' } });
    }
    if (url.pathname.startsWith('/api/dev/')) {
      if (req.headers.authorization !== 'Bearer private-dev-token') { res.statusCode = 401; return json({ error: 'unauthorized' }); }
      if (url.pathname === '/api/dev/me') return json({ user: { id: 7, username: 'тест' } });
      if (url.pathname === '/api/dev/tables') return json({ tables: [{ id: 42, running: true, room: { name: 'Room' }, channel: { slug: 'test' } }] });
      if (url.pathname === '/api/dev/tables/42/connect') return json({ table_id: 42, token: 'short-token', caps: 'owner', connection_kind: 'tool', ws_url: baseUrl.replace('http:', 'ws:') + '/ws', http_url: baseUrl, expires_in: 120 });
      res.statusCode = 404; return json({ error: 'not_found' });
    }
    if (url.pathname === '/capabilities') return json({ tool_connections: true });
    if (url.pathname === '/blob.begin') { const id = String(uploads.size + 1); uploads.set(id, Buffer.alloc(0)); return json({ id, chunk: 4, received: 0 }); }
    if (url.pathname === '/blob.chunk') {
      const id = url.searchParams.get('id'), existing = uploads.get(id);
      if (Number(url.searchParams.get('offset')) !== existing.length) { res.statusCode = 409; return json({ received: existing.length }); }
      uploads.set(id, Buffer.concat([existing, body])); return json({ received: uploads.get(id).length });
    }
    if (url.pathname === '/blob.status') return json({ received: uploads.get(url.searchParams.get('id')).length });
    if (url.pathname === '/blob.abort') return json({ ok: true });
    if (url.pathname === '/upload') return json({ path: 'library/assets/mock.png' });
    if (url.pathname === '/export.zip') { res.setHeader('content-type', 'application/zip'); return res.end(Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4])); }
    if (url.pathname === '/import.zip') { zipBytes = uploads.get(url.searchParams.get('blob')); return json({ ok: true }); }
    if (url.pathname === '/import.modules') return json({ ok: true, packages: JSON.parse(body).packages.length });
    res.statusCode = 404; res.end('not found');
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  const send = (ws, value) => ws.send(JSON.stringify(value));
  const props = (ws, ids) => send(ws, { type: 'props', objects: ids.map(id => ({ id, props: { guid: objects.get(id).guid, kind: objects.get(id).kind, label: objects.get(id).label } })) });
  const broadcastProps = id => { for (const ws of sockets) props(ws, [id]); };
  const delta = (items = [], removed = []) => { for (const ws of sockets) ws.send(stateFrame(items, { tag: 2, removed })); };
  wss.on('connection', ws => {
    sockets.add(ws); ws.on('close', () => sockets.delete(ws));
    send(ws, { type: 'hello', protocol: 13, worldGeneration: 1, visibilityRevision: 1, playerId: 7, game: { name: 'Test', table: { seats: 4 }, objects: Object.fromEntries([...objects].map(([id, o]) => [id, { name: o.label, type: o.kind }])) } });
    send(ws, { type: 'worldEpoch', worldGeneration: 1, visibilityRevision: 1 });
    ws.send(stateFrame([...objects.values()])); ws.send(stateFrame([], { tag: 11 })); props(ws, [...objects.keys()]);
    send(ws, { type: 'zones', zones: [] });
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString()); calls.push({ kind: 'ws', ...msg });
      if (msg.type === 'identify') return;
      if (msg.type === 'echo') return send(ws, { type: 'echo', t: msg.t });
      if (msg.type === 'liblist') return send(ws, { type: 'library', items: templates });
      if (msg.type === 'assetlist') return send(ws, { type: 'assets', assets: [{ name: 'Image', path: 'library/assets/mock.png' }], folders: [] });
      if (msg.type === 'getprops') return props(ws, [msg.id]);
      if (['getscript', 'getglobalscript'].includes(msg.type)) return setTimeout(() => send(ws, { type: 'script', id: msg.id || 0, code: scripts.get(msg.id || 0) || '' }), 15);
      if (['setscript', 'setglobalscript'].includes(msg.type)) {
        const ok = !msg.code.includes('syntaxerror');
        if (ok) scripts.set(msg.id || 0, msg.code);
        send(ws, { type: 'log', level: 'info', msg: 'compiled' });
        return send(ws, { type: 'scriptresult', id: msg.id || 0, ok, error: ok ? '' : 'syntax error near line 1' });
      }
      if (msg.type === 'libsave') {
        let id = msg.id;
        let item = templates.find(t => t.id === id);
        if (!item) { id = 'user-' + (++nextTemplate); item = { id }; templates.push(item); }
        Object.assign(item, msg, { id }); delete item.type; delete item.requestId;
        for (const peer of sockets) send(peer, { type: 'library', items: templates });
        return send(ws, { type: 'libresult', id, ok: true });
      }
      if (msg.type === 'spawn') {
        const id = ++nextObject, obj = { id, guid: 'guid-' + id, kind: msg.kind || 'chip', label: msg.label || '', position: msg.p };
        objects.set(id, obj); broadcastProps(id); delta([obj]); return;
      }
      if (msg.type === 'setprops') {
        for (const id of msg.ids || [msg.id]) { Object.assign(objects.get(id), { label: msg.label }); broadcastProps(id); }
        return;
      }
      if (msg.type === 'lock') { objects.get(msg.id).locked = msg.on; delta([objects.get(msg.id)]); return; }
      if (msg.type === 'setpose') {
        const obj = objects.get(msg.id);
        if (obj.locked) return send(ws, { type: 'nak', oid: msg.id, action: 'setpose' });
        if (msg.pos) obj.position = msg.pos; delta([obj]); return;
      }
      if (msg.type === 'remove') { objects.delete(msg.id); delta([], [msg.id]); return; }
      if (msg.type === 'tableplan') return send(ws, { type: 'tableplanresult', ok: !msg.plan.invalid, warnings: [], error: msg.plan.invalid ? 'invalid plan' : undefined });
      if (msg.type === 'savetable') return send(ws, { type: 'tablesaved', ok: true, name: msg.name, requestId: msg.requestId });
      if (msg.type === 'setperms') return send(ws, { type: 'log', level: 'error', action: msg.type, key: 'err.noPermission', requestId: msg.requestId });
      if (msg.type === 'containerlist') return send(ws, { type: 'contlist', id: msg.id, items: [] });
      if (msg.type === 'editlock') return send(ws, { type: 'editlock', key: msg.key, ok: true });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  return { baseUrl, calls, objects, scripts, templates, uploads, get polls() { return polls; }, approve: () => { approved = true; }, get zipBytes() { return zipBytes; },
    async close() { for (const ws of sockets) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); } };
}
