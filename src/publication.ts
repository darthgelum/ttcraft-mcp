import { z } from 'zod';
import { openAsBlob } from 'node:fs';
import { open, stat, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Auth } from './auth.js';
import type { TableSession } from './session.js';
import { exportArchive } from './files.js';

export const listingSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().max(5000).default(''),
  type: z.enum(['game', 'objects', 'map', 'utility', 'modding']).default('game'),
  complexity: z.enum(['low', 'medium', 'high']).optional(),
  categories: z.array(z.string()).default([]), assets: z.array(z.string()).default([]),
  languages: z.array(z.enum(['any', 'en', 'ru'])).default([]),
  players: z.array(z.number().int().min(1).max(10)).default([]),
  play_times: z.array(z.number().int()).default([]), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export const publicationSchema = {
  package_path: z.string().optional().describe('Absolute local TTCraft ZIP. Omit to snapshot the connected table, including hidden contents.'),
  listing: listingSchema,
  cover_path: z.string().optional(), screenshot_paths: z.array(z.string()).max(12).default([]),
  dry_run: z.boolean().default(true),
};
type Publication = { package_path?: string; listing: z.infer<typeof listingSchema>; cover_path?: string; screenshot_paths: string[]; dry_run: boolean };

async function fileInfo(path: string, media: boolean, max?: number) {
  if (!isAbsolute(path)) throw new Error('Supply absolute local file paths.');
  const s = await stat(path);
  if (!s.isFile() || !s.size) throw new Error('Publication files must be non-empty regular files.');
  if (max && s.size > max) throw new Error(`${basename(path)} exceeds the media size limit.`);
  const ext = extname(path).slice(1).toLowerCase();
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  if (media && !types[ext]) throw new Error('Media must be PNG, JPEG, WebP or GIF.');
  if (!media) {
    const f = await open(path, 'r');
    try { const buf = Buffer.alloc(4); await f.read(buf, 0, 4, 0); if (ext !== 'zip' || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('package_path must be a TTCraft ZIP archive.'); }
    finally { await f.close(); }
  }
  return { path, name: basename(path), bytes: s.size, type: media ? types[ext]! : 'application/zip' };
}

export async function publishModule(auth: Auth, session: TableSession, args: Publication): Promise<unknown> {
  const options = await auth.api<any>('/api/dev/modules/options');
  const fields: Record<string, string> = { type: 'types', complexity: 'complexities', categories: 'categories', assets: 'assets', languages: 'languages', play_times: 'play_times' };
  for (const [key, option] of Object.entries(fields)) {
    const value = (args.listing as any)[key];
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value])
      if (!options[option]?.includes(item)) throw new Error(`Invalid listing.${key}: use modules_options.`);
  }
  const cover = args.cover_path ? await fileInfo(args.cover_path, true, 5 * 1024 * 1024) : null;
  const shots = await Promise.all(args.screenshot_paths.map(p => fileInfo(p, true, 10 * 1024 * 1024)));
  const pkg = args.package_path ? await fileInfo(args.package_path, false, options.limits?.package_kb ? options.limits.package_kb * 1024 : undefined) : null;
  const preview = { table_id: session.tableId, source: pkg ? 'local_package' : 'live_table_snapshot', listing: args.listing,
    package: pkg, cover, screenshots: shots, includes_hidden_contents: !pkg };
  if (args.dry_run) return { dry_run: true, ...preview, instruction: 'Review this publication. Set dry_run=false to publish it to the public TTCraft module catalog.' };
  let scratch: string | undefined;
  try {
    let path = pkg?.path;
    if (!path) { scratch = await mkdtemp(join(tmpdir(), 'ttcraft-publish-')); path = join(scratch, 'table.zip'); await exportArchive(session, path); }
    const form = new FormData();
    form.append('package', await openAsBlob(path, { type: 'application/zip' }), basename(path));
    for (const [key, value] of Object.entries(args.listing)) {
      if (Array.isArray(value)) value.forEach((v, i) => form.append(`${key}[${i}]`, String(v)));
      else if (value != null) form.append(key, String(value));
    }
    if (cover) form.append('cover', await openAsBlob(cover.path, { type: cover.type }), cover.name);
    for (const shot of shots) form.append('screenshots[]', await openAsBlob(shot.path, { type: shot.type }), shot.name);
    try {
      return await auth.api(`/api/dev/tables/${session.tableId}/modules`, { method: 'POST', body: form }, 180000);
    } catch (e) {
      if ((e as Error).message.startsWith('HTTP ')) throw e;
      throw new Error('Publication outcome is unknown. Do not retry blindly: use modules_list to check whether the module was created.');
    }
  } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
}
