import type { Json } from './reference.js';

const kinds = ['die', 'chip', 'coin', 'deck', 'card', 'prop', 'tablet', 'counter', 'clock', 'note'];
export interface ObjectState extends Json { id: number; guid?: string; name?: string; kind?: string; props?: Json; position?: number[]; rotation?: number[]; }

/** Authoritative WS state, including shared and restricted v13 membership. */
export class TableState {
  protocol = 13;
  generation = 0;
  revision = 0;
  hello?: Json;
  readonly objects = new Map<number, ObjectState>();
  readonly messages = new Map<string, Json>();
  private shared = new Set<number>();
  private personal = new Set<number>();
  propsSeen = false;
  baselineSeen = false;
  private epochPending = true;
  private pendingFrames = new Map<number, { records: ObjectState[]; time: number }>();

  json(msg: Json): void {
    if (msg.type === 'worldEpoch') {
      if (this.generation !== msg.worldGeneration) {
        this.objects.clear(); this.shared.clear(); this.personal.clear(); this.propsSeen = false;
      }
      this.generation = msg.worldGeneration; this.revision = msg.visibilityRevision;
      this.epochPending = true; this.baselineSeen = false; this.pendingFrames.clear();
    } else if (msg.type === 'hello') {
      const protocol = Number(msg.protocol);
      if (!Number.isInteger(protocol) || protocol < 9 || protocol > 13) throw new Error(`Unsupported table protocol ${msg.protocol}. Supported: 9–13. Update ttcraft-mcp for newer servers.`);
      if (this.hello && (this.generation !== (msg.worldGeneration || 0) || this.revision !== (msg.visibilityRevision || 0))) {
        this.objects.clear(); this.shared.clear(); this.personal.clear(); this.propsSeen = false; this.baselineSeen = false;
      }
      this.protocol = protocol;
      this.generation = msg.worldGeneration || 0;
      this.revision = msg.visibilityRevision || 0;
      this.hello = msg;
      this.epochPending = true; this.baselineSeen = false; this.pendingFrames.clear();
      this.messages.set('table', { type: 'table', table: msg.game?.table });
      for (const [key, value] of Object.entries(msg.game?.objects || {})) {
        const id = Number(key), obj = value as Json;
        this.objects.set(id, { ...this.objects.get(id), id, name: obj.name, kind: obj.type });
      }
    } else if (msg.type === 'props') {
      for (const row of msg.objects || []) {
        const obj: ObjectState = this.objects.get(row.id) || { id: row.id };
        // props rows carry complete property blobs, not patches. Merging would
        // retain removed mixins such as an effect/overlay cleared by an editor.
        Object.assign(obj, { props: row.props || {}, guid: row.props?.guid || obj.guid });
        obj.name = row.props?.label ?? obj.name ?? row.props?.kind;
        obj.kind ||= row.props?.kind;
        this.objects.set(row.id, obj);
      }
      this.propsSeen = true;
    } else if (msg.type === 'hidden') {
      const masked = new Set(msg.ids || []);
      for (const obj of this.objects.values()) obj.hidden = masked.has(obj.id);
    }
    // Do not retain chat, echo, logs or an unbounded set of response types.
    if (['library', 'assets', 'effects', 'table', 'zones', 'snaps', 'drawings', 'decals', 'players', 'groups', 'timemachine', 'policy', 'music', 'lighting', 'hands', 'editlocks', 'stamps', 'fonts', 'sounds', 'playlists', 'banks', 'materials', 'turns'].includes(msg.type)) this.messages.set(msg.type, msg);
  }

  binary(buf: Buffer): void {
    const tag = buf[0], personal = tag === 11 || tag === 12;
    const keyframe = tag === 1 || tag === 11;
    if (![1, 2, 11, 12].includes(tag) || buf.length < 3) return;
    const count = buf.readUInt16LE(1);
    let offset = 3 + count * 35;
    if (offset > buf.length) throw new Error('Truncated object records.');
    const records: ObjectState[] = [];
    for (let i = 0; i < count; i++) {
      const o = 3 + i * 35;
      const flags = buf[o + 5];
      records.push({ id: buf.readUInt32LE(o), kind: kinds[buf[o + 4]],
        position: [0, 2, 4].map(k => buf.readInt16LE(o + 6 + k) / 10000),
        rotation: [0, 2, 4, 6].map(k => buf.readInt16LE(o + 12 + k) / 32767),
        sleeping: Boolean(flags & 1), locked: Boolean(flags & 2), clickable: Boolean(flags & 4), holder: buf[o + 21],
        extra: buf[o + 20], extra2: buf[o + 22],
      });
    }
    const removed: number[] = [];
    if (!keyframe) {
      if (offset + 2 > buf.length) throw new Error('Truncated removed count.');
      const n = buf.readUInt16LE(offset); offset += 2;
      if (offset + n * 4 > buf.length) throw new Error('Truncated removed records.');
      for (let i = 0; i < n; i++, offset += 4) removed.push(buf.readUInt32LE(offset));
    }
    const trailer = 4 + (!keyframe && this.protocol >= 12 ? 2 : 0);
    if (buf.length < offset + trailer + (this.protocol >= 13 ? 8 : 0)) throw new Error('Truncated state trailer.');
    if (this.protocol >= 13) {
      const generation = buf.readUInt32LE(offset + trailer), revision = buf.readUInt32LE(offset + trailer + 4);
      if (generation !== this.generation || revision !== this.revision) return;
      if (this.epochPending) {
        if (!keyframe) return;
        const time = buf.readUInt32LE(offset);
        this.pendingFrames.set(personal ? 1 : 0, { records, time });
        const common = this.pendingFrames.get(0), own = this.pendingFrames.get(1);
        if (!common || !own || common.time !== own.time) return;
        this.shared = new Set(common.records.map(r => r.id));
        this.personal = new Set(own.records.map(r => r.id));
        for (const id of this.objects.keys()) if (!this.shared.has(id) && !this.personal.has(id)) this.objects.delete(id);
        for (const r of [...common.records, ...own.records]) this.objects.set(r.id, { ...this.objects.get(r.id), ...r });
        this.pendingFrames.clear(); this.epochPending = false; this.baselineSeen = true;
        return;
      }
    }
    const members = personal ? this.personal : this.shared;
    if (keyframe) {
      const ids = new Set(records.map(r => r.id));
      for (const id of members) if (!ids.has(id)) removed.push(id);
      members.clear();
      this.baselineSeen = true;
    }
    for (const r of records) {
      members.add(r.id);
      this.objects.set(r.id, { ...this.objects.get(r.id), ...r });
    }
    for (const id of removed) {
      members.delete(id);
      if (!this.personal.has(id) && !this.shared.has(id)) this.objects.delete(id);
    }
  }
  resolve(ref: number | string): ObjectState {
    const obj = typeof ref === 'number' ? this.objects.get(ref) : [...this.objects.values()].find(o => o.guid === ref);
    if (!obj) throw new Error(`Object ${ref} is absent. Use objects_list; prefer a stable guid across reconnects.`);
    return obj;
  }
  list(query = '', offset = 0, limit = 100, details = false): Json {
    const q = query.toLowerCase();
    const all = [...this.objects.values()].filter(o => !q || [o.name, o.guid, o.kind, String(o.id)].some(v => v?.toLowerCase().includes(q))).sort((a, b) => a.id - b.id);
    return { total: all.length, offset, objects: all.slice(offset, offset + limit).map(o => details ? o : {
      id: o.id, guid: o.guid, name: o.name, kind: o.kind, position: o.position, rotation: o.rotation, locked: o.locked, hidden: o.hidden,
    }), next_offset: offset + limit < all.length ? offset + limit : null };
  }
}
