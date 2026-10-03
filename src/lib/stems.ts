/**
 * Stems — the separate parts (vocals, drums, bass…) TamilAgaval Music exports
 * for a song. One set per saved master, kept under that master's own folder in
 * the mastering workspace so every existing guard (isMasteringKey, the upload
 * policy, the worker's role) applies unchanged.
 *
 * ⚠️ The stems are resynthesised approximations, not extractions (measured
 * 2026-09-19): their sum is NOT the original record. A remix is a new version.
 */
import { MASTERING_PREFIX } from '@/lib/mastering-storage';
import type { StemSet } from '@/types/stemSet';

export const STEMS_PREFIX = `${MASTERING_PREFIX}stems/`;

/** The master route mints UUIDs. Anything path-like is refused. */
export function isValidMasterJobId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

export function stemFolderFor(masterJobId: string): string {
  return `${STEMS_PREFIX}${masterJobId}/`;
}

function safeBase(filename: string): string {
  return (
    filename
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'stem'
  );
}

/** Timestamp + nonce: the same file name uploaded twice is two stems, never one overwritten. */
export function stemUploadKey(masterJobId: string, filename: string, now: number, nonce: string): string {
  return `${stemFolderFor(masterJobId)}${now}_${nonce}_${safeBase(filename)}.wav`;
}

/** The key's base name — unique per upload, and a valid DynamoDB map key. */
export function stemIdFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1).replace(/\.wav$/i, '');
}

/** A full-quality stem WAV directly in THIS master's folder — not a preview, not a remix, not elsewhere. */
export function isStemKeyFor(masterJobId: string, key: string): boolean {
  if (!isValidMasterJobId(masterJobId) || typeof key !== 'string' || key.includes('..')) return false;
  const folder = stemFolderFor(masterJobId);
  if (!key.startsWith(folder)) return false;
  const rest = key.slice(folder.length);
  return /^[A-Za-z0-9_-]{1,120}\.wav$/i.test(rest);
}

export function stemPreviewKey(stemKey: string): string {
  const slash = stemKey.lastIndexOf('/');
  return `${stemKey.slice(0, slash)}/preview/${stemIdFromKey(stemKey)}.m4a`;
}

/** Never contains "-master": the master route refuses mastering outputs as sources. */
export function stemRemixKey(masterJobId: string, now: number): string {
  return `${stemFolderFor(masterJobId)}remix/${now}-remix.wav`;
}

/** "2_Drums.wav" → "Drums"; "01 - Lead Vocals.WAV" → "Lead Vocals". */
export function guessStemName(filename: string): string {
  const name = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\s*\d+\s*[-_.)\s]+\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return name || 'Stem';
}

/** The fader's range: −60 plays as silence and renders as a muted stem; +6 is the loudest a stem may be pushed. */
export const MIN_GAIN_DB = -60;
export const MAX_GAIN_DB = 6;

export interface RemixInput {
  stemId: string;
  key: string;
  name: string;
  gainDb: number;
  sampleRate: number | null;
  durationSec: number | null;
}

export type RemixPlan =
  | { ok: true; inputs: RemixInput[]; longestSec: number | null; notes: string[] }
  | { ok: false; message: string };

const khz = (hz: number) => `${Number((hz / 1000).toFixed(1))} kHz`;

/** Turns a saved stem set's mix (levels, mutes) into the ordered, clamped list of inputs a remix render will use. */
export function planRemix(set: StemSet): RemixPlan {
  const inputs: RemixInput[] = [];
  for (const id of set.order) {
    const s = set.stems[id];
    if (!s) continue;
    const m = set.mix[id] ?? { gainDb: 0, muted: false };
    const gainDb = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, m.gainDb));
    if (m.muted || gainDb <= MIN_GAIN_DB) continue;
    inputs.push({ stemId: id, key: s.key, name: s.name, gainDb, sampleRate: s.sampleRate, durationSec: s.durationSec });
  }
  if (inputs.length === 0) return { ok: false, message: 'Every stem is muted — unmute at least one to render a remix.' };

  const lengths = inputs.map((i) => i.durationSec).filter((d): d is number => typeof d === 'number');
  const longestSec = lengths.length ? Math.max(...lengths) : null;

  const notes: string[] = [];
  for (const i of inputs) {
    if (i.sampleRate && i.sampleRate !== 48000) notes.push(`${i.name} resampled from ${khz(i.sampleRate)} to 48 kHz`);
    if (longestSec !== null && i.durationSec !== null && longestSec - i.durationSec > 0.1) {
      notes.push(`${i.name} padded by ${(longestSec - i.durationSec).toFixed(1)} s to match the longest stem`);
    }
  }
  return { ok: true, inputs, longestSec, notes };
}

/**
 * ⚠️ normalize=0 — amix's default divides each input by the input count, so
 * eleven stems at 0 dB would come out ~21 dB down. Float output keeps a sum
 * above full scale for mastering to bring down. No -shortest: nothing but
 * `-t` may trim the mix.
 *
 * `durationSec` controls padding and the output bound together, because the
 * two must agree: `apad` pads forever, so a padded chain needs `-t` on the
 * output or the render never ends. Pass a number (the plan's `longestSec`)
 * to pad every chain to that length and stop the render there. Pass
 * null/undefined to omit `apad` from every chain entirely — an unpadded
 * `amix duration=longest` already ends on its own, with the longest input.
 */
export function buildRemixArgs(p: {
  inputs: Array<{ path: string; gainDb: number; sampleRate: number | null }>;
  outPath: string;
  durationSec?: number | null;
}): string[] {
  const padded = typeof p.durationSec === 'number';
  const chains = p.inputs.map((inp, n) => {
    const steps: string[] = [];
    if (inp.sampleRate !== null && inp.sampleRate !== 48000) steps.push('aresample=48000');
    if (inp.gainDb !== 0) steps.push(`volume=${inp.gainDb}dB`);
    if (padded) steps.push('apad');
    if (steps.length === 0) steps.push('anull');
    return `[${n}:a]${steps.join(',')}[s${n}]`;
  });
  const labels = p.inputs.map((_, n) => `[s${n}]`).join('');
  const filter = `${chains.join(';')};${labels}amix=inputs=${p.inputs.length}:normalize=0:duration=longest[m]`;
  const args = [
    '-hide_banner', '-nostats',
    ...p.inputs.flatMap((i) => ['-i', i.path]),
    '-filter_complex', filter,
    '-map', '[m]',
  ];
  if (padded) args.push('-t', String(p.durationSec));
  args.push('-c:a', 'pcm_f32le', '-ar', '48000', '-y', p.outPath);
  return args;
}
