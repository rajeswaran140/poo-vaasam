/**
 * Rebuilds src/lib/video-text/google-fonts.json: every Google font the Video
 * Text tool can offer, from Google's public font metadata (no API key).
 *
 * USAGE: npx tsx scripts/update-google-fonts.ts
 *
 * Each entry is [family, category, weight, scripts]:
 * - category: s sans serif, r serif, d display, h handwriting, m monospace
 * - weight: 700 when the font has an upright bold, else its upright weight
 *   nearest to 700 (the canvas draws every part bold where it can)
 * - scripts: 1 English (latin), 2 Tamil, 3 both
 * Fonts with neither script are left out.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CATEGORY: Record<string, string> = {
  'Sans Serif': 's', Serif: 'r', Display: 'd', Handwriting: 'h', Monospace: 'm',
};

interface Meta {
  family: string;
  category: string;
  subsets: string[];
  fonts: Record<string, unknown>;
}

async function main() {
  const res = await fetch('https://fonts.google.com/metadata/fonts', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`metadata: HTTP ${res.status}`);
  const text = await res.text();
  const list = (JSON.parse(text.slice(text.indexOf('{'))) as { familyMetadataList: Meta[] }).familyMetadataList;
  const out: Array<[string, string, number, number]> = [];
  for (const f of list) {
    const scripts = (f.subsets.includes('latin') ? 1 : 0) | (f.subsets.includes('tamil') ? 2 : 0);
    if (!scripts) continue;
    const upright = Object.keys(f.fonts).filter((k) => /^\d+$/.test(k)).map(Number);
    if (upright.length === 0) continue;
    const weight = upright.includes(700) ? 700 : upright.sort((a, b) => Math.abs(a - 700) - Math.abs(b - 700) || b - a)[0];
    if (!/^[A-Za-z0-9 ]{1,64}$/.test(f.family)) continue; // the stored id allows only these
    out.push([f.family, CATEGORY[f.category] ?? 's', weight, scripts]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  const file = join(__dirname, '..', 'src', 'lib', 'video-text', 'google-fonts.json');
  writeFileSync(file, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), fonts: out }) + '\n');
  console.log(`${out.length} fonts (${out.filter((f) => f[3] & 2).length} with Tamil) → ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
