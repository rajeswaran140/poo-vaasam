/**
 * Open Graph image helpers, hardened for WhatsApp — the #1 organic sharing
 * channel for the diaspora-Tamil audience.
 *
 * WhatsApp's link-preview scraper is stricter than most: it only renders a rich
 * card when og:image resolves to an ABSOLUTE https URL. A relative path (e.g. a
 * future site-relative `featuredImage`, or a generated-card path) silently
 * collapses the preview to a bare link — exactly the share that DOESN'T get
 * forwarded. These helpers guarantee an absolute URL and attach descriptive alt
 * text, so a shared song looks like a card with cover art everywhere.
 *
 * Note: do NOT use seo.absoluteUrl() on image URLs — it unconditionally prefixes
 * SITE_URL and would corrupt an already-absolute CDN URL into
 * "https://tamilagaval.comhttps://cdn…". absoluteImageUrl() is the safe version.
 */

import { SITE_URL } from '@/lib/seo';

/** Already absolute (http/https/protocol-relative) or a data: URI? Leave it. */
function isAbsolute(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || src.startsWith('data:');
}

/** Resolve a possibly-relative image src to an absolute URL (CDN URLs pass through). */
export function absoluteImageUrl(src: string): string {
  const s = src.trim();
  if (isAbsolute(s)) return s;
  return `${SITE_URL}${s.startsWith('/') ? s : `/${s}`}`;
}

/**
 * Pick the cover to feature on a generated 1200×630 share card: a song's
 * bespoke hero art if it has one, else its own cover. Returns an absolute URL,
 * or undefined when there's no usable image. This is what the OG card embeds —
 * NOT what we hand WhatsApp directly (a raw square/large cover renders poorly in
 * WhatsApp's strict scraper; the card re-frames it to the right ratio + size).
 */
export function shareCardCover(
  heroImage: string | undefined | null,
  featuredImage: string | undefined | null
): string | undefined {
  const src = (heroImage && heroImage.trim()) || (featuredImage && featuredImage.trim()) || '';
  return src ? absoluteImageUrl(src) : undefined;
}

export interface OgImageDescriptor {
  url: string;
  alt?: string;
}

/**
 * Build the `openGraph.images` / `twitter.images` value for a share image.
 * Returns undefined when there's no image (so the co-located opengraph-image.tsx
 * generated card takes over). Always emits an absolute URL + alt.
 */
export function ogImage(src: string | undefined | null, alt?: string): OgImageDescriptor[] | undefined {
  if (!src || !src.trim()) return undefined;
  const descriptor: OgImageDescriptor = { url: absoluteImageUrl(src) };
  if (alt && alt.trim()) descriptor.alt = alt.trim();
  return [descriptor];
}
