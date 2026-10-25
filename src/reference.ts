import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export type Json = Record<string, any>;
export interface Command { name: string; domain: string; cap: string; fields: string[]; replies: string[]; source: string; line: number; implementation: string; }
const root = fileURLToPath(new URL('../reference/', import.meta.url));
export const commands: Command[] = JSON.parse(await readFile(join(root, 'commands.json'), 'utf8'));
export const commandMap = new Map(commands.map(c => [c.name, c]));
const docsDir = join(root, 'docs');
export const docNames = (await readdir(docsDir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));

export async function readDoc(slug: string, offset = 0, limit = 16000): Promise<Json> {
  if (!docNames.includes(slug)) throw new Error(`Unknown document. Available: ${docNames.join(', ')}`);
  const text = await readFile(join(docsDir, slug + '.md'), 'utf8');
  return { slug, text: text.slice(offset, offset + limit), total_characters: text.length, next_offset: offset + limit < text.length ? offset + limit : null };
}
export async function searchDocs(query: string): Promise<Json[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return docNames.map(slug => ({ slug }));
  const results: Json[] = [];
  for (const slug of docNames) {
    const text = await readFile(join(docsDir, slug + '.md'), 'utf8');
    const lines = text.split('\n');
    let score = 0;
    const matches: Json[] = [];
    for (let i = 0, offset = 0; i < lines.length; offset += lines[i++].length + 1) {
      if (terms.every(t => lines[i].toLowerCase().includes(t))) {
        score++;
        if (matches.length < 5) matches.push({ line: i + 1, offset, text: lines.slice(Math.max(0, i - 1), i + 3).join('\n').slice(0, 1500) });
      }
    }
    if (score) results.push({ slug, score, matches });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 12);
}
