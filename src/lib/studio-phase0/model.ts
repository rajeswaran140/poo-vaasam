/**
 * Composition Studio Phase 0: the blind listening test's data and rules.
 *
 * Raj compares a sample render of a short line against the same line of the
 * Suno stem, blind and loudness-matched, and scores both. This module is pure
 * (no Date.now, no crypto): the page passes the seed and the clock in, so a
 * reload rebuilds exactly the same session from `results.json`.
 *
 * Spec: docs/specs/studio-phase-0-listening-test.md. Throwaway: removed by the
 * cleanup PR after the exit report.
 */
import { z } from 'zod';

export const PHASE0_PREFIX = 'audio/mastering/studio/phase0/';
export const SAMPLES_PREFIX = 'audio/mastering/studio-samples/';
export const MANIFEST_KEY = `${PHASE0_PREFIX}manifest.json`;
export const RESULTS_KEY = `${PHASE0_PREFIX}results.json`;

/** Packs whose lines also get a gamaka (pitch-curve) render. */
const GAMAKA = [
  { lineId: 'F1', packId: 'vsco2-flute' },
  { lineId: 'V1', packId: 'vsco2-violin' },
];

const INSTRUMENTS = ['flute', 'violin', 'percussion'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

const keyUnder = (prefix: string) =>
  z.string().max(1024).refine((k) => k.startsWith(prefix) && !k.includes('..'), {
    message: `must be a key under ${prefix}`,
  });

const lineSpecSchema = z.object({
  lineId: z.string().regex(/^[A-Z][0-9]$/),
  instrument: z.enum(INSTRUMENTS),
  stemKey: keyUnder(PHASE0_PREFIX),
  notesKey: keyUnder(PHASE0_PREFIX),
  durationSec: z.number().positive().max(120),
  spanStartSec: z.number().min(0),
});

const packSpecSchema = z.object({
  packId: z.string().regex(/^[a-z0-9-]+$/),
  instrument: z.enum(INSTRUMENTS),
  packKey: keyUnder(SAMPLES_PREFIX),
});

export const manifestSchema = z.object({
  version: z.literal(1),
  lines: z.array(lineSpecSchema).min(1),
  packs: z.array(packSpecSchema).min(1),
});

export const noteSchema = z.object({
  t: z.number().min(0),
  dur: z.number().positive(),
  midi: z.number().int().min(0).max(127),
  vel: z.number().min(0).max(127),
  /** Cents, evenly spaced across `dur`. */
  detuneCurve: z.array(z.number()).optional(),
});

export const lineNotesSchema = z.object({
  lineId: z.string(),
  durationSec: z.number().positive(),
  notes: z.array(noteSchema),
});

export type LineSpec = z.infer<typeof lineSpecSchema>;
export type PackSpec = z.infer<typeof packSpecSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Note = z.infer<typeof noteSchema>;
export type LineNotes = z.infer<typeof lineNotesSchema>;

export interface Trial {
  trialId: string;
  lineId: string;
  instrument: Instrument;
  packId: string;
  gamaka: boolean;
}

const score = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const ratingSchema = z.object({
  renderScore: score,
  sunoScore: score,
  guess: z.enum(['A', 'B', 'unsure']),
  note: z.string().max(200),
  revised: z.boolean(),
  at: z.string(),
});

const trialRecordSchema = z.object({
  renderSide: z.enum(['A', 'B']),
  renderKey: z.string().max(1024).nullable(),
  renderLufs: z.number().nullable(),
  stemLufs: z.number().nullable(),
  ratings: z.array(ratingSchema).max(20),
});

export const resultsSchema = z.object({
  version: z.literal(1),
  seed: z.string().regex(/^[0-9a-f]{8,32}$/),
  order: z.array(z.string()).max(100),
  trials: z.record(z.string(), trialRecordSchema),
});

export type Rating = z.infer<typeof ratingSchema>;
export type TrialRecord = z.infer<typeof trialRecordSchema>;
export type Results = z.infer<typeof resultsSchema>;

export function parseManifest(raw: unknown): { ok: true; value: Manifest } | { ok: false; error: string } {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Manifest is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}` };
  }
  return { ok: true, value: parsed.data };
}

const trialIdOf = (lineId: string, packId: string, gamaka: boolean) =>
  `${lineId}-${packId}${gamaka ? '-gamaka' : ''}`;

/** Every line on every pack of its instrument, plus the gamaka variants. */
export function buildTrials(m: Manifest): Trial[] {
  const trials: Trial[] = [];
  for (const line of m.lines) {
    for (const p of m.packs.filter((p) => p.instrument === line.instrument)) {
      trials.push({ trialId: trialIdOf(line.lineId, p.packId, false), lineId: line.lineId, instrument: line.instrument, packId: p.packId, gamaka: false });
      if (GAMAKA.some((g) => g.lineId === line.lineId && g.packId === p.packId)) {
        trials.push({ trialId: trialIdOf(line.lineId, p.packId, true), lineId: line.lineId, instrument: line.instrument, packId: p.packId, gamaka: true });
      }
    }
  }
  return trials;
}

/** mulberry32: a tiny seeded PRNG, enough to shuffle 18 trials reproducibly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle the trials and draw each one's side, all from the seed. */
export function newSession(trials: Trial[], seedHex: string): Results {
  const rand = mulberry32(parseInt(seedHex.slice(0, 8), 16));
  const order = trials.map((t) => t.trialId);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const records: Record<string, TrialRecord> = {};
  for (const id of order) {
    records[id] = { renderSide: rand() < 0.5 ? 'A' : 'B', renderKey: null, renderLufs: null, stemLufs: null, ratings: [] };
  }
  return { version: 1, seed: seedHex, order, trials: records };
}

/** Append a rating. Every rating after the first is a revision; none is ever dropped. */
export function addRating(
  r: Results,
  trialId: string,
  rating: Omit<Rating, 'revised' | 'at'>,
  now: Date
): Results {
  const record = r.trials[trialId];
  if (!record) throw new Error(`Unknown trial ${trialId}`);
  const next: Rating = { ...rating, revised: record.ratings.length > 0, at: now.toISOString() };
  return { ...r, trials: { ...r.trials, [trialId]: { ...record, ratings: [...record.ratings, next] } } };
}

/** A trial is revealed (A/B mapping shown) once it has any rating. */
export function isRevealed(r: Results, trialId: string): boolean {
  return (r.trials[trialId]?.ratings.length ?? 0) > 0;
}

export interface Verdict {
  byPack: Record<
    string,
    {
      instrument: Instrument;
      pass: boolean | null;
      lines: Array<{ lineId: string; renderScore: number; sunoScore: number; excluded: boolean }>;
    }
  >;
  byInstrument: Record<Instrument, { pass: boolean | null; passedWith: string[] }>;
  gamaka: Array<{ lineId: string; straight: number | null; gamaka: number | null }>;
  suno: { hits: number; total: number };
  phase0Pass: boolean;
}

/** The rating that counts: the latest one (a revision replaces the first). */
const latest = (r: Results, trialId: string): Rating | null => {
  const ratings = r.trials[trialId]?.ratings ?? [];
  return ratings.length ? ratings[ratings.length - 1] : null;
};

/**
 * The spec's verdict rules: a line passes at render ≥ 3; a line is excluded
 * when its Suno stem scored < 3; a source passes when MORE than half of its
 * remaining lines pass (2 of 3, both of 2); an instrument passes when either
 * source does; Phase 0 passes with ≥ 2 of 3 instruments. Gamaka renders are
 * reported beside the straight render and never count.
 */
export function verdict(r: Results, trials: Trial[]): Verdict {
  const byPack: Verdict['byPack'] = {};
  for (const t of trials.filter((t) => !t.gamaka)) {
    const entry = (byPack[t.packId] ??= { instrument: t.instrument, pass: null, lines: [] });
    const rating = latest(r, t.trialId);
    if (!rating) continue;
    entry.lines.push({
      lineId: t.lineId,
      renderScore: rating.renderScore,
      sunoScore: rating.sunoScore,
      excluded: rating.sunoScore < 3,
    });
  }
  for (const entry of Object.values(byPack)) {
    const counted = entry.lines.filter((l) => !l.excluded);
    entry.pass = counted.length === 0 ? null : counted.filter((l) => l.renderScore >= 3).length > counted.length / 2;
  }

  const byInstrument = {} as Verdict['byInstrument'];
  for (const instrument of INSTRUMENTS) {
    const packs = Object.entries(byPack).filter(([, p]) => p.instrument === instrument);
    const passedWith = packs.filter(([, p]) => p.pass === true).map(([id]) => id);
    const anyVerdict = packs.some(([, p]) => p.pass !== null);
    byInstrument[instrument] = { pass: passedWith.length ? true : anyVerdict ? false : null, passedWith };
  }

  const gamaka = trials
    .filter((t) => t.gamaka)
    .map((t) => ({
      lineId: t.lineId,
      straight: latest(r, trialIdOf(t.lineId, t.packId, false))?.renderScore ?? null,
      gamaka: latest(r, t.trialId)?.renderScore ?? null,
    }));

  let hits = 0;
  let total = 0;
  for (const t of trials) {
    const rating = latest(r, t.trialId);
    if (!rating) continue;
    total++;
    const sunoSide = r.trials[t.trialId].renderSide === 'A' ? 'B' : 'A';
    if (rating.guess === sunoSide) hits++;
  }

  const passing = INSTRUMENTS.filter((i) => byInstrument[i].pass === true).length;
  return { byPack, byInstrument, gamaka, suno: { hits, total }, phase0Pass: passing >= 2 };
}
