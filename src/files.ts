import { open, stat, mkdir, rm, copyFile } from 'node:fs/promises';
import { createWriteStream, constants } from 'node:fs';
import { dirname, basename, extname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { checkedFetch, safeUrl } from './config.js';
import type { TableSession } from './session.js';
import type { Json } from './reference.js';

function absolute(path: string): void { if (!isAbsolute(path)) throw new Error('Supply an absolute local file path.'); }
export async function tableHttp(session: TableSession, path: string, init: RequestInit = {}, timeout = 60000): Promise<Response> {
  const info = await session.connectionInfo();
  const base = safeUrl(info.http_url);
  // Only callers in this module choose paths; never accept arbitrary URLs.
  const url = new URL(path, base.href.endsWith('/') ? base.href : base.href + '/');
  if (url.origin !== base.origin) throw new Error('Invalid table HTTP endpoint.');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${info.token}`);
  return checkedFetch(url, { ...init, headers }, timeout);
}

/** Bounded-memory uploads using the same staging endpoints as the browser. */
export async function stageFile(session: TableSession, path: string): Promise<string> {
  absolute(path);
  const file = await open(path, 'r');
  let id = '';
  try {
    const size = (await file.stat()).size;
    if (!(await file.stat()).isFile()) throw new Error('Path must be a regular file.');
    const start = await (await tableHttp(session, `/blob.begin?size=${size}`, { method: 'POST' })).json() as Json;
    if (typeof start.id !== 'string' || !Number.isSafeInteger(start.chunk) || start.chunk <= 0 || start.chunk > 16 * 1024 * 1024) throw new Error('Invalid upload staging response.');
    id = start.id;
    const buffer = Buffer.alloc(Math.min(start.chunk, Math.max(1, size)));
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) throw new Error('File changed while uploading.');
      let retries = 0;
      for (;;) {
        try {
          const reply = await (await tableHttp(session, `/blob.chunk?id=${encodeURIComponent(id)}&offset=${offset}`, {
            method: 'POST', body: new Uint8Array(buffer.subarray(0, bytesRead)), headers: { 'content-type': 'application/octet-stream' },
          })).json() as Json;
          if (reply.received !== offset + bytesRead) throw new Error('Unexpected staging offset.');
          offset = reply.received; break;
        } catch (error) {
          if (++retries > 2) throw error;
          // Check authoritative offset before a retry: the lost reply may have
          // committed the bytes. Never append a duplicate chunk blindly.
          const state = await (await tableHttp(session, `/blob.status?id=${encodeURIComponent(id)}`)).json() as Json;
          if (state.received === offset + bytesRead) { offset = state.received; break; }
          if (state.received !== offset) throw error;
        }
      }
    }
    return id;
  } catch (error) {
    if (id) await abortStage(session, id);
    throw error;
  } finally { await file.close(); }
}
async function abortStage(session: TableSession, id: string): Promise<void> {
  await tableHttp(session, `/blob.abort?id=${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
}
export async function uploadAsset(session: TableSession, path: string, name?: string): Promise<Json> {
  const id = await stageFile(session, path);
  try {
    const params = new URLSearchParams({ blob: id, name: name || basename(path), ext: extname(path).slice(1).toLowerCase() });
    return await (await tableHttp(session, `/upload?${params}`, { method: 'POST' }, 120000)).json() as Json;
  } finally { await abortStage(session, id); }
}
export async function exportArchive(session: TableSession, path: string, overwrite = false): Promise<Json> {
  absolute(path);
  if (!overwrite) {
    const exists = await stat(path).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; });
    if (exists) throw new Error('Output exists. Choose a new file or set overwrite=true.');
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    const response = await tableHttp(session, '/export.zip', {}, 180000);
    if (!response.body) throw new Error('Empty archive response.');
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(session.remote && bytes > 64 * 1024 * 1024 ? new Error('Remote archive limit is 64 MiB; use the TTCraft browser for larger exports.') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as any), limit, createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
    const header = await open(tmp, 'r');
    try {
      const sig = Buffer.alloc(4); await header.read(sig, 0, 4, 0);
      if (sig.readUInt32LE(0) !== 0x04034b50) throw new Error('Export response is not a ZIP archive.');
    } finally { await header.close(); }
    await copyFile(tmp, path, overwrite ? 0 : constants.COPYFILE_EXCL);
    return { path, bytes: (await stat(path)).size, table_id: session.tableId };
  } finally { await rm(tmp, { force: true }); }
}
export async function importArchive(session: TableSession, path: string): Promise<Json> {
  const id = await stageFile(session, path);
  try {
    const result = await (await tableHttp(session, `/import.zip?blob=${encodeURIComponent(id)}`, { method: 'POST' }, 180000)).json() as Json;
    await session.reconnect();
    return { ...result, table: session.status() };
  } finally { await abortStage(session, id); }
}
export async function importModules(session: TableSession, packages: { path: string; key?: string; applyLayout?: boolean }[], tableShapeFrom?: number, applyGlobalScript?: boolean): Promise<Json> {
  const staged: string[] = [];
  try {
    for (const pkg of packages) staged.push(await stageFile(session, pkg.path));
    const options = { packages: packages.map((p, i) => ({ blob: staged[i], ...(p.key ? { key: p.key } : {}), applyLayout: p.applyLayout ?? false })),
      tableShapeFrom: tableShapeFrom ?? null, ...(applyGlobalScript === undefined ? {} : { applyGlobalScript }) };
    const result = await (await tableHttp(session, '/import.modules', {
      method: 'POST', body: JSON.stringify(options), headers: { 'content-type': 'application/json' },
    }, 180000)).json() as Json;
    await session.reconnect();
    return { ...result, table: session.status() };
  } finally { for (const id of staged) await abortStage(session, id); }
}
