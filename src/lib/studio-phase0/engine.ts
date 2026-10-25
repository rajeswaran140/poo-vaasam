/**
 * The listening test's audio engine: load sample packs, play a line live, and
 * render a line offline to exactly the stem cut's length.
 *
 * ⚠️ Tone.js and smplr are imported ONLY with `await import()` inside the
 * functions below, never statically, so neither can reach a public page's
 * bundle (a test pins this).
 *
 * Everything runs on NATIVE contexts wrapped by Tone (`new Tone.Context(ctx)`,
 * `new Tone.OfflineContext(offline)`), so a pack decoded once on the live
 * context plays unchanged in an offline render.
 *
 * Decisions from the spec (docs/specs/studio-phase-0-listening-test.md):
 * - Reverb is `Tone.Reverb` (a convolver) with decay 2.0 s and wet 0.2 on every
 *   render. Worklet-based nodes (Tone's FeedbackCombFilter/Freeverb/JCReverb/
 *   BitCrusher, smplr's Reverb) are NOT used: they load a `blob:` worklet the
 *   production `script-src` blocks.
 * - Straight melodic notes play through smplr's Sampler (all keys are MIDI
 *   numbers, so it pitch-shifts between samples). Gamaka notes and percussion
 *   hits play through a small custom voice, because smplr's per-note detune is
 *   fixed for the whole note.
 *
 * Throwaway: removed by the Phase 0 cleanup PR.
 */
import { z } from 'zod';
import { curveForNote } from './gamaka';
import type { LineNotes, Note, PackSpec, Trial } from './model';

export const SAMPLE_RATE = 48000;
export const REVERB = { decay: 2.0, wet: 0.2 } as const;

const packFileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('soundfont'), file: z.string(), licence: z.string(), attribution: z.string() }),
  z.object({
    kind: z.literal('sampler'),
    samples: z.record(z.string(), z.string()),
    licence: z.string(),
    attribution: z.string(),
  }),
]);
export type PackFile = z.infer<typeof packFileSchema>;

export type FetchKey = (key: string) => Promise<ArrayBuffer>;

/** A pack's decoded samples: keys are MIDI numbers as strings, or 'low'/'high' for percussion. */
export interface LoadedPack {
  packId: string;
  buffers: Map<string, AudioBuffer>;
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'Db4' → 61. Null for anything else. */
export function noteNameToMidi(name: string): number | null {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(name);
  if (!m) return null;
  return (Number(m[3]) + 1) * 12 + PITCH[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
}

/**
 * Pull the samples out of a MIDI.js soundfont file (`MIDI.Soundfont.x = {
 * "C4": "data:audio/mp3;base64,…" }`) by pattern. The file is never evaluated.
 */
export function parseMidiJs(text: string): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const re = /"([A-G][b#]?-?\d)"\s*:\s*"data:audio\/[a-z0-9]+;base64,([A-Za-z0-9+/=]+)"/g;
  for (const m of text.matchAll(re)) {
    const midi = noteNameToMidi(m[1]);
    if (midi === null) continue;
    const bin = atob(m[2]);
    out.set(midi, Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return out;
}

const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

/** Fetch a pack's `pack.json` and every sample, and decode each once. */
export async function loadPack(spec: PackSpec, fetchKey: FetchKey, ctx: BaseAudioContext): Promise<LoadedPack> {
  const dir = spec.packKey.slice(0, spec.packKey.lastIndexOf('/') + 1);
  const file = packFileSchema.parse(JSON.parse(text(await fetchKey(spec.packKey))));
  const buffers = new Map<string, AudioBuffer>();
  if (file.kind === 'soundfont') {
    const samples = parseMidiJs(text(await fetchKey(dir + file.file)));
    await Promise.all(
      [...samples].map(async ([midi, bytes]) => {
        buffers.set(String(midi), await ctx.decodeAudioData(bytes.slice().buffer));
      })
    );
  } else {
    await Promise.all(
      Object.entries(file.samples).map(async ([k, f]) => {
        buffers.set(k, await ctx.decodeAudioData(await fetchKey(dir + f)));
      })
    );
  }
  if (buffers.size === 0) throw new Error(`Pack ${spec.packId} has no samples.`);
  return { packId: spec.packId, buffers };
}

/** The nearest pitched sample, with the cents needed to reach `midi`. */
export function noteToSample(pack: LoadedPack, midi: number): { buffer: AudioBuffer; detuneCents: number } {
  let best: number | null = null;
  for (const k of pack.buffers.keys()) {
    const n = Number(k);
    if (!Number.isInteger(n)) continue;
    if (best === null || Math.abs(n - midi) < Math.abs(best - midi)) best = n;
  }
  if (best === null) throw new Error(`Pack ${pack.packId} has no pitched samples.`);
  return { buffer: pack.buffers.get(String(best))!, detuneCents: (midi - best) * 100 };
}

/** Percussion: below MIDI 60 is the low stroke, otherwise the high one (the dev box writes 48 and 72). */
export function percussionSample(pack: LoadedPack, midi: number): AudioBuffer {
  const b = pack.buffers.get(midi < 60 ? 'low' : 'high');
  if (!b) throw new Error(`Pack ${pack.packId} has no ${midi < 60 ? 'low' : 'high'} stroke.`);
  return b;
}

const isPercussion = (pack: LoadedPack) => pack.buffers.has('low');

/** One sample voice: 10 ms fades, optional detune curve. Returns its stop. */
function voice(
  ctx: BaseAudioContext,
  out: AudioNode,
  buffer: AudioBuffer,
  at: number,
  dur: number,
  vel: number,
  detuneCents: number,
  curve: Float32Array | null
): () => void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  const level = vel / 127;
  const fade = Math.min(0.01, dur / 4);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + fade);
  g.gain.setValueAtTime(level, at + dur - fade);
  g.gain.linearRampToValueAtTime(0, at + dur);
  src.detune.value = detuneCents;
  if (curve) src.detune.setValueCurveAtTime(curve.map((c) => c + detuneCents), at, dur);
  src.connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
  return () => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  };
}

/** Schedule every note of a line from `t0` on `ctx` into `out`. Returns a stop for all of it. */
async function scheduleLine(
  ctx: BaseAudioContext,
  out: AudioNode,
  line: LineNotes,
  pack: LoadedPack,
  trial: Trial,
  t0: number
): Promise<() => void> {
  const stops: Array<() => void> = [];
  const percussion = isPercussion(pack);
  let sampler: { start: (e: { note: number; velocity: number; time: number; duration: number }) => () => void } | null =
    null;
  if (!percussion) {
    const { Sampler } = await import('smplr');
    const inst = Sampler(ctx, { buffers: Object.fromEntries(pack.buffers), destination: out });
    await inst.load;
    sampler = inst as unknown as typeof sampler;
  }
  const end = t0 + line.durationSec;
  for (const note of line.notes as Note[]) {
    const at = t0 + note.t;
    if (at >= end) continue;
    const dur = Math.min(note.dur, end - at);
    if (percussion) {
      const b = percussionSample(pack, note.midi);
      stops.push(voice(ctx, out, b, at, Math.min(b.duration, end - at), note.vel, 0, null));
      continue;
    }
    const curve = trial.gamaka ? curveForNote(note) : null;
    if (curve) {
      const { buffer, detuneCents } = noteToSample(pack, note.midi);
      stops.push(voice(ctx, out, buffer, at, dur, note.vel, detuneCents, curve));
    } else {
      stops.push(sampler!.start({ note: note.midi, velocity: note.vel, time: at, duration: dur }));
    }
  }
  return () => stops.forEach((s) => s());
}

let live: AudioContext | null = null;

/** The one live AudioContext (48 kHz), shared with Tone. Create it from a click. */
export async function liveContext(): Promise<AudioContext> {
  if (!live) {
    live = new AudioContext({ sampleRate: SAMPLE_RATE });
    const Tone = await import('tone');
    Tone.setContext(new Tone.Context(live));
  }
  await live.resume();
  return live;
}

/**
 * Play a line on the live context through Tone's Transport (this is the path
 * that starts Tone's clock Worker, so it is what proves the /admin CSP).
 */
export async function playLive(line: LineNotes, pack: LoadedPack, trial: Trial): Promise<() => void> {
  const ctx = await liveContext();
  const Tone = await import('tone');
  const reverb = new Tone.Reverb(REVERB).toDestination();
  await reverb.ready;
  const bus = ctx.createGain();
  Tone.connect(bus, reverb);
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  let stopNotes: (() => void) | null = null;
  transport.scheduleOnce((time) => {
    void scheduleLine(ctx, bus, line, pack, trial, time).then((s) => (stopNotes = s));
  }, 0);
  transport.start();
  return () => {
    transport.stop();
    transport.cancel();
    stopNotes?.();
    setTimeout(() => {
      bus.disconnect();
      reverb.dispose();
    }, 3000);
  };
}

/** Render a line offline: 48 kHz stereo, exactly `line.durationSec` long. */
export async function renderLine(line: LineNotes, pack: LoadedPack, trial: Trial): Promise<Float32Array[]> {
  const Tone = await import('tone');
  const frames = Math.round(line.durationSec * SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  const toneOffline = new Tone.OfflineContext(offline);
  const previous = Tone.getContext();
  Tone.setContext(toneOffline);
  try {
    const reverb = new Tone.Reverb(REVERB).toDestination();
    await reverb.ready;
    const bus = offline.createGain();
    Tone.connect(bus, reverb);
    await scheduleLine(offline, bus, line, pack, trial, 0);
    const rendered = await toneOffline.render(false);
    const channels = rendered.toArray();
    return Array.isArray(channels) ? channels : [channels, channels];
  } finally {
    Tone.setContext(previous);
  }
}
