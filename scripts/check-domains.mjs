// Compares the content_scripts matches in manifest.json with Google's published
// domain list. Run: npm run check-domains (needs network). Exit code 1 on drift.
import { readFileSync } from 'node:fs';

const SOURCE = 'https://www.google.com/supported_domains';
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const official = (await (await fetch(SOURCE)).text()).split('\n').map((l) => l.trim()).filter(Boolean);
const entries = manifest.content_scripts.map((cs) => new Set(cs.matches.map((p) => {
  const m = /^https:\/\/\*(\.google\.[a-z.]+)\/maps\*$/.exec(p);
  if (!m) throw new Error('Unexpected match pattern: ' + p);
  return m[1];
})));
const first = entries[0];
for (const [i, set] of entries.entries()) {
  if (set.size !== first.size || [...set].some((d) => !first.has(d))) throw new Error('content_scripts entry ' + i + ' differs from entry 0');
}
const missing = official.filter((d) => !first.has(d));
const extra = [...first].filter((d) => !official.includes(d));
console.log(`manifest: ${first.size} domains, ${SOURCE}: ${official.length} domains`);
if (missing.length) console.log('missing in manifest:', missing.join(' '));
if (extra.length) console.log('not in Google\'s list:', extra.join(' '));
if (!missing.length && !extra.length) console.log('OK: lists are identical');
process.exit(missing.length || extra.length ? 1 : 0);
