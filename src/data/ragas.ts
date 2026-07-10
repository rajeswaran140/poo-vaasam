/**
 * Raga catalog — the melodic frameworks of Indian classical music (Carnatic &
 * Hindustani), the same system used in Sri Lankan Carnatic / Tamil classical
 * music.
 *
 * Single source of truth for the raga palette, consumed by:
 *  - GET /api/ragas (the public catalog endpoint), and
 *  - the AI Composer, which grounds its `suggested_ragas` on this list and
 *    matches a raga's rasa (`moods`) to the song's emotion — so the brief
 *    recommends real, mood-appropriate ragas instead of inventing names.
 *
 * Descriptions are strictly musicological (rasa, time of day) — no political or
 * national framing (see tamilagaval-apolitical guidance).
 */

export type RagaTradition = 'Carnatic' | 'Hindustani';

export interface Raga {
  /** Stable kebab-case id. */
  id: string;
  /** Canonical display name (used verbatim in composer output). */
  name: string;
  tradition: RagaTradition;
  /** Rasa / emotional feel — used to match a raga to a song's emotion. */
  moods: string[];
  /**
   * Practical Western scale/mode the raga maps onto — the music-generator/DAW-friendly
   * "key hint" (combined with a tonic, e.g. "D Harmonic minor"). An
   * approximation, not strict theory: ragas with gamakas/extra svaras are
   * mapped to the nearest usable scale.
   */
  scale: string;
  /** Alternative spellings + the cross-system equivalent name, for matching. */
  aliases?: string[];
  /** Hindustani performance time, where traditionally observed. */
  timeOfDay?: string;
  description?: string;
}

export const RAGAS: Raga[] = [
  // ── Carnatic ────────────────────────────────────────────────────────────────
  { id: 'mohanam', name: 'Mohanam', tradition: 'Carnatic', moods: ['joyful', 'auspicious', 'serene'], scale: 'Major pentatonic', aliases: ['mohana', 'bhoopali', 'bhup'], description: 'Pentatonic, bright and auspicious; a Hindustani Bhoopali equivalent.' },
  { id: 'hamsadhwani', name: 'Hamsadhwani', tradition: 'Carnatic', moods: ['joyful', 'auspicious', 'bright'], scale: 'Major pentatonic', aliases: ['hansadhwani', 'hamsadhwni'], description: 'Pentatonic, festive; often opens a concert.' },
  { id: 'kalyani', name: 'Kalyani', tradition: 'Carnatic', moods: ['majestic', 'romantic', 'devotional'], scale: 'Lydian', aliases: ['mechakalyani', 'yaman', 'kalyan'], description: 'Grand and luminous; the Hindustani Yaman.' },
  { id: 'shankarabharanam', name: 'Shankarabharanam', tradition: 'Carnatic', moods: ['majestic', 'serene', 'devotional'], scale: 'Major (Ionian)', aliases: ['sankarabharanam', 'bilawal', 'dheerasankarabharanam'], description: 'The major-scale equivalent; noble and balanced.' },
  { id: 'kharaharapriya', name: 'Kharaharapriya', tradition: 'Carnatic', moods: ['tender', 'romantic', 'longing'], scale: 'Dorian', aliases: ['kharahara priya', 'kafi'], description: 'Warm and emotive; the Dorian/Kafi tonality.' },
  { id: 'hindolam', name: 'Hindolam', tradition: 'Carnatic', moods: ['devotional', 'meditative', 'deep'], scale: 'Minor pentatonic', aliases: ['malkauns', 'malkosh'], description: 'Pentatonic, profound; the Hindustani Malkauns.' },
  { id: 'abheri', name: 'Abheri', tradition: 'Carnatic', moods: ['devotional', 'longing', 'tender'], scale: 'Dorian', aliases: ['abheri', 'bhimpalasi', 'devagandhari'], description: 'Soulful and yearning.' },
  { id: 'bhairavi', name: 'Bhairavi', tradition: 'Carnatic', moods: ['devotional', 'pathos', 'longing'], scale: 'Natural minor', aliases: ['bhairavi'], description: 'Deeply emotive; traditionally concludes a concert.' },
  { id: 'todi', name: 'Todi', tradition: 'Carnatic', moods: ['pathos', 'longing', 'devotional'], scale: 'Phrygian', aliases: ['hanumatodi', 'hanuma todi'], description: 'Intense and plaintive.' },
  { id: 'kambhoji', name: 'Kambhoji', tradition: 'Carnatic', moods: ['majestic', 'devotional', 'tender'], scale: 'Mixolydian', aliases: ['kambodi', 'khamaj'], description: 'Expansive and graceful.' },
  { id: 'sahana', name: 'Sahana', tradition: 'Carnatic', moods: ['tender', 'soothing', 'romantic'], scale: 'Dorian', aliases: ['saahana'], description: 'Gentle, with a soft pathos.' },
  { id: 'anandabhairavi', name: 'Anandabhairavi', tradition: 'Carnatic', moods: ['soothing', 'devotional', 'compassion'], scale: 'Natural minor', aliases: ['ananda bhairavi'], description: 'Said to soothe; associated with compassion.' },
  { id: 'madhyamavati', name: 'Madhyamavati', tradition: 'Carnatic', moods: ['peaceful', 'auspicious', 'serene'], scale: 'Minor pentatonic (suspended)', aliases: ['madhyamavathi', 'madhumad sarang'], description: 'Pentatonic; auspicious, traditionally closes a performance.' },
  { id: 'keeravani', name: 'Keeravani', tradition: 'Carnatic', moods: ['romantic', 'melancholic', 'tender'], scale: 'Harmonic minor', aliases: ['kirwani', 'keervani'], description: 'Harmonic-minor tonality; widely used in film romance.' },
  { id: 'charukesi', name: 'Charukesi', tradition: 'Carnatic', moods: ['romantic', 'pathos', 'tender'], scale: 'Major with b6/b7 (Mixolydian b6)', aliases: ['charukesi'], description: 'Bittersweet; equally at home in devotion and longing.' },
  { id: 'sindhu-bhairavi', name: 'Sindhu Bhairavi', tradition: 'Carnatic', moods: ['devotional', 'longing', 'folk'], scale: 'Phrygian / Bhairavi (all komal)', aliases: ['sindubhairavi', 'sindhubhairavi'], description: 'Emotive, folk-tinged; common in bhajans and film.' },
  { id: 'reetigowla', name: 'Reetigowla', tradition: 'Carnatic', moods: ['contemplative', 'devotional', 'tender'], scale: 'Dorian', aliases: ['reetigaula', 'ritigowla'], description: 'Winding and meditative.' },
  { id: 'saveri', name: 'Saveri', tradition: 'Carnatic', moods: ['devotional', 'pathos'], scale: 'Phrygian (with major-ish gamaka)', aliases: ['saveri'], description: 'Prayerful and plaintive.' },
  { id: 'revati', name: 'Revati', tradition: 'Carnatic', moods: ['serene', 'devotional'], scale: 'Phrygian pentatonic', aliases: ['revathi', 'bairagi'], description: 'Pentatonic, calm and prayerful.' },
  { id: 'valaji', name: 'Valaji', tradition: 'Carnatic', moods: ['joyful', 'light', 'romantic'], scale: 'Major pentatonic (b7)', aliases: ['valachi', 'balaji'], description: 'Pentatonic, lilting and pleasant.' },
  { id: 'natabhairavi', name: 'Natabhairavi', tradition: 'Carnatic', moods: ['melancholic', 'serious', 'deep'], scale: 'Natural minor (Aeolian)', aliases: ['nata bhairavi', 'asavari'], description: 'The natural-minor scale; grave and introspective.' },

  // ── Hindustani ──────────────────────────────────────────────────────────────
  { id: 'yaman', name: 'Yaman', tradition: 'Hindustani', moods: ['romantic', 'serene', 'majestic'], scale: 'Lydian', aliases: ['yaman kalyan', 'eman'], timeOfDay: 'evening', description: 'Luminous evening raga; the Carnatic Kalyani.' },
  { id: 'bhairav', name: 'Bhairav', tradition: 'Hindustani', moods: ['devotional', 'solemn', 'serene'], scale: 'Double harmonic major (b2, b6)', aliases: ['bhairav'], timeOfDay: 'morning', description: 'Grave, prayerful dawn raga.' },
  { id: 'bhimpalasi', name: 'Bhimpalasi', tradition: 'Hindustani', moods: ['longing', 'tender', 'romantic'], scale: 'Dorian', aliases: ['bhimpalas', 'bheempalasi'], timeOfDay: 'afternoon', description: 'Yearning afternoon raga; akin to Carnatic Abheri.' },
  { id: 'darbari-kanada', name: 'Darbari Kanada', tradition: 'Hindustani', moods: ['majestic', 'serious', 'deep'], scale: 'Natural minor', aliases: ['darbari', 'darbari kanara'], timeOfDay: 'late night', description: 'Stately and profound.' },
  { id: 'malkauns', name: 'Malkauns', tradition: 'Hindustani', moods: ['meditative', 'deep', 'devotional'], scale: 'Minor pentatonic', aliases: ['malkosh', 'hindolam'], timeOfDay: 'night', description: 'Pentatonic, introspective; the Carnatic Hindolam.' },
  { id: 'bageshri', name: 'Bageshri', tradition: 'Hindustani', moods: ['longing', 'romantic', 'tender'], scale: 'Dorian', aliases: ['bageshree', 'bagesri'], timeOfDay: 'night', description: 'Raga of longing for a beloved.' },
  { id: 'khamaj', name: 'Khamaj', tradition: 'Hindustani', moods: ['romantic', 'light', 'playful'], scale: 'Mixolydian', aliases: ['khamaj', 'khambhoji'], timeOfDay: 'evening', description: 'Light-romantic, common in thumri and film.' },
  { id: 'desh', name: 'Desh', tradition: 'Hindustani', moods: ['tender', 'longing', 'pastoral'], scale: 'Mixolydian', aliases: ['des', 'desh malhar'], timeOfDay: 'night', description: 'Gentle monsoon raga.' },
  { id: 'ahir-bhairav', name: 'Ahir Bhairav', tradition: 'Hindustani', moods: ['devotional', 'serene', 'tender'], scale: 'Mixolydian b2', aliases: ['ahir bhairav'], timeOfDay: 'morning', description: 'Soothing devotional dawn raga.' },
];

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Keep a-z, 0-9 and the Tamil Unicode block, consistent with the
    // instrument catalog's normaliser.
    .replace(/[^a-z0-9஀-௿]+/g, ' ')
    .trim();

const LOOKUP: Map<string, Raga> = (() => {
  const m = new Map<string, Raga>();
  for (const raga of RAGAS) {
    m.set(normalize(raga.name), raga);
    for (const alias of raga.aliases ?? []) {
      // Don't let a shared alias (e.g. an equivalent name) clobber a primary name.
      if (!m.has(normalize(alias))) m.set(normalize(alias), raga);
    }
  }
  return m;
})();

/** Resolve any spelling/equivalent name to its catalog entry, or undefined. */
export function findRaga(name: string): Raga | undefined {
  return LOOKUP.get(normalize(name));
}

export interface RagaFilter {
  tradition?: RagaTradition;
  mood?: string;
  q?: string;
}

/** The catalog, optionally filtered. */
export function getRagas(filter: RagaFilter = {}): Raga[] {
  const { tradition, mood, q } = filter;
  const needle = q ? normalize(q) : '';
  return RAGAS.filter((r) => {
    if (tradition && r.tradition !== tradition) return false;
    if (mood && !r.moods.some((mo) => normalize(mo) === normalize(mood))) return false;
    if (needle) {
      const hay = normalize([r.name, ...(r.aliases ?? []), ...r.moods].join(' '));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Canonicalise a list of raga names against the catalog: map each to its
 * official name, drop anything not in the catalog, dedupe, preserve order.
 */
export function canonicalRagaNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const found = findRaga(raw);
    if (found && !seen.has(found.id)) {
      seen.add(found.id);
      out.push(found.name);
    }
  }
  return out;
}

/** Compact `Name (mood, mood)` palette for grounding the composer's prompt. */
export function ragaPalette(): string {
  return RAGAS.map((r) => `${r.name} (${r.moods.slice(0, 2).join('/')})`).join(', ');
}

/** Extract the tonic (note name + accidental) from a key string like "D Minor". */
function tonicOf(key: string): string | null {
  const m = (key || '').trim().match(/^([A-Ga-g])\s*([#b♯♭]?)/);
  if (!m) return null;
  return m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b');
}

/**
 * Classify a scale/mode name into its tonal family by its THIRD degree — the
 * note that fixes major vs minor colour. Modes with a major 3rd (Ionian, Lydian,
 * Mixolydian, "major …") are `major`; modes with a minor 3rd (Aeolian/natural
 * minor, Dorian, Phrygian, harmonic minor, minor pentatonic) are `minor`.
 * Unrecognised → `unknown` (never treated as a conflict). Order matters: the
 * minor-3rd check runs first because some minor scales also contain the word
 * "major" as a qualifier is NOT the case here, but Dorian/Phrygian/Aeolian are
 * unambiguous minor-3rd modes regardless of other words.
 */
export type ScaleFamily = 'major' | 'minor' | 'unknown';
export function scaleFamily(scale: string): ScaleFamily {
  const s = (scale || '').toLowerCase();
  if (/\b(minor|dorian|phrygian|aeolian|locrian)\b/.test(s)) return 'minor';
  if (/\b(major|ionian|lydian|mixolydian)\b/.test(s)) return 'major';
  return 'unknown';
}

export interface KeyRagaConsistency {
  /** true when the key's tonal family matches the raga (or can't be judged). */
  consistent: boolean;
  /** The key to use: tonic + the raga's exact scale (music-generator/DAW-friendly). */
  reconciledKey: string;
  /** The raga's Western scale, for reference. */
  ragaScale: string | null;
  /** Present ONLY when a genuine major↔minor conflict was corrected. */
  note: string | null;
}

/**
 * Validate the model's `suggested_key` against the lead raga's scale and return
 * a DAW-friendly reconciled key. A GENUINE conflict is a tonal-FAMILY mismatch
 * (major-3rd vs minor-3rd) — e.g. a Dorian key under the major-pentatonic
 * Mohanam — which we correct to the raga's scale and REPORT via `note`.
 * Same-family differences (e.g. "D Minor" under harmonic-minor Keeravani) are
 * benign refinements, corrected silently. Unresolvable raga/tonic → key kept.
 */
export function checkKeyRagaConsistency(
  suggestedKey: string,
  leadRagaName: string | undefined
): KeyRagaConsistency {
  const raga = leadRagaName ? findRaga(leadRagaName) : undefined;
  const tonic = tonicOf(suggestedKey);
  if (!raga || !tonic) {
    return { consistent: true, reconciledKey: suggestedKey, ragaScale: raga?.scale ?? null, note: null };
  }
  const reconciledKey = `${tonic} ${raga.scale.charAt(0).toLowerCase()}${raga.scale.slice(1)}`;
  const keyMode = suggestedKey.slice(tonic.length).trim(); // e.g. "Dorian", "Minor"
  const keyFamily = scaleFamily(keyMode);
  const ragaFamily = scaleFamily(raga.scale);
  const conflict =
    keyFamily !== 'unknown' && ragaFamily !== 'unknown' && keyFamily !== ragaFamily;
  const note = conflict
    ? `Tonal conflict: key "${suggestedKey}" is ${keyFamily}, but raga ${raga.name} is ${raga.scale} (${ragaFamily}). Corrected to "${reconciledKey}".`
    : null;
  return { consistent: !conflict, reconciledKey, ragaScale: raga.scale, note };
}

/**
 * music-generator/DAW-friendly key+scale hint: the reconciled key from
 * checkKeyRagaConsistency (tonic + lead raga scale, e.g. "D harmonic minor").
 * Falls back to the original key when the raga or tonic can't be resolved.
 */
export function ragaScaleKey(suggestedKey: string, leadRagaName: string | undefined): string {
  return checkKeyRagaConsistency(suggestedKey, leadRagaName).reconciledKey;
}
