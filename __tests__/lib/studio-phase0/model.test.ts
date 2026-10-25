/** @jest-environment node */
/**
 * Composition Studio Phase 0: the blind listening test's rules. Fixtures use
 * invented keys and notes only (the repo is public).
 */
import {
  PHASE0_PREFIX,
  buildTrials,
  newSession,
  addRating,
  isRevealed,
  verdict,
  parseManifest,
  resultsSchema,
  type Manifest,
  type Results,
  type Trial,
} from '@/lib/studio-phase0/model';

const line = (lineId: string, instrument: 'flute' | 'violin' | 'percussion') => ({
  lineId,
  instrument,
  stemKey: `${PHASE0_PREFIX}lines/${lineId}/stem.wav`,
  notesKey: `${PHASE0_PREFIX}lines/${lineId}/notes.json`,
  durationSec: 10,
  spanStartSec: 0,
});
const pack = (packId: string, instrument: 'flute' | 'violin' | 'percussion') => ({
  packId,
  instrument,
  packKey: `audio/mastering/studio-samples/${packId}/pack.json`,
});

const MANIFEST: Manifest = {
  version: 1,
  lines: [
    line('F1', 'flute'), line('F2', 'flute'), line('F3', 'flute'),
    line('V1', 'violin'), line('V2', 'violin'), line('V3', 'violin'),
    line('P1', 'percussion'), line('P2', 'percussion'),
  ],
  packs: [
    pack('fluidr3-flute', 'flute'), pack('vsco2-flute', 'flute'),
    pack('fluidr3-violin', 'violin'), pack('vsco2-violin', 'violin'),
    pack('vcsl-frame-drum', 'percussion'), pack('vcsl-darbuka', 'percussion'),
  ],
};
const SEED = '0123456789abcdef';
const NOW = new Date('2026-10-26T10:00:00Z');

describe('buildTrials', () => {
  it('returns 18 trials for the Phase 0 manifest', () => {
    const trials = buildTrials(MANIFEST);
    expect(trials).toHaveLength(18);
    const ids = trials.map((t) => t.trialId);
    expect(new Set(ids).size).toBe(18);
    expect(ids).toEqual(expect.arrayContaining([
      'F1-fluidr3-flute', 'F1-vsco2-flute', 'V3-vsco2-violin', 'P2-vcsl-darbuka',
      'F1-vsco2-flute-gamaka', 'V1-vsco2-violin-gamaka',
    ]));
    expect(trials.filter((t) => t.gamaka).map((t) => t.trialId).sort()).toEqual(
      ['F1-vsco2-flute-gamaka', 'V1-vsco2-violin-gamaka']
    );
    expect(trials.filter((t) => t.instrument === 'percussion')).toHaveLength(4);
  });
});

describe('newSession', () => {
  const trials = buildTrials(MANIFEST);

  it('is deterministic for a seed and is a permutation', () => {
    const a = newSession(trials, SEED);
    const b = newSession(trials, SEED);
    expect(a).toEqual(b);
    expect([...a.order].sort()).toEqual(trials.map((t) => t.trialId).sort());
    expect(newSession(trials, 'fedcba9876543210').order).not.toEqual(a.order);
    expect(a.seed).toBe(SEED);
  });

  it('assigns sides that are not all equal and starts every trial unrated', () => {
    const s = newSession(trials, SEED);
    const sides = Object.values(s.trials).map((r) => r.renderSide);
    expect(new Set(sides)).toEqual(new Set(['A', 'B']));
    for (const r of Object.values(s.trials)) {
      expect(r).toMatchObject({ renderKey: null, renderLufs: null, stemLufs: null, ratings: [] });
    }
  });
});

describe('ratings', () => {
  const trials = buildTrials(MANIFEST);
  const id = 'F1-vsco2-flute';

  it('isRevealed is false until the first rating, then true', () => {
    let s = newSession(trials, SEED);
    expect(isRevealed(s, id)).toBe(false);
    s = addRating(s, id, { renderScore: 3, sunoScore: 4, guess: 'A', note: '' }, NOW);
    expect(isRevealed(s, id)).toBe(true);
  });

  it('marks every rating after the first as revised and keeps the first', () => {
    let s = newSession(trials, SEED);
    s = addRating(s, id, { renderScore: 2, sunoScore: 4, guess: 'A', note: 'thin' }, NOW);
    s = addRating(s, id, { renderScore: 3, sunoScore: 4, guess: 'A', note: '' }, NOW);
    expect(s.trials[id].ratings).toHaveLength(2);
    expect(s.trials[id].ratings[0]).toMatchObject({ renderScore: 2, revised: false, at: NOW.toISOString() });
    expect(s.trials[id].ratings[1]).toMatchObject({ renderScore: 3, revised: true });
  });

  it('does not mutate the session it was given', () => {
    const s = newSession(trials, SEED);
    addRating(s, id, { renderScore: 3, sunoScore: 3, guess: 'unsure', note: '' }, NOW);
    expect(s.trials[id].ratings).toEqual([]);
  });
});

describe('verdict', () => {
  const trials = buildTrials(MANIFEST);
  /** Rate trials by id → [render, suno]; sides as the session drew them. */
  function rated(scores: Record<string, [number, number]>, guessSuno = true): Results {
    let s = newSession(trials, SEED);
    for (const [id, [r, su]] of Object.entries(scores)) {
      const sunoSide = s.trials[id].renderSide === 'A' ? 'B' : 'A';
      s = addRating(s, id, {
        renderScore: r as 1, sunoScore: su as 1, guess: guessSuno ? sunoSide : 'unsure', note: '',
      }, NOW);
    }
    return s;
  }

  it('a line passes at renderScore ≥ 3; a source passes with 2 of 3 lines', () => {
    const v = verdict(rated({ 'F1-vsco2-flute': [3, 4], 'F2-vsco2-flute': [4, 4], 'F3-vsco2-flute': [2, 4] }), trials);
    expect(v.byPack['vsco2-flute'].pass).toBe(true);
    const w = verdict(rated({ 'F1-vsco2-flute': [3, 4], 'F2-vsco2-flute': [2, 4], 'F3-vsco2-flute': [2, 4] }), trials);
    expect(w.byPack['vsco2-flute'].pass).toBe(false);
  });

  it('a source with 2 lines needs both', () => {
    expect(verdict(rated({ 'P1-vcsl-darbuka': [3, 4], 'P2-vcsl-darbuka': [2, 4] }), trials)
      .byPack['vcsl-darbuka'].pass).toBe(false);
    expect(verdict(rated({ 'P1-vcsl-darbuka': [3, 4], 'P2-vcsl-darbuka': [5, 4] }), trials)
      .byPack['vcsl-darbuka'].pass).toBe(true);
  });

  it('excludes a line whose Suno stem scored below 3', () => {
    const v = verdict(rated({ 'F1-vsco2-flute': [1, 2], 'F2-vsco2-flute': [3, 4], 'F3-vsco2-flute': [3, 4] }), trials);
    expect(v.byPack['vsco2-flute'].lines.find((l) => l.lineId === 'F1')).toMatchObject({ excluded: true });
    expect(v.byPack['vsco2-flute'].pass).toBe(true);
  });

  it('a source with every line excluded has no verdict (null), not a fail', () => {
    const v = verdict(rated({ 'P1-vcsl-darbuka': [1, 2], 'P2-vcsl-darbuka': [1, 1] }), trials);
    expect(v.byPack['vcsl-darbuka'].pass).toBeNull();
    expect(v.byInstrument.percussion.pass).toBeNull();
  });

  it('uses the latest rating of a revised trial', () => {
    let s = rated({ 'P1-vcsl-darbuka': [2, 4], 'P2-vcsl-darbuka': [3, 4] });
    s = addRating(s, 'P1-vcsl-darbuka', { renderScore: 3, sunoScore: 4, guess: 'unsure', note: '' }, NOW);
    expect(verdict(s, trials).byPack['vcsl-darbuka'].pass).toBe(true);
  });

  it('an instrument passes if either source passes, and passedWith lists which', () => {
    const v = verdict(rated({
      'F1-fluidr3-flute': [1, 4], 'F2-fluidr3-flute': [1, 4], 'F3-fluidr3-flute': [1, 4],
      'F1-vsco2-flute': [4, 4], 'F2-vsco2-flute': [4, 4], 'F3-vsco2-flute': [4, 4],
    }), trials);
    expect(v.byInstrument.flute).toEqual({ pass: true, passedWith: ['vsco2-flute'] });
  });

  it('gamaka trials never count toward byPack and are reported beside the straight render', () => {
    const v = verdict(rated({
      'F1-vsco2-flute': [4, 4], 'F2-vsco2-flute': [2, 4], 'F3-vsco2-flute': [2, 4],
      'F1-vsco2-flute-gamaka': [5, 4],
    }), trials);
    expect(v.byPack['vsco2-flute'].pass).toBe(false);
    expect(v.byPack['vsco2-flute'].lines).toHaveLength(3);
    expect(v.gamaka).toEqual(expect.arrayContaining([{ lineId: 'F1', straight: 4, gamaka: 5 }]));
    expect(v.gamaka.find((g) => g.lineId === 'V1')).toEqual({ lineId: 'V1', straight: null, gamaka: null });
  });

  it('phase0Pass needs at least 2 of 3 instruments passing', () => {
    const good = (ids: string[]) => Object.fromEntries(ids.map((i) => [i, [4, 4] as [number, number]]));
    const flute = ['F1-vsco2-flute', 'F2-vsco2-flute', 'F3-vsco2-flute'];
    const violin = ['V1-vsco2-violin', 'V2-vsco2-violin', 'V3-vsco2-violin'];
    expect(verdict(rated(good(flute)), trials).phase0Pass).toBe(false);
    expect(verdict(rated(good([...flute, ...violin])), trials).phase0Pass).toBe(true);
  });

  it('counts Suno hits as guesses naming the side that was NOT the render', () => {
    const scores = { 'F1-vsco2-flute': [3, 4] as [number, number], 'F2-vsco2-flute': [3, 4] as [number, number] };
    expect(verdict(rated(scores, true), trials).suno).toEqual({ hits: 2, total: 2 });
    expect(verdict(rated(scores, false), trials).suno).toEqual({ hits: 0, total: 2 });
  });
});

describe('parseManifest', () => {
  it('accepts the Phase 0 manifest', () => {
    expect(parseManifest(MANIFEST)).toEqual({ ok: true, value: MANIFEST });
  });

  it.each([
    ['a stemKey outside the Phase 0 prefix', { ...MANIFEST, lines: [{ ...MANIFEST.lines[0], stemKey: 'audio/songs/x.wav' }] }],
    ['a packKey outside studio-samples', { ...MANIFEST, packs: [{ ...MANIFEST.packs[0], packKey: 'audio/x/pack.json' }] }],
    ['durationSec ≤ 0', { ...MANIFEST, lines: [{ ...MANIFEST.lines[0], durationSec: 0 }] }],
    ['an unknown instrument', { ...MANIFEST, lines: [{ ...MANIFEST.lines[0], instrument: 'veena' }] }],
    ['a key with ..', { ...MANIFEST, lines: [{ ...MANIFEST.lines[0], notesKey: `${PHASE0_PREFIX}../x.json` }] }],
  ])('rejects %s', (_label, bad) => {
    expect(parseManifest(bad).ok).toBe(false);
  });
});

describe('resultsSchema', () => {
  const trials: Trial[] = buildTrials(MANIFEST);
  const ok = addRating(newSession(trials, SEED), 'F1-vsco2-flute',
    { renderScore: 3, sunoScore: 4, guess: 'B', note: 'fine' }, NOW);

  it('accepts a real session', () => {
    expect(resultsSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects a score outside 1–5 and a note over 200 characters', () => {
    const r = ok.trials['F1-vsco2-flute'].ratings[0];
    const withRating = (rating: object) => ({
      ...ok, trials: { ...ok.trials, 'F1-vsco2-flute': { ...ok.trials['F1-vsco2-flute'], ratings: [rating] } },
    });
    expect(resultsSchema.safeParse(withRating({ ...r, renderScore: 6 })).success).toBe(false);
    expect(resultsSchema.safeParse(withRating({ ...r, note: 'x'.repeat(201) })).success).toBe(false);
  });
});
