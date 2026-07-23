/**
 * triage-takes — sort a pile of generated takes into a publishing pipeline.
 *
 * The generator produced ~2,500 takes; ~40-50 became songs. The rest were
 * rejected one at a time and never revisited. A slice of them failed only on
 * VOCALS while the arrangement landed (→ finished instrumental), and a further
 * slice hold one strong 15-30s passage (→ Short / Status). Neither needs the
 * generator to be working.
 *
 * Usage (all commands are non-destructive; audio is never deleted or moved):
 *
 *   npx tsx scripts/triage-takes.ts scan   --dir ~/takes [--probe]
 *   npx tsx scripts/triage-takes.ts stats
 *   npx tsx scripts/triage-takes.ts next   [--n 5]
 *   npx tsx scripts/triage-takes.ts set    --file <rel-path> --decision instrumental [--note "..."]
 *   npx tsx scripts/triage-takes.ts export --decision instrumental --out queue.txt
 *   npx tsx scripts/triage-takes.ts recipes --out recipes.json
 *
 * --manifest defaults to <dir>/takes-manifest.json and is safe to re-scan: an
 * existing decision is never overwritten, and a file that disappears is flagged
 * `missing` rather than dropped.
 *
 * Identity is the CONTENT HASH, not the path, so renaming or reorganising takes
 * between sittings does NOT orphan their verdicts — the decision follows the
 * audio. Hashing reads every file once per scan (~2 min for 12 GB); pass
 * --no-hash to fall back to path-only matching if you never move files.
 *
 * --probe runs ffprobe/ffmpeg per file for duration + integrated LUFS. It is
 * OPT-IN because it costs seconds per take (hours across 2,450) and triage works
 * fine without it. Reuses the existing pure parser in lib/loudness-measure.
 *
 * SIDECAR RECIPES: if a take has a matching `.txt`/`.json`/`.prompt` beside it,
 * its contents are stored as the take's `recipe`. That text is retained even for
 * discards — the prompt→outcome record is the compounding asset, not the files.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import {
  TAKE_DECISIONS,
  QUEUE_TARGETS,
  emptyManifest,
  mergeScan,
  setDecision,
  stats,
  nextUndecided,
  exportQueue,
  exportRecipes,
  isScannable,
  DERIVED_SUFFIXES,
  type TakeDecision,
  type TriageManifest,
} from '../src/lib/take-triage';
import { parseMeasurement, measureArgs } from '../src/lib/loudness-measure';

const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus']);
const SIDECAR_EXT = ['.txt', '.json', '.prompt'];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (AUDIO_EXT.has(extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
}

function readSidecar(audioPath: string): string | undefined {
  const stem = audioPath.slice(0, -extname(audioPath).length);
  for (const ext of SIDECAR_EXT) {
    if (existsSync(stem + ext)) {
      const text = readFileSync(stem + ext, 'utf8').trim();
      if (text) return text.slice(0, 8000);
    }
  }
  return undefined;
}

/** Content hash — the identity that survives a rename. */
function hashFile(file: string): string | undefined {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('hex');
  } catch {
    return undefined; // unreadable file shouldn't abort a 2,450-file scan
  }
}

/** Duration via ffprobe. Returns undefined rather than throwing — a probe is a nicety. */
function probeDuration(file: string): number | undefined {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const n = Number((r.stdout || '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined;
}

/** Integrated LUFS via the same ffmpeg pass the Music Lab uses. */
function probeLufs(file: string): number | undefined {
  const r = spawnSync('ffmpeg', measureArgs(file), { encoding: 'utf8' });
  try {
    return parseMeasurement(r.stderr || '').metrics.lufs;
  } catch {
    return undefined;
  }
}

function manifestPath(dir?: string): string {
  const explicit = arg('--manifest');
  if (explicit) return resolve(explicit);
  if (!dir) die('need --manifest (or --dir so it can be derived)');
  return join(resolve(dir), 'takes-manifest.json');
}

function load(path: string, root: string): TriageManifest {
  if (!existsSync(path)) return emptyManifest(root);
  const m = JSON.parse(readFileSync(path, 'utf8')) as TriageManifest;
  if (m.version !== 1) die(`unsupported manifest version ${m.version}`);
  return m;
}

function save(path: string, m: TriageManifest): void {
  writeFileSync(path, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

function cmdScan(): void {
  const dir = arg('--dir') ?? die('scan needs --dir <path>');
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) die(`not a directory: ${root}`);
  const mp = manifestPath(dir);
  const before = load(mp, root);

  // Repeatable: --exclude stems --exclude rejects
  const exclude: string[] = [];
  process.argv.forEach((a, i) => { if (a === '--exclude' && process.argv[i + 1]) exclude.push(process.argv[i + 1]); });

  const all = walk(root);
  const files = all.filter((abs) => isScannable(relative(root, abs), exclude));
  const skipped = all.length - files.length;
  if (skipped) console.log(`skipping ${skipped} derived/excluded file(s) — suffixes: ${DERIVED_SUFFIXES.join(', ')}`);

  const probe = has('--probe');
  if (probe) console.log(`probing ${files.length} files (ffprobe + ffmpeg) — this is the slow path…`);

  const hashing = !has('--no-hash');
  if (hashing) console.log(`hashing ${files.length} files (content identity — survives renames)…`);

  const scanned = files.map((abs, i) => {
    if (i % 100 === 0 && i) console.log(`  …${i}/${files.length}`);
    return {
      file: relative(root, abs),
      recipe: readSidecar(abs),
      ...(hashing ? { hash: hashFile(abs) } : {}),
      ...(probe ? { durationSec: probeDuration(abs), lufs: probeLufs(abs) } : {}),
    };
  });

  const merged = mergeScan(before, scanned);
  save(mp, merged);
  const s = stats(merged);
  const added = s.total - before.takes.length;
  // A verdict that moved with its file — worth surfacing, it's the payoff for hashing.
  const moved = merged.takes.filter((t) => {
    const prev = before.takes.find((b) => b.hash && b.hash === t.hash);
    return prev && prev.file !== t.file;
  }).length;
  console.log(`✓ scanned ${files.length} audio files under ${root}`);
  console.log(`  manifest: ${mp}`);
  console.log(`  +${added} new · ${s.decided} already decided · ${s.missing} missing` + (moved ? ` · ${moved} moved (verdict followed)` : ''));
}

function cmdStats(): void {
  const m = load(manifestPath(arg('--dir')), arg('--dir') ?? '');
  const s = stats(m);
  if (!s.total) return console.log('manifest is empty — run `scan --dir <path>` first.');
  console.log(`total ${s.total} · decided ${s.decided} · remaining ${s.remaining}` + (s.missing ? ` · ⚠ missing ${s.missing}` : ''));
  console.log(`progress ${s.progress === null ? '—' : Math.round(s.progress * 100) + '%'}`);
  for (const d of TAKE_DECISIONS) console.log(`  ${d.padEnd(13)} ${s.byDecision[d]}`);
  const inst = s.byDecision.instrumental;
  const hook = s.byDecision.hook;
  if (inst) console.log(`\n→ ${inst} for ${QUEUE_TARGETS.instrumental}`);
  if (hook) console.log(`→ ${hook} for ${QUEUE_TARGETS.hook}`);
}

function cmdNext(): void {
  const m = load(manifestPath(arg('--dir')), arg('--dir') ?? '');
  const n = Math.max(1, Number(arg('--n') ?? 1) || 1);
  const rows = nextUndecided(m, n);
  if (!rows.length) return console.log('nothing left undecided 🎉');
  for (const t of rows) {
    const bits = [t.durationSec ? `${t.durationSec}s` : null, t.lufs !== undefined ? `${t.lufs} LUFS` : null].filter(Boolean);
    console.log(`${join(m.root, t.file)}${bits.length ? `   [${bits.join(' · ')}]` : ''}`);
    if (t.recipe) console.log(`    recipe: ${t.recipe.split('\n')[0].slice(0, 110)}`);
  }
}

function cmdSet(): void {
  const file = arg('--file') ?? die('set needs --file <path-relative-to-root>');
  const decision = (arg('--decision') ?? die(`set needs --decision <${TAKE_DECISIONS.join('|')}>`)) as TakeDecision;
  if (!TAKE_DECISIONS.includes(decision)) die(`unknown decision "${decision}" (expected ${TAKE_DECISIONS.join(' | ')})`);
  const mp = manifestPath(arg('--dir'));
  const m = load(mp, arg('--dir') ?? '');
  // Accept an absolute path too — `next` prints absolute, and retyping is friction.
  const rel = file.startsWith(m.root) ? relative(m.root, file) : file;
  const res = setDecision(m, rel, decision, { note: arg('--note'), now: new Date().toISOString() });
  if (!res.ok) die(res.error);
  save(mp, res.manifest);
  console.log(`✓ ${basename(rel)} → ${decision}`);
}

function cmdExport(): void {
  const decision = (arg('--decision') ?? die('export needs --decision')) as TakeDecision;
  if (!TAKE_DECISIONS.includes(decision)) die(`unknown decision "${decision}"`);
  const m = load(manifestPath(arg('--dir')), arg('--dir') ?? '');
  const rows = exportQueue(m, decision).map((f) => join(m.root, f));
  const out = arg('--out');
  if (out) {
    writeFileSync(out, rows.join('\n') + (rows.length ? '\n' : ''), 'utf8');
    console.log(`✓ ${rows.length} paths → ${out}`);
    if (decision === 'instrumental' || decision === 'hook') console.log(`  feed to: ${QUEUE_TARGETS[decision]}`);
  } else {
    rows.forEach((r) => console.log(r));
  }
}

function cmdRecipes(): void {
  const m = load(manifestPath(arg('--dir')), arg('--dir') ?? '');
  const rows = exportRecipes(m);
  const out = arg('--out') ?? die('recipes needs --out <file.json>');
  writeFileSync(out, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  console.log(`✓ ${rows.length} recipe/verdict records → ${out}`);
  console.log('  This is the part that survives the audio. Keep it even if you delete the files.');
}

const CMDS: Record<string, () => void> = {
  scan: cmdScan,
  stats: cmdStats,
  next: cmdNext,
  set: cmdSet,
  export: cmdExport,
  recipes: cmdRecipes,
};

const cmd = process.argv[2];
if (!cmd || !CMDS[cmd]) {
  console.error(`Usage: npx tsx scripts/triage-takes.ts <${Object.keys(CMDS).join('|')}> [flags]\n`);
  console.error('  scan    --dir <path> [--probe] [--no-hash] [--exclude <substr>]  add files (verdicts survive renames)');
  console.error('  stats                                  progress + queue sizes');
  console.error('  next    [--n 5]                        next undecided take(s) to listen to');
  console.error(`  set     --file <p> --decision <${TAKE_DECISIONS.join('|')}> [--note "..."]`);
  console.error('  export  --decision <d> [--out f]       paths for a batch pipeline');
  console.error('  recipes --out <f.json>                 prompt→outcome dataset (survives the audio)');
  process.exit(1);
}
CMDS[cmd]();
