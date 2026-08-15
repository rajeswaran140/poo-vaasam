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
  syllableCount: number;
  /** Can the singer hold this word's last note? Open + long = yes. */
  sustainable: boolean;
  /** Index of the word within the line. */
  index: number;
}

export interface LinePlan {
  text: string;
  words: WordUnit[];
  syllableCount: number;
  /** Words the singer can comfortably sustain — candidates for a held note. */
  sustainCandidates: WordUnit[];
}

/** Split a line into words with their syllable structure. Whitespace-only → empty. */
export function planLine(text: string): LinePlan {
  const words = (text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, index) => {
      const syllables = syllabify(w);
      const last = syllables[syllables.length - 1];
      return {
        text: w,
        syllables,
        syllableCount: syllables.length,
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
  syllablesPerBar: number;
  /** Syllables per second at this tempo — the number a singer actually feels. */
  syllablesPerSecond: number;
  verdict: 'sparse' | 'comfortable' | 'busy' | 'rushed';
  message: string;
}

/**
 * How crowded the line is at a given tempo and meter.
 *
 * The thresholds are in syllables per SECOND, not per bar, because that is what
 * the mouth is actually doing — a bar means different amounts of time at
 * different tempos. Roughly: conversational Tamil sits near 4-5 syllables a
 * second, and sung Tamil wants noticeably fewer to stay intelligible.
 */
export function readDensity(plan: LinePlan, bpm: number, meter: MeterDefinition): DensityReading {
  const seconds = barSeconds(bpm, meter);
  const perSecond = seconds > 0 ? plan.syllableCount / seconds : 0;
  const perBar = plan.syllableCount / 1;

  let verdict: DensityReading['verdict'];
  let message: string;
  if (perSecond < 1.2) {
    verdict = 'sparse';
    message = 'Plenty of room — you could add words, or hold the notes longer.';
  } else if (perSecond <= 3) {
    verdict = 'comfortable';
    message = 'Sits naturally at this tempo.';
  } else if (perSecond <= 4.2) {
    verdict = 'busy';
    message = 'Singable, but the words will come fast. Check the consonant clusters.';
  } else {
    verdict = 'rushed';
    message =
      'Too many syllables for this tempo — the words will blur. Use fewer syllables or slow the tempo; do not break the words.';
  }
  return { syllablesPerBar: perBar, syllablesPerSecond: perSecond, verdict, message };
}

export interface MeterSuggestion {
  meterId: string;
  /** ALWAYS 'suggested' — this module never claims to have determined a meter. */
  source: Extract<Provenance, 'suggested'>;
  confidence: 'low' | 'medium';
  /** Why, in the poet's terms. Shown next to the suggestion, never hidden. */
  reasoning: string;
  /** The other meters that fit as well or nearly as well. */
  alternatives: string[];
}

/**
 * Suggest a meter from the syllable count — with every caveat attached.
 *
 * ⚠️ THIS IS A HINT, NOT AN ANALYSIS. Text does not carry rhythm: the same
 * words can be sung in 3/4, 6/8 or 4/4, and which one is right is the
 * composer's decision. Confidence never exceeds `medium`, `source` is always
 * `suggested`, and the alternatives are listed precisely so the suggestion
 * cannot read as a verdict.
 */
export function suggestMeter(plan: LinePlan, meters: readonly MeterDefinition[]): MeterSuggestion | null {
  if (plan.syllableCount === 0) return null;

  // Which meters divide the syllable count evenly across their pulses? A line
  // of six sits neatly in both 3/4 and 6/8 — which is exactly why we say so
  // rather than picking one.
  const fits = meters.filter((m) => plan.syllableCount % pulsesPerBar(m) === 0);
  const divisibleByThree = plan.syllableCount % 3 === 0;

  const best =
    fits[0] ??
    (divisibleByThree ? meters.find((m) => m.division === 'compound') : undefined) ??
    meters.find((m) => m.id === '4/4') ??
    meters[0];

  const alternatives = meters.filter((m) => m.id !== best.id && plan.syllableCount % pulsesPerBar(m) === 0).map((m) => m.id);

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
  };
}

/** Total syllables in a block of lyrics — thin wrapper so callers need one import. */
export function lyricSyllableCount(text: string): number {
  return countSyllables(text);
}
