/**
 * Karaoke commission funnel helpers.
 *
 * A karaoke request is a much SHORTER brief than a music commission: the buyer
 * is not describing a song to be written, they are naming one that already
 * exists in this catalogue. So this deliberately does not reuse
 * `CommissionFields` — occasion, mood, length and reference have no meaning
 * here, and a form that asks for them reads as a form nobody thought about.
 *
 * Pure — the form component owns the I/O, exactly as `commission.ts` does.
 */

/** Price for one karaoke version. Derived from the first real sale: CAD $80 agreed for two. */
export const KARAOKE_PRICE_CURRENCY = 'CAD';
export const KARAOKE_PRICE = 40;
export const KARAOKE_PRICE_LABEL = `${KARAOKE_PRICE_CURRENCY} $${KARAOKE_PRICE}`;

/**
 * ONE constant feeds the price card, the schema Offer and the FAQ answer.
 *
 * The /music-composition page carries a comment recording why: an audit found
 * its card saying "CAD $75 / 5-7 days" while its schema and FAQ said something
 * else. Three hand-maintained copies of a number will drift. Do not add a fourth.
 */
export const KARAOKE_TURNAROUND_DAYS = '3–5';
export const KARAOKE_TURNAROUND_LABEL = `${KARAOKE_TURNAROUND_DAYS} working days`;

/** The subject every karaoke lead carries, so it is spottable in /admin/messages. */
export const KARAOKE_SUBJECT = 'Karaoke Request';

export interface KaraokeFields {
  name: string;
  email: string;
  /** Which song from the catalogue. Free text, because the picker may be empty. */
  song: string;
  /** Anything else — a key change, a shorter edit, the occasion. Optional. */
  notes?: string;
}

/**
 * Build the structured brief that lands in /admin/messages.
 *
 * Mirrors `buildCommissionSummary`: labelled lines, blank fields omitted, so a
 * lead is readable at a glance rather than a wall of empty labels.
 */
export function buildKaraokeSummary(f: KaraokeFields): string {
  const lines = [
    `Song: ${f.song.trim() || '(not specified)'}`,
    f.notes?.trim() ? `Notes: ${f.notes.trim()}` : '',
    '',
    `Price quoted: ${KARAOKE_PRICE_LABEL} per song`,
    `Turnaround quoted: ${KARAOKE_TURNAROUND_LABEL}`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}

/**
 * What the buyer actually receives. Stated in one place because it is a
 * promise: it appears on the page, in the FAQ and in the confirmation.
 *
 * "No lead or backing vocals" matters — a karaoke bed is built by summing the
 * non-vocal stems, and a buyer who hears a stray backing line will rightly
 * say it is not karaoke.
 */
export const KARAOKE_DELIVERABLE = [
  '320 kbps MP3',
  'No lead or backing vocals',
  'Mastered with headroom for your own voice',
  'One-time private download link',
] as const;
