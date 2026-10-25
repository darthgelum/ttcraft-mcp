import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TableSession } from './session.js';
import type { Config } from './config.js';
import type { Json } from './reference.js';

const data = z.record(z.string(), z.unknown());
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const quat = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
export const blueprintSchema = z.object({
  id: key.describe('Stable project id. Reuse the same id to update this build.'),
  plan: data.optional(),
  templates: z.array(z.object({ key, spec: data })).max(200).default([]),
  objects: z.array(z.object({
    key, template: z.string().optional().describe('Library template id, or $key for a blueprint template.'),
    spec: data.default({}), name: z.string().max(100).optional(),
    position: vec3, rotation: quat.optional(), scale: vec3.optional(),
    properties: data.optional(), locked: z.boolean().optional(), script: z.string().max(1000000).optional(),
  })).max(500).default([]),
  global_script: z.string().max(1000000).optional(),
}).strict();
export type Blueprint = z.infer<typeof blueprintSchema>;
interface Index { templates: Record<string, string>; objects: Record<string, string>; pending?: { kind: 'template' | 'object'; key: string; marker: string }; }

export function validateBlueprint(value: unknown): Blueprint {
  const bp = blueprintSchema.parse(value);
  for (const items of [bp.templates, bp.objects]) if (new Set(items.map(i => i.key)).size !== items.length) throw new Error('Blueprint keys must be unique within templates/objects.');
  const keys = new Set(bp.templates.map(t => t.key));
  for (const obj of bp.objects) {
    if (obj.template?.startsWith('$') && !keys.has(obj.template.slice(1))) throw new Error(`Unknown blueprint template ${obj.template}.`);
    for (const reserved of ['type', 'requestId', 'id', 'template', 'p', 'set']) if (reserved in obj.spec) throw new Error(`objects.${obj.key}.spec.${reserved} is reserved. Use template/position fields; set templates are available through table_command.`);
    if (!obj.template && !['die', 'chip', 'coin', 'deck', 'card', 'prop', 'tablet', 'counter', 'clock', 'note'].includes(String(obj.spec.kind))) throw new Error(`objects.${obj.key} needs a template or a supported spec.kind.`);
    if (obj.scale?.some(n => n <= 0)) throw new Error('Scale must be positive.');
    for (const reserved of ['type', 'requestId', 'id', 'ids']) if (reserved in (obj.properties || {})) throw new Error(`objects.${obj.key}.properties.${reserved} is reserved.`);
  }
  for (const t of bp.templates) if (['type', 'id', 'requestId', 'set'].some(k => k in t.spec)) throw new Error(`Template ${t.key} contains reserved fields or a multi-object set.`);
  return bp;
}

export async function applyBlueprint(session: TableSession, config: Config, bp: Blueprint, dryRun: boolean): Promise<Json> {
  return session.exclusive(async () => {
  const folder = join(config.configDir, 'builds');
  const originKey = createHash('sha256').update(config.baseUrl).digest('hex').slice(0, 16);
  const file = join(folder, `${originKey}-${session.tableId}-${bp.id}.json`);
  let index: Index = { templates: {}, objects: {} };
  try { index = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const persist = async () => {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const tmp = file + '.' + randomUUID() + '.tmp';
    try { await writeFile(tmp, JSON.stringify(index, null, 2), { mode: 0o600, flag: 'wx' }); await rename(tmp, file); }
    finally { await rm(tmp, { force: true }); }
  };
  const library = () => (session.state.messages.get('library')?.items || []) as Json[];
  // Reject missing references before changing any part of the live table.
  for (const obj of bp.objects) if (obj.template && !obj.template.startsWith('$') && !library().some(t => t.id === obj.template)) throw new Error(`Template ${obj.template} is absent.`);
  const summary = { id: bp.id, table_id: session.tableId, plan: !!bp.plan, templates: bp.templates.map(t => ({ key: t.key, existing_id: index.templates[t.key] })),
    objects: bp.objects.map(o => ({ key: o.key, existing_guid: index.objects[o.key], position: o.position })), global_script: bp.global_script !== undefined,
    pending: index.pending, note: 'Updates objects by persisted guid. Does not remove omitted objects. This is a sequential workflow, not a server transaction. Global script runs last.' };
  if (dryRun) return { dry_run: true, ...summary };
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const lockPath = file + '.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`This blueprint is locked by another build. Inspect ${lockPath}; after a crashed process, remove that lock only after verifying that its process is no longer running.`);
    throw error;
  }
    const completed: Json[] = [];
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await lock.close();
      // Another process may have finished between the initial preview read and
      // our exclusive create. Reload identities only after acquiring the lock.
      try { index = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (index.pending) {
        const pending = index.pending;
        const found = pending.kind === 'object'
          ? [...session.state.objects.values()].find(o => o.props?.label === pending.marker)
          : library().find(t => t.name === pending.marker);
        if (!found) throw new Error(`Previous ${pending.kind} '${pending.key}' has an unknown outcome. Inspect the table and the build index at ${file} before retrying. No automatic duplicate will be created.`);
        if (pending.kind === 'object') {
          if (!found.guid) throw new Error('Recovered object has no stable guid yet. Reconnect and try again.');
          index.objects[pending.key] = found.guid;
        } else index.templates[pending.key] = String(found.id);
        delete index.pending; await persist();
      }
      if (bp.plan) completed.push(await session.execute({ type: 'tableplan', plan: bp.plan }));
      for (const t of bp.templates) {
        let id = index.templates[t.key];
        const existing = library().find(item => item.id === id);
        if (!existing) {
          const marker = `__mcp_${bp.id}_${t.key}_${randomUUID().slice(0, 8)}`;
          index.pending = { kind: 'template', key: t.key, marker }; await persist();
          const reply = await session.execute({ ...t.spec, type: 'libsave', name: marker });
          id = reply.response.id; index.templates[t.key] = id;
          delete index.pending; await persist();
        }
        completed.push(await session.execute({ ...existing, ...t.spec, type: 'libsave', id, name: t.spec.name || existing?.name || t.key }));
      }
      for (const spec of bp.objects) {
        const saved = index.objects[spec.key];
        let obj = saved ? [...session.state.objects.values()].find(o => o.guid === saved) : undefined;
        if (!obj) {
          const marker = `__mcp_${bp.id}_${spec.key}_${randomUUID().slice(0, 8)}`;
          const templateId = spec.template?.startsWith('$') ? index.templates[spec.template.slice(1)] : spec.template;
          const template = templateId ? library().find(t => t.id === templateId) : undefined;
          if (template && Array.isArray(template.set) && template.set.length) throw new Error('Blueprint objects must spawn a single object; use table_command for set templates.');
          index.pending = { kind: 'object', key: spec.key, marker }; await persist();
          // Inline the template to give this spawn a unique recovery marker.
          // This snapshot does not establish live template linkage.
          const source: Json = { ...template, ...spec.spec, type: 'spawn', label: marker, p: spec.position };
          delete source.id; delete source.requestId;
          await session.execute(source);
          await session.until(() => [...session.state.objects.values()].some(o => o.props?.label === marker && o.guid && o.position), 12000);
          obj = [...session.state.objects.values()].find(o => o.props?.label === marker)!;
          index.objects[spec.key] = obj.guid!;
          delete index.pending; await persist();
        }
        const wasLocked = Boolean(session.state.resolve(obj.guid!).locked);
        if (wasLocked) {
          await session.execute({ type: 'lock', id: obj.id, on: false });
          await session.until(() => session.state.objects.get(obj!.id)?.locked === false, 5000);
        }
        const pos = await session.execute({ type: 'setpose', id: obj.id, pos: spec.position,
          ...(spec.rotation ? { rot: spec.rotation } : {}), ...(spec.scale ? { scale: spec.scale } : {}) });
        await session.execute({ ...spec.properties, type: 'setprops', id: obj.id, label: spec.name || spec.key });
        if (spec.script !== undefined) await session.execute({ type: 'setscript', id: obj.id, code: spec.script });
        if (spec.locked ?? wasLocked) {
          await session.execute({ type: 'lock', id: obj.id, on: true });
          await session.until(() => session.state.objects.get(obj!.id)?.locked === true, 5000);
        }
        completed.push({ key: spec.key, guid: obj.guid, id: obj.id, placement: pos.status });
      }
      if (bp.global_script !== undefined) completed.push(await session.execute({ type: 'setglobalscript', code: bp.global_script }));
      return { status: 'applied', ...summary, completed, index_path: file, instruction: 'Read objects/state and console to verify placement and runtime behavior.' };
    } catch (error) {
      return { status: 'partial_failure', isError: true, error: (error as Error).message, completed, index_path: file,
        instruction: 'Earlier steps may already be live. Inspect state; reuse this blueprint id to update. Pending creations are never blindly repeated.' };
    } finally { await lock.close().catch(() => {}); await rm(lockPath, { force: true }); }
  });
}
