import { readFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', output), 'utf8');
const initial = new Set([...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(match => match[1]));
if (!initial.size) throw new Error('Production entry was not found.');
let bytes = 0;
for (const path of initial) {
  if (!path.startsWith('/assets/') || path.includes('..')) throw new Error('Unexpected production entry path.');
  bytes += (await readFile(new URL(path.slice(1), output))).byteLength;
}
const budget = 400_000;
if (bytes > budget) throw new Error(`Initial JavaScript is ${bytes} bytes; budget is ${budget}.`);
console.log(`Initial JavaScript: ${(bytes / 1000).toFixed(1)} kB / ${budget / 1000} kB budget (entry and module preloads).`);
