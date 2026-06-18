/**
 * Music Composition service configuration.
 *
 * Fill these in to enrich the /music-composition page. Both are optional —
 * the page degrades gracefully when they're empty (samples fall back to a
 * link to the YouTube channel; the WhatsApp button is simply hidden).
 */
export const MUSIC = {
  /** YouTube video URLs to showcase as sample compositions. Verified full-length
   *  songs from the channel (not Shorts/teasers) — swap freely. */
  sampleVideoUrls: [
    'https://www.youtube.com/watch?v=KtFF0CCnCY4', // என் பொன்மணி
    'https://www.youtube.com/watch?v=H5NcoS41fA4', // செவ்வந்தி பூவே
    'https://www.youtube.com/watch?v=DrPPkgumCQw', // காலை காற்றே
    'https://www.youtube.com/watch?v=BoHXKQCfOqU', // குறிஞ்சி மலரே
  ] as string[],
  /** WhatsApp number, international format, digits only (e.g. '15551234567').
   *  Toronto number 416-678-2728 with the Canadian country code (1). */
  whatsappNumber: '14166782728',
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
