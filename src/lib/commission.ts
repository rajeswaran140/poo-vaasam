/**
 * Music-composition commission funnel helpers.
 *
 * The /music-composition page used to hand visitors a blank /contact form — a
 * leaky funnel that produced unqualified leads. These build a STRUCTURED brief
 * from the commission form so the lead lands in /admin/messages (and the daily
 * digest) fully qualified, and so the same brief can pre-fill a WhatsApp hand-off.
 *
 * Pure — the form component owns the I/O.
 */

export interface CommissionFields {
  name: string;
  email: string;
  /** Bilingual label, e.g. "திருமணம் / Wedding". */
  occasion?: string;
  language?: string;
  /** Bilingual mood/style label. */
  mood?: string;
  length?: string;
  reference?: string;
  /** The lyrics + what they want — the heart of the brief. */
  details: string;
}

/** Bilingual select options (value === the stored/displayed bilingual label). */
export const OCCASIONS = [
  'திருமணம் / Wedding',
  'பிறந்தநாள் / Birthday',
  'காதல் / Romantic',
  'பக்தி / Devotional',
  'விளம்பரம் / Advertisement',
  'தனிப்பட்ட பரிசு / Personal gift',
  'மற்றவை / Other',
] as const;

export const MOODS = [
  'மகிழ்ச்சி / Happy',
  'சோகம் / Sad',
  'காதல் / Romantic',
  'பக்தி / Devotional',
  'நாட்டுப்புறம் / Folk',
  'அமைதி / Calm',
  'உற்சாகம் / Energetic',
] as const;

/** The subject all commission leads carry — lets Raj spot them in /admin/messages. */
export const COMMISSION_SUBJECT = 'Music Composition Commission';

/**
 * The one-line pointer to /music-composition that belongs in a song's YouTube
 * description.
 *
 * WHY IT EXISTS. Audited 2026-08-02: the service page is well built — Service +
 * AggregateOffer + FAQ schema, bilingual copy, a qualified-brief form wired to
 * /api/contact — and it has produced **zero** commissions since launch, on 83
 * pageviews and 38 sessions in 90 days. It isn't a conversion problem; almost
 * nobody reaches it. The channel has ~316k lifetime views and its descriptions
 * never mention the service, so the only route in is finding the site first.
 *
 * Bilingual and Tamil-led, because the person who wants music FOR THEIR OWN
 * LYRICS is reading the Tamil half.
 */
export const COMPOSITION_CTA_URL =
  'https://tamilagaval.com/music-composition?utm_source=youtube&utm_medium=description';

export const COMPOSITION_CTA = `🎼 உங்கள் பாடல் வரிகளுக்கு இசை வேண்டுமா? | Need music for your lyrics?\n${COMPOSITION_CTA_URL}`;

/**
 * True when a description already points at the service. Matches the PATH, not
 * the full URL, so a link carrying different UTM parameters (or none) still
 * counts — the check is "does this description route anyone to the service",
 * not "is this byte-identical to our template".
 */
export function hasCompositionCta(description: string): boolean {
  return /tamilagaval\.com\/music-composition/i.test(description ?? '');
}

/**
 * Render the fields into a clean, readable brief (stored as the contact message
 * + used as the WhatsApp pre-fill). Optional empty fields are omitted.
 */
export function buildCommissionSummary(f: CommissionFields): string {
  const lines: string[] = ['🎼 Music Composition Request', ''];
  lines.push(`Name: ${f.name.trim()}`);
  if (f.email?.trim()) lines.push(`Contact: ${f.email.trim()}`);
  if (f.occasion?.trim()) lines.push(`Occasion: ${f.occasion.trim()}`);
  if (f.language?.trim()) lines.push(`Language: ${f.language.trim()}`);
  if (f.mood?.trim()) lines.push(`Mood / Style: ${f.mood.trim()}`);
  if (f.length?.trim()) lines.push(`Length: ${f.length.trim()}`);
  if (f.reference?.trim()) lines.push(`Reference: ${f.reference.trim()}`);
  lines.push('', 'Lyrics / Details:', f.details.trim());
  return lines.join('\n');
}
