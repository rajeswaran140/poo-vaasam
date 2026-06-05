/**
 * Indian & Sri Lankan musical-instrument catalog.
 *
 * The single source of truth for the instrument palette, consumed by:
 *  - GET /api/instruments (the public catalog endpoint), and
 *  - the AI Composer (src/services/ai/composer.ts), which grounds its
 *    `suggested_instruments` on this list so the brief only ever names real,
 *    culturally-appropriate instruments (no LLM hallucinations or generic
 *    "Strings"/"Percussion").
 *
 * Scope is deliberately the classical / traditional / folk instruments of the
 * Indian subcontinent and Sri Lanka — Carnatic, Hindustani, Tamil folk, and
 * Sri Lankan (Kandyan / low-country / Tamil) traditions. Descriptions are
 * strictly musicological — no political or national framing (see
 * tamilagaval-apolitical guidance).
 */

export type InstrumentRegion = 'India' | 'Sri Lanka' | 'Both';
export type InstrumentCategory = 'string' | 'wind' | 'percussion' | 'drone' | 'keyboard';

export interface Instrument {
  /** Stable kebab-case id. */
  id: string;
  /** Canonical display name (used verbatim in composer output). */
  name: string;
  /** Tamil-script name, where commonly written. */
  tamilName?: string;
  region: InstrumentRegion;
  category: InstrumentCategory;
  /** Traditions the instrument belongs to (Carnatic, Hindustani, Tamil folk, …). */
  traditions: string[];
  /** Feel hints used to match instruments to a song's emotion. */
  moods?: string[];
  /** Alternative spellings/transliterations, for normalising LLM/user input. */
  aliases?: string[];
  description?: string;
}

export const INSTRUMENTS: Instrument[] = [
  // ── Strings ────────────────────────────────────────────────────────────────
  { id: 'veena', name: 'Veena', tamilName: 'வீணை', region: 'India', category: 'string', traditions: ['Carnatic'], moods: ['devotional', 'serene', 'romantic'], aliases: ['saraswati veena', 'veenai', 'vina'], description: 'Plucked fretted lute, the principal melodic string of Carnatic music.' },
  { id: 'sitar', name: 'Sitar', region: 'India', category: 'string', traditions: ['Hindustani'], moods: ['contemplative', 'romantic'], aliases: ['sitaar'] },
  { id: 'sarod', name: 'Sarod', region: 'India', category: 'string', traditions: ['Hindustani'], moods: ['deep', 'serious'] },
  { id: 'sarangi', name: 'Sarangi', region: 'India', category: 'string', traditions: ['Hindustani'], moods: ['melancholic', 'longing'], description: 'Bowed string closest to the human voice.' },
  { id: 'santoor', name: 'Santoor', region: 'India', category: 'string', traditions: ['Hindustani'], moods: ['serene', 'shimmering'], aliases: ['santur'] },
  { id: 'violin', name: 'Violin', tamilName: 'வயலின்', region: 'India', category: 'string', traditions: ['Carnatic', 'Film'], moods: ['romantic', 'melancholic', 'tender'], aliases: ['fiddle'], description: 'Adopted into Carnatic music as a core accompaniment and solo instrument.' },
  { id: 'chitravina', name: 'Chitravina', region: 'India', category: 'string', traditions: ['Carnatic'], moods: ['serene', 'devotional'], aliases: ['gotuvadyam', 'gottuvadhyam'] },
  { id: 'tanpura', name: 'Tanpura', region: 'India', category: 'drone', traditions: ['Carnatic', 'Hindustani'], moods: ['meditative', 'serene'], aliases: ['tambura', 'thamburu'], description: 'Drone instrument that holds the tonic underpinning a performance.' },
  { id: 'yaazh', name: 'Yaazh', tamilName: 'யாழ்', region: 'Both', category: 'string', traditions: ['Tamil classical'], moods: ['serene', 'tender', 'ancient'], aliases: ['yaal', 'yazh', 'yaarl'], description: 'Ancient Tamil harp of the Sangam tradition.' },
  { id: 'ektara', name: 'Ektara', region: 'India', category: 'string', traditions: ['Folk', 'Devotional'], moods: ['rustic', 'devotional'], aliases: ['ektar', 'iktara'] },

  // ── Wind ────────────────────────────────────────────────────────────────────
  { id: 'flute', name: 'Flute', tamilName: 'புல்லாங்குழல்', region: 'India', category: 'wind', traditions: ['Carnatic', 'Hindustani'], moods: ['serene', 'romantic', 'pastoral'], aliases: ['bansuri', 'venu', 'pullankuzhal', 'bamboo flute', 'murali'], description: 'Bamboo transverse flute (Venu in Carnatic, Bansuri in Hindustani).' },
  { id: 'nadaswaram', name: 'Nadaswaram', tamilName: 'நாதஸ்வரம்', region: 'India', category: 'wind', traditions: ['Carnatic', 'Temple'], moods: ['auspicious', 'celebratory', 'devotional'], aliases: ['nagaswaram', 'nadhaswaram', 'nāgasvaram'], description: 'Large double-reed temple wind, central to Tamil auspicious music.' },
  { id: 'shehnai', name: 'Shehnai', region: 'India', category: 'wind', traditions: ['Hindustani'], moods: ['auspicious', 'celebratory'], aliases: ['shahnai', 'shenai'] },
  { id: 'harmonium', name: 'Harmonium', region: 'India', category: 'keyboard', traditions: ['Hindustani', 'Devotional', 'Film'], moods: ['devotional', 'warm'], aliases: ['harmon, peti', 'baja'] },
  { id: 'conch', name: 'Conch', tamilName: 'சங்கு', region: 'Both', category: 'wind', traditions: ['Temple', 'Devotional'], moods: ['sacred', 'auspicious'], aliases: ['sangu', 'shankh', 'shankha'] },
  { id: 'kuzhal', name: 'Kuzhal', tamilName: 'குழல்', region: 'Both', category: 'wind', traditions: ['Tamil folk', 'Temple'], moods: ['rustic', 'celebratory'], aliases: ['mukavinai', 'mukha veenai'] },

  // ── Percussion ──────────────────────────────────────────────────────────────
  { id: 'mridangam', name: 'Mridangam', tamilName: 'மிருதங்கம்', region: 'India', category: 'percussion', traditions: ['Carnatic'], moods: ['rhythmic', 'classical'], aliases: ['mrudangam', 'mridanga'], description: 'Principal pitched two-headed drum of Carnatic music.' },
  { id: 'tabla', name: 'Tabla', region: 'India', category: 'percussion', traditions: ['Hindustani'], moods: ['rhythmic', 'intricate'], aliases: ['thabla'] },
  { id: 'ghatam', name: 'Ghatam', tamilName: 'கடம்', region: 'India', category: 'percussion', traditions: ['Carnatic'], moods: ['rhythmic', 'earthy'], aliases: ['ghata'], description: 'Tuned clay pot.' },
  { id: 'kanjira', name: 'Kanjira', tamilName: 'கஞ்சிரா', region: 'India', category: 'percussion', traditions: ['Carnatic'], moods: ['rhythmic', 'bright'], aliases: ['khanjira', 'ganjira'], description: 'Small frame drum with a single jingle.' },
  { id: 'thavil', name: 'Thavil', tamilName: 'தவில்', region: 'India', category: 'percussion', traditions: ['Carnatic', 'Temple'], moods: ['celebratory', 'auspicious', 'powerful'], aliases: ['thavul', 'tavil'], description: 'Barrel drum paired with the Nadaswaram in temple music.' },
  { id: 'morsing', name: 'Morsing', region: 'India', category: 'percussion', traditions: ['Carnatic'], moods: ['rhythmic', 'twangy'], aliases: ['morchang', "jew's harp", 'mukharshankh'] },
  { id: 'pakhawaj', name: 'Pakhawaj', region: 'India', category: 'percussion', traditions: ['Hindustani'], moods: ['solemn', 'classical'], aliases: ['pakawaj'] },
  { id: 'dholak', name: 'Dholak', region: 'India', category: 'percussion', traditions: ['Folk', 'Film'], moods: ['festive', 'rhythmic'], aliases: ['dholki'] },
  { id: 'udukai', name: 'Udukai', tamilName: 'உடுக்கை', region: 'Both', category: 'percussion', traditions: ['Tamil folk', 'Devotional'], moods: ['trance', 'devotional', 'rustic'], aliases: ['udukku', 'udakku', 'uduku'], description: 'Hourglass tension drum used in Tamil folk and worship.' },
  { id: 'parai', name: 'Parai', tamilName: 'பறை', region: 'Both', category: 'percussion', traditions: ['Tamil folk'], moods: ['earthy', 'powerful', 'communal'], aliases: ['parai melam', 'thappu', 'thappattam'], description: 'Ancient Tamil frame drum.' },
  { id: 'jalra', name: 'Jalra', tamilName: 'ஜால்ரா', region: 'Both', category: 'percussion', traditions: ['Devotional', 'Temple'], moods: ['devotional', 'rhythmic'], aliases: ['jal', 'manjira', 'taalam', 'thaalam', 'cymbals', 'kartal'], description: 'Small hand cymbals that keep tala in devotional song.' },
  { id: 'chenda', name: 'Chenda', region: 'India', category: 'percussion', traditions: ['Temple', 'Folk'], moods: ['powerful', 'ritual'], aliases: ['chande'] },

  // ── Sri Lankan traditional ──────────────────────────────────────────────────
  { id: 'geta-bera', name: 'Geta Bera', region: 'Sri Lanka', category: 'percussion', traditions: ['Sri Lankan', 'Kandyan'], moods: ['ritual', 'powerful', 'ceremonial'], aliases: ['getabera', 'kandyan drum'], description: 'Double-headed Kandyan dance drum of the Sri Lankan hill country.' },
  { id: 'yak-bera', name: 'Yak Bera', region: 'Sri Lanka', category: 'percussion', traditions: ['Sri Lankan'], moods: ['ritual', 'trance'], aliases: ['yakbera', 'low country drum', 'ruhunu bera'] },
  { id: 'davula', name: 'Davula', region: 'Sri Lanka', category: 'percussion', traditions: ['Sri Lankan', 'Temple'], moods: ['ceremonial', 'auspicious'], aliases: ['daula', 'dawula'] },
  { id: 'thammettama', name: 'Thammettama', region: 'Sri Lanka', category: 'percussion', traditions: ['Sri Lankan', 'Temple'], moods: ['ceremonial', 'auspicious'], aliases: ['thammattama', 'tammettama'], description: 'Twin kettle-drums played with sticks in temple processions.' },
  { id: 'rabana', name: 'Rabana', region: 'Sri Lanka', category: 'percussion', traditions: ['Sri Lankan', 'Folk'], moods: ['festive', 'communal'], aliases: ['raban', 'rabaan'], description: 'Frame drum played at Sri Lankan festivals and celebrations.' },
  { id: 'horanewa', name: 'Horanewa', region: 'Sri Lanka', category: 'wind', traditions: ['Sri Lankan'], moods: ['ceremonial', 'auspicious'], aliases: ['horanawa', 'horanāva'], description: 'Sri Lankan double-reed wind, akin to a small shawm.' },
];

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip Latin combining diacritics (é→e)
    // Keep a-z, 0-9 AND the Tamil Unicode block (U+0B80–U+0BFF) so Tamil-script
    // names resolve; collapse everything else to a single space.
    .replace(/[^a-z0-9஀-௿]+/g, ' ')
    .trim();

// name/alias → canonical Instrument, built once.
const LOOKUP: Map<string, Instrument> = (() => {
  const m = new Map<string, Instrument>();
  for (const inst of INSTRUMENTS) {
    m.set(normalize(inst.name), inst);
    if (inst.tamilName) m.set(normalize(inst.tamilName), inst);
    for (const alias of inst.aliases ?? []) m.set(normalize(alias), inst);
  }
  return m;
})();

/** Resolve any spelling/transliteration to its catalog entry, or undefined. */
export function findInstrument(name: string): Instrument | undefined {
  return LOOKUP.get(normalize(name));
}

export interface InstrumentFilter {
  region?: InstrumentRegion;
  category?: InstrumentCategory;
  tradition?: string;
  mood?: string;
  q?: string;
}

/** The catalog, optionally filtered. */
export function getInstruments(filter: InstrumentFilter = {}): Instrument[] {
  const { region, category, tradition, mood, q } = filter;
  const needle = q ? normalize(q) : '';
  return INSTRUMENTS.filter((i) => {
    if (region && i.region !== region && i.region !== 'Both') return false;
    if (category && i.category !== category) return false;
    if (tradition && !i.traditions.some((t) => normalize(t) === normalize(tradition))) return false;
    if (mood && !(i.moods ?? []).some((mo) => normalize(mo) === normalize(mood))) return false;
    if (needle) {
      const hay = normalize([i.name, i.tamilName, ...(i.aliases ?? []), ...i.traditions].filter(Boolean).join(' '));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Canonicalise a list of instrument names against the catalog: map each to its
 * official name, drop anything not in the catalog, dedupe, preserve order.
 */
export function canonicalInstrumentNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const found = findInstrument(raw);
    if (found && !seen.has(found.id)) {
      seen.add(found.id);
      out.push(found.name);
    }
  }
  return out;
}

/** Grouped palette string for grounding the composer's system prompt. */
export function instrumentPalette(): string {
  const byCat: Record<string, string[]> = {};
  for (const i of INSTRUMENTS) {
    (byCat[i.category] ??= []).push(i.name);
  }
  const order: InstrumentCategory[] = ['string', 'wind', 'percussion', 'drone', 'keyboard'];
  return order
    .filter((c) => byCat[c]?.length)
    .map((c) => `${c}: ${byCat[c].join(', ')}`)
    .join(' | ');
}
