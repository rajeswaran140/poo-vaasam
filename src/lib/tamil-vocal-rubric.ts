/**
 * Tamil vocal-quality rubric — scoring an AI singing engine on the things that
 * actually break in Tamil, rather than on "does it sound good".
 *
 * WHY A SPECIFIC RUBRIC. Research (2026-07-22) found that no vendor publishes
 * Tamil support, no benchmark evaluates any lyrics-to-song model on Tamil, and
 * the entire public first-person corpus is a single 2024 blog post. So there is
 * no external evidence to lean on — the only way to answer "which engine sings
 * my Tamil acceptably" is to measure it, and a generic 0-10 "vocals" score can't
 * distinguish "pretty but mispronounced" from "plain but correct". These axes
 * are the failure modes a Tamil listener hears immediately:
 *
 *  - RETROFLEX: ழ / ள / ல are three distinct phonemes that non-Tamil models
 *    collapse into one L-ish sound (வாழை fruit / வாளை fish / வாலை tail).
 *  - VOWEL LENGTH: குறில் vs நெடில் is meaning-bearing, not ornament
 *    (கல் stone / கால் leg). Models trained on English routinely flatten it.
 *  - WORD BOUNDARY: engines break words at musically convenient points,
 *    splitting a word across a breath and destroying it.
 *  - GEMINATION: doubled consonants carry meaning (படி step / பட்டி pen).
 *  - PROSODY: the emotional stress graph — the thing a poet notices last but
 *    minds most, and the axis the 2024 report said was weakest.
 *
 * Pure and deterministic so it's unit-testable and the scoring is reproducible.
 * Scores are 0-4 with explicit anchors, because a 0-10 scale invites meaningless
 * precision from a human ear on a single listen.
 */

export type TamilVocalAxis =
  | 'retroflex'
  | 'vowelLength'
  | 'wordBoundary'
  | 'gemination'
  | 'prosody';

export interface AxisSpec {
  key: TamilVocalAxis;
  label: string;
  /** Why this axis matters — shown next to the input so scoring stays consistent. */
  why: string;
  /** Minimal pairs to listen for. Linguistic reference words, not lyrics. */
  probes: string[];
  /** 0-4 anchors, index = score. */
  anchors: [string, string, string, string, string];
  /**
   * Relative weight in the composite. Intelligibility-breaking axes outweigh
   * aesthetic ones: a beautiful take that says the wrong word is unusable,
   * whereas flat prosody is a take you can still release.
   */
  weight: number;
}

export const TAMIL_VOCAL_AXES: AxisSpec[] = [
  {
    key: 'retroflex',
    label: 'Retroflex distinction (ழ / ள / ல)',
    why: 'Three separate phonemes most non-Tamil models collapse into one. Changes the word outright.',
    probes: ['வாழை / வாளை / வாலை', 'தமிழ்', 'ஆழம் / ஆளம்'],
    anchors: [
      'All three collapse into one sound',
      'ல correct; ழ and ள indistinguishable',
      'ழ attempted but inconsistent across the line',
      'All three distinct, occasional slip',
      'All three consistently distinct',
    ],
    weight: 3,
  },
  {
    key: 'vowelLength',
    label: 'Vowel length (குறில் / நெடில்)',
    why: 'Meaning-bearing, not ornamental. Flattening it changes the word.',
    probes: ['கல் / கால்', 'படி / பாடி', 'மனம் / மானம்'],
    anchors: [
      'Length ignored throughout',
      'Length audible only where the melody happens to hold the note',
      'Roughly right on stressed syllables, lost elsewhere',
      'Correct with occasional shortening',
      'Consistently correct, independent of the melody',
    ],
    weight: 3,
  },
  {
    key: 'wordBoundary',
    label: 'Word-boundary integrity',
    why: 'Engines breathe at musically convenient points and split words in half.',
    probes: ['listen for a breath or beat inserted mid-word'],
    anchors: [
      'Words routinely split across breaths',
      'Several words broken',
      'One or two broken words',
      'Boundaries respected, phrasing slightly odd',
      'Clean boundaries and natural phrasing',
    ],
    weight: 2,
  },
  {
    key: 'gemination',
    label: 'Consonant gemination (single vs doubled)',
    why: 'Doubled consonants are meaning-bearing.',
    probes: ['படி / பட்டி', 'கொடி / கொட்டி'],
    anchors: [
      'No distinction at all',
      'Rarely distinguished',
      'Sometimes distinguished',
      'Usually distinguished',
      'Consistently distinguished',
    ],
    weight: 2,
  },
  {
    key: 'prosody',
    label: 'Emotional prosody / stress graph',
    why: 'Where the line breathes and leans. Weakest axis in the only prior Tamil report.',
    probes: ['does the emphasis land where the meaning sits?'],
    anchors: [
      'Flat or actively wrong emphasis',
      'Mechanical, meaning ignored',
      'Generic musical phrasing, meaning-neutral',
      'Emphasis mostly follows the meaning',
      'Phrasing a Tamil singer would recognise',
    ],
    weight: 1,
  },
];

export const MAX_AXIS_SCORE = 4;

export type TamilVocalScores = Partial<Record<TamilVocalAxis, number>>;

export interface RubricResult {
  /** Weighted 0-100 composite, or null when nothing has been scored. */
  composite: number | null;
  /** Axes scored so far / total. */
  scored: number;
  total: number;
  /**
   * Intelligibility sub-score (retroflex + vowelLength + gemination) 0-100.
   * Separated because these decide whether a take is USABLE; prosody decides
   * whether it's good. A high composite masking a broken intelligibility score
   * is the exact mistake this rubric exists to prevent.
   */
  intelligibility: number | null;
  /** Plain verdict derived from the sub-scores — never from composite alone. */
  verdict: 'unusable' | 'needs-work' | 'releasable' | null;
}

const INTELLIGIBILITY_AXES: TamilVocalAxis[] = ['retroflex', 'vowelLength', 'gemination'];

function weightedPct(scores: TamilVocalScores, axes: AxisSpec[]): number | null {
  let got = 0;
  let max = 0;
  for (const a of axes) {
    const v = scores[a.key];
    if (typeof v !== 'number') continue;
    got += v * a.weight;
    max += MAX_AXIS_SCORE * a.weight;
  }
  return max ? Math.round((got / max) * 100) : null;
}

/**
 * Score a take. `verdict` is gated on intelligibility, not the composite:
 * a take can only be 'releasable' if the meaning-bearing axes hold up, however
 * pretty the rest is.
 */
export function scoreTamilVocal(scores: TamilVocalScores): RubricResult {
  const composite = weightedPct(scores, TAMIL_VOCAL_AXES);
  const intelligibility = weightedPct(
    scores,
    TAMIL_VOCAL_AXES.filter((a) => INTELLIGIBILITY_AXES.includes(a.key))
  );
  const scored = TAMIL_VOCAL_AXES.filter((a) => typeof scores[a.key] === 'number').length;

  let verdict: RubricResult['verdict'] = null;
  if (intelligibility != null && composite != null) {
    if (intelligibility < 50) verdict = 'unusable';
    else if (intelligibility < 75 || composite < 65) verdict = 'needs-work';
    else verdict = 'releasable';
  }

  return { composite, scored, total: TAMIL_VOCAL_AXES.length, intelligibility, verdict };
}

/**
 * Deterministic blind-labelling for a set of takes.
 *
 * Scoring your own takes while knowing which engine produced them is how you
 * confirm what you already believe. This assigns opaque labels (A, B, C…) in a
 * seeded shuffle so the listening pass is blind, while the mapping stays
 * recoverable afterwards. Seeded rather than Math.random so a test can assert
 * it, and so a run is reproducible if you need to re-derive the key.
 */
export function blindLabels<T>(takes: T[], seed = 1): { label: string; take: T }[] {
  const idx = takes.map((_, i) => i);
  // Lehmer / park-miller LCG — tiny, deterministic, good enough for shuffling.
  let s = (seed % 2147483646) + 1;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.map((original, position) => ({
    label: String.fromCharCode(65 + position),
    take: takes[original],
  }));
}
