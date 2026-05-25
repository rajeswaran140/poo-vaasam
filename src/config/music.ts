/**
 * Music Composition service configuration.
 *
 * Fill these in to enrich the /music-composition page. Both are optional —
 * the page degrades gracefully when they're empty (samples fall back to a
 * link to the YouTube channel; the WhatsApp button is simply hidden).
 */
export const MUSIC = {
  /** YouTube video URLs to showcase as sample compositions. */
  sampleVideoUrls: [] as string[],
  /** WhatsApp number, international format, digits only (e.g. '15551234567'). */
  whatsappNumber: '',
};

export function hasMusicSamples(): boolean {
  return MUSIC.sampleVideoUrls.length > 0;
}

export function hasWhatsApp(): boolean {
  return /^\d{8,15}$/.test(MUSIC.whatsappNumber);
}

export function whatsappLink(text = 'Hi, I would like a music composition.'): string {
  return `https://wa.me/${MUSIC.whatsappNumber}?text=${encodeURIComponent(text)}`;
}
