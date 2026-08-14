/**
 * Rhythm & meter — pulse, beats, subdivision, accent patterns.
 *
 * Pure and deterministic. The audio engine schedules the clicks; this decides
 * WHEN they fall and which are accented.
 *
 * ⚠️ THE DISTINCTION THIS FILE EXISTS TO MAKE: **3/4 is not 6/8.**
 *
 * Both span six eighth-notes, which is why they get treated as interchangeable
 * and why the spec calls it out. They are not, and the difference is the
 * GROUPING:
 *
 *   3/4  = THREE beats, each split in TWO      ONE-and TWO-and THREE-and
 *          ●  ○  ●  ○  ●  ○     (accent every 2 eighths — simple triple)
 *
 *   6/8  = TWO beats, each split in THREE      ONE-two-three FOUR-five-six
 *          ●  ○  ○  ●  ○  ○     (accent every 3 eighths — compound duple)
 *
 * A waltz is 3/4. A lilting 12/8-feel folk tune is 6/8. Same six pulses, and a
 * singer phrases them completely differently — so `beatUnitsPerBeat` and the
 * accent pattern are derived from the grouping rather than hard-coded per
 * meter, and the two produce visibly different click patterns.
 */

export type MeterId = '3/4' | '4/4' | '6/8';

/** How strongly a pulse is stressed. The metronome maps these to click sounds. */
export type Accent = 'strong' | 'medium' | 'weak';

export interface MeterDefinition {
  id: MeterId;
  /** Beats per bar as WRITTEN (the numerator). */
  numerator: number;
  /** The note value that gets one written beat (the denominator). */
  denominator: 4 | 8;
  /** Simple = beats divide in 2; compound = beats divide in 3. */
  division: 'simple' | 'compound';
  /** How many beats a musician actually FEELS per bar. */
  feltBeats: number;
  /** Subdivisions (pulses) per felt beat: 2 for simple, 3 for compound. */
  pulsesPerBeat: number;
  name: string;
  tamil: string;
  description: string;
}

export const METERS: readonly MeterDefinition[] = [
  {
    id: '3/4',
    numerator: 3,
    denominator: 4,
    division: 'simple',
    feltBeats: 3,
    pulsesPerBeat: 2,
    name: 'Simple triple',
    tamil: 'மூன்று அளவு',
    description: 'Three beats in a bar, each splitting in two. Count: ONE-and TWO-and THREE-and. The waltz feel.',
  },
  {
    id: '4/4',
    numerator: 4,
    denominator: 4,
    division: 'simple',
    feltBeats: 4,
    pulsesPerBeat: 2,
    name: 'Simple quadruple',
    tamil: 'நான்கு அளவு',
    description: 'Four beats in a bar. Beat 1 strongest, beat 3 moderately strong. The default for most film songs.',
  },
  {
    id: '6/8',
    numerator: 6,
    denominator: 8,
    division: 'compound',
    feltBeats: 2,
    pulsesPerBeat: 3,
    name: 'Compound duple',
    tamil: 'ஆறு அளவு',
    description:
      'TWO beats in a bar, each splitting in THREE. Count: ONE-two-three FOUR-five-six. Six pulses like 3/4, but grouped in twos of three — a lilt, not a waltz.',
  },
];

export function meterById(id: string): MeterDefinition | undefined {
  return METERS.find((m) => m.id === id);
}

/** Total pulses (subdivisions) in one bar. */
export function pulsesPerBar(meter: MeterDefinition): number {
  return meter.feltBeats * meter.pulsesPerBeat;
}

/**
 * The accent of each pulse in a bar.
 *
 * Derived from the grouping, which is what makes 3/4 and 6/8 come out
 * different despite both having six pulses:
 *   3/4 → strong, weak, medium, weak, medium, weak   (accent every 2)
 *   6/8 → strong, weak, weak,  medium, weak, weak    (accent every 3)
 *
 * 4/4 additionally marks beat 3 as medium — the half-bar — which is why it
 * feels like two halves rather than four equal thuds.
 */
export function accentPattern(meter: MeterDefinition): Accent[] {
  const out: Accent[] = [];
  for (let beat = 0; beat < meter.feltBeats; beat++) {
    for (let pulse = 0; pulse < meter.pulsesPerBeat; pulse++) {
      // Only the first pulse of a felt beat is stressed at all; the rest are
      // the subdivision and stay weak. That single rule is what separates the
      // two six-pulse meters — 3/4 stresses every 2nd pulse, 6/8 every 3rd.
      if (pulse !== 0) out.push('weak');
      else if (beat === 0) out.push('strong');
      else out.push('medium');
    }
  }
  return out;
}

/** BPM bounds, per the spec. Anything outside is clamped rather than rejected. */
export const MIN_BPM = 40;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 90;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/**
 * Seconds between PULSES (not beats) at a given tempo.
 *
 * ⚠️ BPM COUNTS FELT BEATS, and in a compound meter the felt beat is a dotted
 * value containing three pulses. At 90 BPM in 6/8 there are 90 dotted-quarter
 * beats per minute and therefore 270 eighth-note pulses — not 90. Dividing
 * 60/BPM by the wrong number is what makes a 6/8 metronome sound like a fast
 * 3/4, which is exactly the confusion this module is meant to dispel.
 */
export function pulseSeconds(bpm: number, meter: MeterDefinition): number {
  return 60 / clampBpm(bpm) / meter.pulsesPerBeat;
}

/** Seconds per bar. */
export function barSeconds(bpm: number, meter: MeterDefinition): number {
  return pulseSeconds(bpm, meter) * pulsesPerBar(meter);
}

export interface PulseTick {
  /** 0-based index within the bar. */
  index: number;
  accent: Accent;
  /** Which felt beat this pulse belongs to (1-based). */
  beat: number;
  /** Position within that beat (1-based). */
  subdivision: number;
  /** Seconds from the start of the bar. */
  offsetSeconds: number;
}

/** Every pulse of one bar, with its accent and timing — what the engine schedules. */
export function barTicks(bpm: number, meter: MeterDefinition): PulseTick[] {
  const accents = accentPattern(meter);
  const dt = pulseSeconds(bpm, meter);
  return accents.map((accent, index) => ({
    index,
    accent,
    beat: Math.floor(index / meter.pulsesPerBeat) + 1,
    subdivision: (index % meter.pulsesPerBeat) + 1,
    offsetSeconds: index * dt,
  }));
}

/**
 * The counting syllables a learner says out loud — the clearest way to feel the
 * difference between the two six-pulse meters.
 *   3/4 → 1 and 2 and 3 and
 *   6/8 → 1 2 3 4 5 6
 */
export function countingSyllables(meter: MeterDefinition): string[] {
  const out: string[] = [];
  for (let beat = 0; beat < meter.feltBeats; beat++) {
    for (let pulse = 0; pulse < meter.pulsesPerBeat; pulse++) {
      if (meter.division === 'compound') {
        out.push(String(beat * meter.pulsesPerBeat + pulse + 1));
      } else {
        out.push(pulse === 0 ? String(beat + 1) : 'and');
      }
    }
  }
  return out;
}

/** `● ○ ○ ● ○ ○` — the visualization the spec asks for. */
export function accentGlyphs(meter: MeterDefinition): string[] {
  return accentPattern(meter).map((a) => (a === 'weak' ? '○' : '●'));
}
