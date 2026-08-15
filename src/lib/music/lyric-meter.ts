/**
 * Lyric Meter Lab — structural analysis of a Tamil lyric line against a meter.
 *
 * Pure and deterministic. No LLM: the poet writes the line, this only measures
 * it ([[feedback_tamilagaval_ai_augments_craft]]).
 *
 * Built on `tamil-prosody.syllabify`, NOT on a second syllable implementation,
 * so the Meter Lab and the Lyric Critic always count the same line the same way.
 *
 * ⚠️ TWO HONESTY RULES, both from the spec and both load-bearing:
 *
 * 1. **Meter cannot be reliably determined from text alone.** A line of six
 *    syllables fits 3/4, 6/8, and a slow 4/4 equally well; only the tune
 *    decides. So anything this module infers is labelled `suggested` and
 *    carries its reasoning, and `MeterSource` distinguishes it from a meter the
 *    poet actually chose. A suggestion presented as a finding is worse than no
 *    suggestion.
 *
 * 2. **Never break a Tamil word to fit a melody.** Beat placement here works in
 *    whole syllables and never splits a word across a phrase boundary it was
 *    not given. Density warnings say "this line is too dense for this tempo" —
 *    the remedy is a different word, not a mangled one.
 */

import { syllabify, countSyllables, type Syllable } from '@/lib/tamil-prosody';
import { type MeterDefinition, pulsesPerBar, barSeconds } from '@/lib/music/meter';

/**
 * Where a piece of composition metadata came from. §24: "user-entered" and
 * "suggested" are not equivalent and must never render identically.
 */
export type Provenance = 'user-entered' | 'calculated' | 'suggested' | 'ai-suggested' | 'verified';

export interface WordUnit {
  /** The word as written — never altered, never split. */
  text: string;
  syllables: Syllable[];
  /** What the parser found. Never changes. */
  automaticSyllableCount: number;
  /**
   * What the SINGER actually sings. Equals the automatic count unless the poet
   * has recorded a manual phrasing for this word.
   *
   * ⚠️ ORTHOGRAPHY IS NOT SUNG SYLLABIFICATION. A word parses to three எழுத்து
   * and may be sung across two notes, or one long vowel stretched over four.
   * The parser reads letters; only the composer knows the tune. So the manual
   * value wins wherever it exists, and everything downstream — density, beats —
   * uses THIS count.
   */
  syllableCount: number;
  /** True when a manual phrasing is overriding the parser for this word. */
  overridden: boolean;
  /** Can the singer hold this word's last note? Open + long = yes. */
  sustainable: boolean;
  /** Index of the word within the line. */
  index: number;
}

/**
 * Manual musical phrasing, keyed by `<lineIndex>:<wordIndex>`.
 *
 * ⚠️ AN ANNOTATION, NOT AN EDIT. The lyric text is never touched — this records
 * how a word is SUNG, alongside the words as written.
 */
export type PhrasingOverrides = Readonly<Record<string, number>>;

/** The key under which a word's manual phrasing is stored. */
export function overrideKey(lineIndex: number, wordIndex: number): string {
  return `${lineIndex}:${wordIndex}`;
}

export interface LinePlan {
  text: string;
  words: WordUnit[];
  syllableCount: number;
  /** Words the singer can comfortably sustain — candidates for a held note. */
  sustainCandidates: WordUnit[];
}

/**
 * Split a line into words with their syllable structure.
 *
 * `lineIndex` and `overrides` are how manual phrasing reaches the words; pass
 * neither and you get the parser's own reading.
 */
export function planLine(text: string, lineIndex = 0, overrides: PhrasingOverrides = {}): LinePlan {
  const words = (text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, index) => {
      const syllables = syllabify(w);
      const last = syllables[syllables.length - 1];
      const automatic = syllables.length;
      const manual = overrides[overrideKey(lineIndex, index)];
      return {
        text: w,
        syllables,
        automaticSyllableCount: automatic,
        syllableCount: typeof manual === 'number' && manual > 0 ? manual : automatic,
        overridden: typeof manual === 'number' && manual > 0 && manual !== automatic,
        // A note can be held on an open long vowel. A closing மெய் clips it,
        // and a short vowel stretched sounds wrong to a Tamil ear.
        sustainable: !!last && last.open && last.vowel === 'long',
        index,
      };
    });

  return {
    text,
    words,
    syllableCount: words.reduce((n, w) => n + w.syllableCount, 0),
    sustainCandidates: words.filter((w) => w.sustainable),
  };
}

export interface LyricLineAnalysis {
  index: number;
  plan: LinePlan;
  density: DensityReading;
  phrases: Phrase[];
}

export interface LyricAnalysis {
  lines: LyricLineAnalysis[];
  /** Stanza-level summary — reported AFTER the lines, never instead of them. */
  totalSyllables: number;
  totalLines: number;
  /** Syllables per line: the spread a lyricist actually cares about. */
  syllablesPerLine: number[];
  /** True when every line carries the same count — a strong metrical signal. */
  evenLines: boolean;
}

/**
 * Analyse a whole lyric, LINE BY LINE.
 *
 * ⚠️ THE STANZA IS NOT ONE PHRASE. Measuring a four-line verse as a single
 * continuous run produced "30 syllables · 11.3/sec · rushed" for a lyric that
 * sings perfectly well, because it ignored every rest, instrumental response
 * and sustained vowel between the lines. Density belongs to a line; the stanza
 * gets a summary, and the summary deliberately carries no density verdict at
 * all.
 */
export function analyzeLyric(
  text: string,
  bpm: number,
  meter: MeterDefinition,
  overrides: PhrasingOverrides = {},
  phraseCount = 2
): LyricAnalysis {
  const rawLines = (text ?? '').split('\n');
  const lines: LyricLineAnalysis[] = [];

  rawLines.forEach((raw, index) => {
    // Blank lines are stanza breaks, not lyric lines.
    if (!raw.trim()) return;
    const plan = planLine(raw, index, overrides);
    if (plan.syllableCount === 0) return;
    lines.push({ index, plan, density: readDensity(plan, bpm, meter), phrases: splitPhrases(plan, phraseCount) });
  });

  const syllablesPerLine = lines.map((l) => l.plan.syllableCount);
  return {
    lines,
    totalSyllables: syllablesPerLine.reduce((a, b) => a + b, 0),
    totalLines: lines.length,
    syllablesPerLine,
    evenLines: syllablesPerLine.length > 1 && new Set(syllablesPerLine).size === 1,
  };
}

export interface Phrase {
  label: string;
  words: WordUnit[];
  text: string;
  syllableCount: number;
}

/**
 * Split a line into phrases at the midpoint, on a WORD boundary.
 *
 * Deliberately crude, and labelled as a starting point in the UI: real phrasing
 * is a musical decision the poet makes by ear. What this must never do is split
 * a word — so it picks the word gap nearest the syllable midpoint rather than
 * cutting at the middle syllable.
 */
export function splitPhrases(plan: LinePlan, count = 2): Phrase[] {
  if (plan.words.length < count || count < 2) {
    return [{ label: 'Phrase A', words: plan.words, text: plan.text.trim(), syllableCount: plan.syllableCount }];
  }

  // Cumulative syllables after each word — the only places a cut may fall.
  const cumulative: number[] = [];
  let running = 0;
  for (const w of plan.words) {
    running += w.syllableCount;
    cumulative.push(running);
  }

  /**
   * Choose each cut at the WORD BOUNDARY nearest its ideal syllable position.
   *
   * A greedy "close the phrase once it has had its share" pass under-splits:
   * with four words and three phrases it would run out of budget and return
   * two, silently giving fewer phrases than asked for. Picking each cut
   * independently and then forcing them apart cannot do that.
   */
  const target = plan.syllableCount / count;
  const cuts: number[] = [];
  for (let k = 1; k < count; k++) {
    const ideal = target * k;
    let best = 0;
    let bestDistance = Infinity;
    // A cut after word i means words[0..i] end a phrase; i must leave room for
    // the remaining phrases, and must come after the previous cut.
    const lowest = (cuts[cuts.length - 1] ?? -1) + 1;
    const highest = plan.words.length - (count - k);
    for (let i = lowest; i <= highest; i++) {
      const distance = Math.abs(cumulative[i] - ideal);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    cuts.push(best);
  }

  const phrases: Phrase[] = [];
  let start = 0;
  for (const cut of [...cuts, plan.words.length - 1]) {
    phrases.push(makePhrase(phrases.length, plan.words.slice(start, cut + 1)));
    start = cut + 1;
  }
  return phrases;
}

const PHRASE_LABELS = 'ABCDEFGH';
function makePhrase(i: number, words: WordUnit[]): Phrase {
  return {
    label: `Phrase ${PHRASE_LABELS[i] ?? i + 1}`,
    words,
    text: words.map((w) => w.text).join(' '),
    syllableCount: words.reduce((n, w) => n + w.syllableCount, 0),
  };
}

export interface DensityReading {
  syllablesPerSecond: number;
  /**
   * An ESTIMATE band, not a verdict. See the warning on `readDensity`.
   */
  band: 'low' | 'moderate' | 'high' | 'very-high';
  label: string;
  message: string;
}

/**
 * Estimated vocal density for ONE LINE at a given tempo.
 *
 * ⚠️ THIS IS AN ESTIMATE AND MUST NEVER READ AS A VERDICT. It divides syllables
 * by the seconds in a bar, which assumes the line is sung straight through with
 * no rests — and a sung line almost never is. Between and inside lyric lines
 * there are rests, instrumental responses, sustained vowels and pickups, none
 * of which are visible in the text. A line this calls "very high" may sit
 * perfectly once the melody gives it room.
 *
 * It was previously computed over a WHOLE STANZA, which made a four-line verse
 * look like one impossible 11-syllables-per-second phrase. Density is a
 * property of a line, so it is measured per line and only summarised after.
 *
 * The wording is deliberately hedged — "estimated vocal density: high", not
 * "rushed" — because the tool cannot see the tune and should not pretend to.
 */
export function readDensity(plan: LinePlan, bpm: number, meter: MeterDefinition): DensityReading {
  const seconds = barSeconds(bpm, meter);
  const perSecond = seconds > 0 ? plan.syllableCount / seconds : 0;

  let band: DensityReading['band'];
  let message: string;
  if (perSecond < 1.2) {
    band = 'low';
    message = 'Room to spare — you could add words, or let the notes ring.';
  } else if (perSecond <= 3) {
    band = 'moderate';
    message = 'Sits comfortably at this tempo.';
  } else if (perSecond <= 4.2) {
    band = 'high';
    message = 'The words will come quickly. Worth speaking aloud against the metronome.';
  } else {
    band = 'very-high';
    message =
      'Dense for this tempo if sung straight through — though rests, sustains and instrumental gaps may well absorb it. If it does fight you, use fewer syllables or a slower tempo; never break the words.';
  }
  return {
    syllablesPerSecond: perSecond,
    band,
    label: `Estimated vocal density: ${band === 'very-high' ? 'very high' : band}`,
    message,
  };
}

export interface MeterSuggestion {
  meterId: string;
  /** ALWAYS 'suggested' — this module never claims to have determined a meter. */
  source: Extract<Provenance, 'suggested'>;
  /**
   * Never exceeds 'low' when more than one meter divides evenly, because in
   * that case the syllable count carries essentially no information.
   */
  confidence: 'low' | 'medium';
  /** Why, in the poet's terms. Shown next to the suggestion, never hidden. */
  reasoning: string;
  /** The other meters that fit as well or nearly as well. */
  alternatives: string[];
  /**
   * Set when the count cannot distinguish the candidates — e.g. 3/4 vs 6/8,
   * which differ by ACCENT GROUPING, something text cannot express at all.
   * The UI leads with this rather than with the suggested meter.
   */
  undecidable?: string;
}

/**
 * Suggest a meter from the syllable count — with every caveat attached.
 *
 * ⚠️ THIS IS A WEAK SIGNAL, AND WEAKEST EXACTLY WHERE IT LOOKS STRONGEST.
 * A count divisible by six "fits" both 3/4 and 6/8 — but those two differ by
 * where the ACCENTS fall, not by how many pulses there are:
 *
 *     3/4   ONE-and TWO-and THREE-and     accent every 2nd pulse
 *     6/8   ONE-two-three FOUR-five-six   accent every 3rd pulse
 *
 * No syllable count can tell those apart, because text carries no accent. So
 * when several meters divide evenly the function says so plainly via
 * `undecidable` instead of picking one and looking confident. Only the tune —
 * or the poet tapping the rhythm — settles it.
 */
export function suggestMeter(plan: LinePlan, meters: readonly MeterDefinition[]): MeterSuggestion | null {
  if (plan.syllableCount === 0) return null;

  const fits = meters.filter((m) => plan.syllableCount % pulsesPerBar(m) === 0);
  const divisibleByThree = plan.syllableCount % 3 === 0;

  const best =
    fits[0] ??
    (divisibleByThree ? meters.find((m) => m.division === 'compound') : undefined) ??
    meters.find((m) => m.id === '4/4') ??
    meters[0];

  const alternatives = fits.filter((m) => m.id !== best.id).map((m) => m.id);

  // Do the candidates differ in how they GROUP their pulses? If so the count
  // cannot choose between them, and saying which is "suggested" would mislead.
  const groupings = new Set(fits.map((m) => m.pulsesPerBeat));
  const undecidable =
    fits.length > 1 && groupings.size > 1
      ? `${fits.map((m) => m.id).join(' and ')} both divide ${plan.syllableCount} syllables evenly, but they differ by ACCENT GROUPING — ` +
        `${fits.map((m) => `${m.id} stresses every ${m.pulsesPerBeat === 3 ? 'third' : 'second'} pulse`).join(', ')}. ` +
        `Text carries no accent, so the syllable count cannot choose between them. Play them against the metronome and sing the line.`
      : undefined;

  return {
    meterId: best.id,
    source: 'suggested',
    confidence: fits.length === 1 ? 'medium' : 'low',
    reasoning:
      `${plan.syllableCount} syllables ` +
      (fits.length > 1
        ? `divide evenly into more than one meter (${fits.map((m) => m.id).join(', ')}), so this is only a starting point — the tune decides.`
        : fits.length === 1
          ? `divide evenly across a ${best.id} bar. Text carries no rhythm of its own, so try it against the metronome.`
          : `do not divide evenly into any of these meters; ${best.id} is the common default. Sing it before trusting this.`),
    alternatives,
    undecidable,
  };
}

/** Total syllables in a block of lyrics — thin wrapper so callers need one import. */
export function lyricSyllableCount(text: string): number {
  return countSyllables(text);
}
