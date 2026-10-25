import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tableweb = resolve(process.argv[2] || join(root, '../../tableweb'));
const docs = resolve(process.argv[3] || join(root, '../ttcraft/resources/docs'));
await mkdir(join(root, 'reference/docs'), { recursive: true });
// Capture the exact handler, including chained aliases. This is a reference
// snapshot, not a runtime dependency on a developer's checkout.
const excluded = new Set(['chat', 'chatdm', 'webrtc_offer', 'webrtc_ice', 'identify', 'echo', 'ping', 'thumbput']);
const commands = [];
for (const file of (await readdir(join(tableweb, 'server'))).filter(f => /^commands.*\.cpp$/.test(f))) {
  const source = await readFile(join(tableweb, 'server', file), 'utf8');
  const starts = [...source.matchAll(/^[ \t]*reg\["[^"\n]+"\][ \t]*=/gm)];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const block = source.slice(start, starts[i + 1]?.index ?? source.length);
    const header = block.slice(0, block.indexOf('[](CommandContext') >= 0 ? block.indexOf('[](CommandContext') : 500);
    const names = [...header.matchAll(/reg\["([^"]+)"\]/g)].map(m => m[1]);
    const cap = /CommandSpec\{Cap::(\w+)/.exec(header)?.[1] || 'Play';
    const fields = [...new Set([...block.matchAll(/msg\.(?:value|contains|find|at)\("([^"]+)"|msg\["([^"]+)"\]/g)].map(m => m[1] || m[2]))];
    const replies = [...new Set([...block.matchAll(/\{"type", "([^"]+)"\}/g)].map(m => m[1]))];
    for (const name of names) {
      if (excluded.has(name)) continue;
      commands.push({ name, domain: file.replace(/^commands_?|\.cpp$/g, '') || 'core', cap, fields, replies,
        source: `server/${file}`, line: source.slice(0, start).split('\n').length, implementation: block.trim() });
    }
  }
}
commands.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(join(root, 'reference/commands.json'), JSON.stringify(commands, null, 2) + '\n');
const schemaText = await readFile(join(tableweb, 'protocol/schema.mjs'), 'utf8');
await copyFile(join(tableweb, 'protocol/schema.mjs'), join(root, 'reference/schema.mjs'));
const docNames = (await readdir(docs)).filter(f => /^(scripting|table-|vscode|mcp|workbench|getting-started)/.test(f) && f.endsWith('.md'));
for (const name of docNames) await copyFile(join(docs, name), join(root, 'reference/docs', name));
await writeFile(join(root, 'reference/snapshot.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), protocolSha256: createHash('sha256').update(schemaText).digest('hex'),
  commands: commands.length, documents: docNames,
}, null, 2) + '\n');
console.log(`Bundled ${commands.length} commands and ${docNames.length} documents.`);
