/**
 * Per-section arrangement — who leads, what plays underneath, and where the
 * instrumental breaks fall.
 *
 * WHY THIS IS NOT LEFT TO THE MODEL. Break placement is the weakest link in a
 * generated setup: nine breaks across four verses is an arrangement decision a
 * poet hears instantly and a model guesses at. Raj's real songs hand ONE melody
 * between instruments across the whole piece — Theme A stated seven times with
 * flute, violin, flute, violin, then both in duet. That is orchestration, and
 * it is his to make.
 *
 * The two-level grammar this builds, taken from his own working files:
 *
 *   [Chorus - Male Lead]                     ← section tag: Kind - Detail
 *   [Soft close-mic tenor, pads underneath]  ← direction: a layer, bracketed prose
 *   சாயங்கால வானத்திலே...                     ← lyric
 *
 * Pure: no I/O, no model. The editor owns the choices; this turns them into the
 * block that gets pasted, and answers whether the arrangement is balanced.
 */

import type { SectionTag } from '@/lib/suno-setup';

/** What a layer is doing under (or against) the lead. Raj's own phrasing. */
export const LAYER_ROLES = [
  'sustains beneath',
  'answers in counterpoint',
  'shadows softly',
  'enters',
  'harmonizes',
  'drops out',
  'carries the groove',
  'swells',
  'taper',
] as const;
export type LayerRole = (typeof LAYER_ROLES)[number];

export interface Layer {
  /** Instrument name, exactly as the palette spells it. */
  instrument: string;
  role: LayerRole | string;
}

export interface ArrangedSection {
  /** The section's own tag, e.g. Chorus / Verse / Break / Interlude / Theme A. */
  kind: string;
  /** Who leads: "Male Lead", "Flute Lead", "Instrumental", … */
  detail: string;
  /** Layers under the lead — become the bracketed direction lines. */
  layers: Layer[];
  /** Free-text direction, used verbatim when the poet prefers his own words. */
  freeDirection?: string;
  /** Sung text, empty for an instrumental section. */
  lyrics?: string;
}

/**
 * Render one layer as a direction line.
 *
 * Instrument first, then the role, because that is how the ear parses it and
 * how his files read: "Bamboo flute answers in counterpoint", not the reverse.
 */
export function layerLine(l: Layer): string {
  const instrument = (l.instrument ?? '').trim();
  const role = (l.role ?? '').trim();
  if (!instrument) return '';
  return role ? `${instrument} ${role}` : instrument;
}

/**
 * Build the pasteable block.
 *
 * A free-text direction WINS over composed layers when both exist — the poet
 * writing the line himself is the stronger signal, and silently appending
 * generated layers under his own wording would corrupt his phrasing.
 */
export function toArrangementBlock(sections: ArrangedSection[]): string {
  return sections
    .map((s) => {
      const head = s.detail.trim() ? `[${s.kind.trim()} - ${s.detail.trim()}]` : `[${s.kind.trim()}]`;
      const directions = s.freeDirection?.trim()
        ? [`[${s.freeDirection.trim()}]`]
        : s.layers.map(layerLine).filter(Boolean).map((d) => `[${d}]`);
      const body = (s.lyrics ?? '').trim();
      return [head, ...directions, body].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

export interface Balance {
  total: number;
  instrumental: number;
  sung: number;
  /** Instrumental share, 0-1. */
  ratio: number;
  /** Plain-language read; empty when the arrangement is in a normal range. */
  note: string;
}

/**
 * Is the song breathing?
 *
 * Measured against Raj's own finished work rather than a rule of thumb: a real
 * arrangement of his ran 13 instrumental tags against 14 sung — essentially
 * half. The failure mode is tagging the verses and stopping, which leaves a
 * wall of vocal with nowhere for the melody to be handed on.
 */
export const HEALTHY_INSTRUMENTAL_MIN = 0.25;
export const HEALTHY_INSTRUMENTAL_MAX = 0.7;

export function balance(sections: Pick<ArrangedSection, 'lyrics'>[] | SectionTag[]): Balance {
  const total = sections.length;
  if (total === 0) return { total: 0, instrumental: 0, sung: 0, ratio: 0, note: '' };
  const instrumental = sections.filter((s) =>
    'instrumental' in s ? s.instrumental : !(s.lyrics ?? '').trim()
  ).length;
  const sung = total - instrumental;
  const ratio = instrumental / total;
  let note = '';
  if (ratio < HEALTHY_INSTRUMENTAL_MIN) {
    note =
      'Almost every section is sung — there is nowhere for the melody to be handed between instruments. ' +
      'A real arrangement here runs close to half instrumental.';
  } else if (ratio > HEALTHY_INSTRUMENTAL_MAX) {
    note = 'Mostly instrumental — check the words still carry the song.';
  }
  return { total, instrumental, sung, ratio, note };
}

/**
 * Instruments named anywhere in the arrangement — leads and layers both.
 *
 * Used to check the arrangement against the style box: an instrument that plays
 * but is never described in the style is a contradiction the generator receives
 * silently, and it is invisible reading either field alone.
 */
export function instrumentsUsed(sections: ArrangedSection[]): string[] {
  const out = new Set<string>();
  for (const s of sections) {
    for (const l of s.layers) if (l.instrument.trim()) out.add(l.instrument.trim());
    // A lead like "Flute Lead" names its instrument in the detail.
    const lead = s.detail.replace(/\b(lead|solo|instrumental|together|and)\b/gi, ' ').trim();
    if (lead) out.add(lead);
  }
  return [...out].filter(Boolean).sort();
}

/**
 * Themes stated more than once, with the leads each statement used.
 *
 * This is the orchestration view: "Theme A — 7 statements: Flute, Violin,
 * Flute, Violin, Flute, Violin, Flute and Violin Together". Seeing it as a list
 * is what makes an unvaried hand-off obvious.
 */
export function themeStatements(sections: ArrangedSection[]): Array<{ theme: string; leads: string[] }> {
  const map = new Map<string, string[]>();
  for (const s of sections) {
    const k = s.kind.trim();
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), s.detail.trim() || '—']);
  }
  return [...map.entries()]
    .filter(([, leads]) => leads.length > 1)
    .map(([theme, leads]) => ({ theme, leads }));
}
