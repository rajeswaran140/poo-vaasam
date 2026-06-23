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
