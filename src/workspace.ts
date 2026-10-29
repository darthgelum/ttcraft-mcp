import { mkdir, lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_FILE = 64 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024;
const queues = new Map<string, Promise<unknown>>();
export class Workspace {
  constructor(readonly root: string) {}
  async path(value: string): Promise<string> {
    if (!value.startsWith('/workspace/') || value.includes('\\') || value.includes('\0')) throw new Error('Use a path under /workspace/.');
    const parts = value.slice(11).split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || p !== p.trim() || p.endsWith('.')
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || !/^[\p{L}\p{N}_. -]{1,160}$/u.test(p))) throw new Error('Invalid workspace path.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await realpath(this.root);
    let path = root;
    for (const [i, part] of parts.entries()) {
      path = join(path, part);
      const info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e; return undefined; });
      if (info?.isSymbolicLink() || info && !info.isFile() && !info.isDirectory()) throw new Error('Workspace links and special files are not allowed.');
      if (i < parts.length - 1) {
        if (info && !info.isDirectory()) throw new Error('Parent path is not a directory.');
        await mkdir(path, { recursive: false, mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      } else if (info?.isDirectory()) throw new Error('Expected a file, not a directory.');
    }
    return path;
  }
  async arguments(name: string, value: any): Promise<any> {
    const a = structuredClone(value);
    for (const key of ['file_path','output_path','package_path','cover_path']) if (a[key] !== undefined) a[key] = await this.path(a[key]);
    if (Array.isArray(a.screenshot_paths)) a.screenshot_paths = await Promise.all(a.screenshot_paths.map((p: string) => this.path(p)));
    if (Array.isArray(a.packages)) for (const p of a.packages) p.path = await this.path(p.path);
    if (a.output_path) await this.capacity(name === 'archives_export' ? MAX_FILE : 1024 * 1024);
    return a;
  }
  private async capacity(extra: number): Promise<void> {
    let count = 0;
    const total = async (dir: string): Promise<number> => {
      let n = 0;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (++count > 4096) throw new Error('Workspace file limit reached.');
        if (entry.isSymbolicLink()) throw new Error('Workspace links are not allowed.');
        n += entry.isDirectory() ? await total(join(dir, entry.name)) : (await stat(join(dir, entry.name))).size;
      }
      return n;
    };
    if (await total(this.root) + extra > MAX_TOTAL) throw new Error('Workspace storage limit reached (256 MiB).');
  }
  output(value: unknown): unknown {
    if (typeof value === 'string') return value.startsWith(this.root)
      ? '/workspace'+value.slice(this.root.length).replaceAll('\\','/') : value.split(this.root).join('/workspace');
    if (Array.isArray(value)) return value.map(v => this.output(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,this.output(v)]));
    return value;
  }
  async write(path: string, base64: string, offset = 0): Promise<unknown> {
    const previous = queues.get(this.root) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      if (base64.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Supply at most 1 MiB of valid base64 per chunk.');
      const bytes = Buffer.from(base64,'base64');
      if (bytes.length > 1024 * 1024) throw new Error('Chunks are limited to 1 MiB.');
      if (offset + bytes.length > MAX_FILE) throw new Error('Remote files are limited to 64 MiB.');
      const target = await this.path(path);
      await this.capacity(bytes.length);
      const file = await open(target, offset === 0 ? 'wx' : 'r+', 0o600);
      try {
        if ((await file.stat()).size !== offset) throw new Error('Offset must match the current file size; do not retry an uncertain chunk blindly.');
        let written = 0;
        while (written < bytes.length) written += (await file.write(bytes,written,bytes.length-written,offset+written)).bytesWritten;
        return {path, bytes:offset + written};
      } finally { await file.close(); }
    });
    queues.set(this.root, job);
    try {return await job;} finally {if (queues.get(this.root)===job) queues.delete(this.root);}
  }
  async read(path: string, offset = 0, limit = 256 * 1024): Promise<unknown> {
    const file = await open(await this.path(path),'r');
    try {
      const size = (await file.stat()).size, buffer = Buffer.alloc(limit);
      const {bytesRead} = await file.read(buffer,0,limit,offset);
      return {path, bytes:size, offset, base64:buffer.subarray(0,bytesRead).toString('base64'), next_offset:offset+bytesRead<size?offset+bytesRead:null};
    } finally {await file.close();}
  }
}
