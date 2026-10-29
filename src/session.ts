import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { Auth } from './auth.js';
import { checkedFetch, safeUrl } from './config.js';
import { commandMap, type Json } from './reference.js';
import { TableState } from './state.js';

export interface ConnectInfo { table_id: number; token: string; caps: string; ws_url: string; http_url: string; expires_in: number; connection_kind?: string; }
const directReplies: Record<string, string[]> = {
  getscript: ['script', 'scriptresult'], getglobalscript: ['script'],
  setscript: ['scriptresult'], setglobalscript: ['scriptresult'], resumescript: ['scriptresult'],
  liblist: ['library'], assetlist: ['assets'], effectlist: ['effects'], libsave: ['libresult'], libsavefrom: ['libresult'],
  tableplan: ['tableplanresult'], zoneadd: ['zoneresult'], snapadd: ['snapresult'], drawadd: ['drawresult'], decaladd: ['decalresult'],
  getprops: ['props'], menu: ['menu'], groupmenu: ['menu'], containerlist: ['contlist'],
  clippaste: ['pasted'], savetable: ['tablesaved'], tmstats: ['tmstats'], editlock: ['editlock'],
};

export class TableSession {
  state = new TableState();
  private ws?: WebSocket;
  private connecting?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private events = new EventEmitter();
  private heartbeat?: NodeJS.Timeout;
  private sequence = 0;
  private requestId = 0;
  private info?: ConnectInfo;
  private journal: Json[] = [];
  private journalBytes = 0;
  private readonly clientId = randomUUID();
  private readonly tabId = randomUUID();
  private failure?: Error;
  constructor(readonly tableId: number, private readonly auth: Auth) {}

  get connected(): boolean { return !this.failure && this.ws?.readyState === WebSocket.OPEN && Boolean(this.state.hello) && this.state.propsSeen && this.state.baselineSeen; }
  get caps(): string { return this.info?.caps || ''; }
  get remote(): boolean { return this.auth.config.remote === true; }
  get cursor(): number { return this.sequence; }
  status(): Json { return { table_id: this.tableId, connected: this.connected, caps: this.caps, protocol: this.state.hello?.protocol,
    player_id: this.state.hello?.playerId, name: this.state.hello?.game?.name, objects: this.state.objects.size, event_cursor: this.cursor }; }

  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.connecting ??= this.connect().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async connect(): Promise<void> {
    this.dispose();
    this.failure = undefined;
    this.state = new TableState();
    const info = await this.auth.api<ConnectInfo>(`/api/dev/tables/${this.tableId}/connect`);
    if (info.connection_kind !== 'tool') {
      throw new Error('TTCraft needs the tool-connection update before MCP can connect alongside your browser. No WebSocket was opened; your browser session is unchanged.');
    }
    const url = safeUrl(info.ws_url, true);
    const http = safeUrl(info.http_url);
    let compatible = false;
    try {
      const response = await checkedFetch(new URL('/capabilities', http), { headers: { accept: 'application/json' } }, 10000);
      compatible = (await response.json()).tool_connections === true;
    } catch { /* Older table instances serve HTML/404 at this endpoint. */ }
    if (!compatible) {
      throw new Error('This running table needs a safe restart onto the tool-connection update. MCP did not open a WebSocket, so your browser stays connected. Save the table before restarting it.');
    }
    url.searchParams.set('token', info.token);
    this.info = info;
    const ws = new WebSocket(url, { handshakeTimeout: 15000, maxPayload: 16 * 1024 * 1024 });
    this.ws = ws;
    ws.on('open', () => {
      this.send({ type: 'identify', clientId: this.clientId, tabId: this.tabId });
      this.heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 25000);
      this.heartbeat.unref();
    });
    ws.on('message', (data, binary) => {
      try {
        const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (binary) { this.state.binary(buffer); this.events.emit('state'); return; }
        const msg = JSON.parse(buffer.toString('utf8')) as Json;
        if (!msg || typeof msg.type !== 'string') return;
        this.state.json(msg);
        if (msg.type === 'kicked') { this.fail(new Error('The table ended this session. Reconnect after checking your access.')); return; }
        // Chat is deliberately not exposed. No secrets are put in the journal.
        if (!['hello', 'echo', 'chat', 'chatdm', 'roomchat', 'script'].includes(msg.type)) {
          const serialized = JSON.stringify(msg);
          const event = { ...(serialized.length > 24000 ? { type: msg.type, summary: 'Large event omitted; read current state with the specialized tools.', keys: Object.keys(msg) } : msg),
            cursor: ++this.sequence, at: new Date().toISOString() };
          this.journal.push(event); this.journalBytes += JSON.stringify(event).length;
          while (this.journal.length > 500 || this.journalBytes > 2000000) this.journalBytes -= JSON.stringify(this.journal.shift()).length;
        }
        this.events.emit('message', msg);
        this.events.emit('state');
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    ws.on('error', () => this.fail(new Error('Table WebSocket failed. Check access and table availability; reconnect explicitly.')));
    ws.on('close', () => this.fail(new Error('Table disconnected. Read state after reconnecting before retrying mutations.')));
    try {
      await this.until(() => this.connected, 18000);
      await this.execute({ type: 'liblist' });
    } catch (error) { this.dispose(); throw error; }
  }
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.events.emit('failure', error);
    this.ws?.terminate();
  }
  dispose(): void {
    this.events.emit('failure', new Error('Table session closed.'));
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const ws = this.ws; this.ws = undefined;
    if (ws) { ws.removeAllListeners(); ws.on('error', () => {}); ws.terminate(); }
  }
  async reconnect(): Promise<void> { this.dispose(); await this.ensureConnected(); }
  until(predicate: () => boolean, timeout: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.events.off('state', update); this.events.off('failure', fail); };
      const update = () => { if (predicate()) { cleanup(); resolve(); } };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const timer = setTimeout(() => fail(new Error('Table state timeout.')), timeout);
      this.events.on('state', update); this.events.on('failure', fail);
    });
  }
  private send(msg: Json): void {
    if (this.ws?.readyState !== WebSocket.OPEN || this.failure) throw this.failure || new Error('Table is not connected.');
    const data = JSON.stringify(msg);
    if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new Error('Command exceeds the 8 MB MCP command limit. Use archives for large data.');
    this.ws.send(data);
  }
  /** Serializes even different MCP tool calls: most table replies have no request id. */
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => {});
    return next;
  }
  command(msg: Json, responseType?: string, timeout = 12000): Promise<Json> {
    return this.exclusive(() => this.execute(msg, responseType, timeout));
  }
  /** Call only inside exclusive() for a multi-step workflow. Never replays mutations. */
  async execute(input: Json, responseType?: string, timeout = 12000): Promise<Json> {
    await this.auth.config.checkTableAccess?.(this.tableId);
    if (!this.connected) throw new Error('Connect to the table before issuing commands.');
    const type = String(input.type).toLowerCase();
    if (!commandMap.has(type)) throw new Error(`Unknown or unavailable command '${type}'. Use commands_search. Chat and transport commands are not exposed.`);
    if ('requestId' in input) throw new Error('requestId is managed by MCP; omit it.');
    const requestId = ++this.requestId;
    const msg = { ...input, type, requestId };
    const responseTypes = responseType ? [responseType] : directReplies[type];
    const beforeCursor = this.cursor;
    const marker = Date.now() + requestId / 100000;
    return new Promise<Json>((resolve, reject) => {
      let settled = false;
      const cleanup = () => { settled = true; clearTimeout(timer); this.events.off('message', receive); this.events.off('failure', fail); };
      const fail = (error: Error) => { if (!settled) { cleanup(); reject(error); } };
      const receive = (answer: Json) => {
        if (answer.requestId !== undefined && answer.requestId !== requestId) return;
        if (answer.type === 'log' && answer.level === 'error' && (answer.requestId === requestId || String(answer.action).toLowerCase() === type)) {
          fail(new Error(JSON.stringify(answer))); return;
        }
        if (answer.type === 'nak' && (answer.action === type || answer.oid === input.id)) { fail(new Error(`Table refused ${type}: ${JSON.stringify(answer)}`)); return; }
        if (responseTypes?.includes(answer.type)) {
          if (['script', 'scriptresult'].includes(answer.type) && answer.id !== (input.id || 0)) return;
          if (answer.type === 'props' && !(answer.objects || []).some((o: Json) => o.id === input.id)) return;
          if (answer.type === 'libresult' && input.id && answer.id !== input.id) return;
          if (answer.ok === false) { fail(new Error(JSON.stringify(answer))); return; }
          cleanup(); resolve({ status: 'server_response', command: type, response: answer, event_cursor: this.cursor });
        } else if (!responseTypes && answer.type === 'echo' && answer.t === marker) {
          cleanup(); resolve({ status: 'processed_unverified', command: type, event_cursor: this.cursor,
            observations: this.readEvents(beforeCursor, undefined, 30).events,
            instruction: 'The server processed the command stream, but this command has no success acknowledgement. Read state/events to verify its effect. Do not blindly retry a spawn, import, deal or other mutation.' });
        }
      };
      const timer = setTimeout(() => {
        const error = new Error(`${type} timed out; the outcome may be unknown. Reconnect and inspect state before retrying.`);
        fail(error);
        // Most responses lack request ids. A late reply must never satisfy the
        // next command with the same target, so poison this connection on timeout.
        this.fail(error);
      }, timeout);
      this.events.on('message', receive); this.events.on('failure', fail);
      try {
        this.send(msg);
        if (!responseTypes) this.send({ type: 'echo', t: marker });
      } catch (error) { fail(error as Error); }
    });
  }
  readEvents(after = 0, types?: string[], limit = 100): Json {
    const all = this.journal.filter(e => e.cursor > after && (!types?.length || types.includes(e.type)));
    const events = all.slice(0, limit);
    return { events, next_cursor: events.at(-1)?.cursor ?? Math.max(after, this.sequence), latest_cursor: this.sequence,
      truncated: this.journal.length > 0 && after < this.journal[0].cursor - 1, has_more: all.length > limit };
  }
  async waitEvents(after: number, timeout: number, types?: string[]): Promise<Json> {
    const predicate = () => this.journal.some(e => e.cursor > after && (!types?.length || types.includes(e.type)));
    try { await this.until(predicate, timeout); }
    catch (error) { if ((error as Error).message !== 'Table state timeout.') throw error; }
    return this.readEvents(after, types);
  }
  async connectionInfo(): Promise<ConnectInfo> {
    // HTTP tokens expire quickly. Refresh just before each request, without reconnecting WS.
    const info = await this.auth.api<ConnectInfo>(`/api/dev/tables/${this.tableId}/connect`);
    safeUrl(info.http_url);
    return info;
  }
}

export class Sessions {
  private sessions = new Map<number, TableSession>();
  private active?: number;
  constructor(private readonly auth: Auth) {}
  async connect(tableId: number): Promise<Json> {
    let session = this.sessions.get(tableId);
    if (!session) { session = new TableSession(tableId, this.auth); this.sessions.set(tableId, session); }
    await session.ensureConnected(); this.active = tableId;
    return session.status();
  }
  get(tableId?: number): TableSession {
    const id = tableId ?? this.active;
    const session = id === undefined ? undefined : this.sessions.get(id);
    if (!session?.connected) throw new Error('No connected table. Use tables_list then table_connect (or table_reconnect after a disconnect).');
    return session;
  }
  async reconnect(tableId: number): Promise<Json> {
    const session = this.sessions.get(tableId);
    if (!session) return this.connect(tableId);
    await session.reconnect(); this.active = tableId; return session.status();
  }
  close(tableId?: number): Json {
    const id = tableId ?? this.active;
    if (id !== undefined) { this.sessions.get(id)?.dispose(); this.sessions.delete(id); }
    if (this.active === id) this.active = undefined;
    return { disconnected: id };
  }
  status(): Json { return { active_table_id: this.active, tables: [...this.sessions.values()].map(s => s.status()) }; }
  dispose(): void { for (const s of this.sessions.values()) s.dispose(); this.sessions.clear(); this.active = undefined; }
}
