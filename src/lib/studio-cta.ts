/**
 * TamilAgaval Studio CTA — the link from this site to the mastering pilot, and
 * the funnel steps it owns.
 *
 * WHY THIS EXISTS. The mastering demand test has been live since 2026-07-24 and
 * had recorded 6 pageviews and 0 signups by 2026-08-10. That number cannot
 * answer the question it was built for: it cannot separate "nobody came" from
 * "they came and did not want it". The test was never shown to anyone. This is
 * the route that shows it to the one audience that already exists.
 *
 * WHY THE SITE AND NOT THE 95 VIDEO DESCRIPTIONS. Raj's call, and it is the
 * right one: a visitor who has already crossed from YouTube into tamilagaval.com
 * is a far better prospect for a creator service than a casual listener, and the
 * music-composition CTA was only just swept across the catalogue — adding a
 * second offer there would contaminate both experiments, leaving neither
 * readable.
 *
 * ⚠️ THE PARAMETER IS `cta_source`, NEVER `source`.
 * `source` is a GA4 RESERVED campaign field. An event parameter of that name
 * silently rewrites the session's traffic source — the bug that once credited
 * 50 sessions to `songs_list_row` instead of youtube.com. The same convention
 * already guards `link_placement` / `cta_source` / `inbound_source` in
 * analytics-events.ts. Do not "simplify" this back to `source`.
 *
 * Pure — no DOM, no network. The component owns the I/O.
 */

/** The live pilot page. Amplify app d1u7y9f55dq005 (its own AWS app, not this one). */
export const STUDIO_URL = 'https://main.d1u7y9f55dq005.amplifyapp.com';

/**
 * Where a click came from. Kept as a closed set so a typo cannot silently
 * create a placement that then looks like it converts at 0%.
 */
export const STUDIO_PLACEMENTS = ['site_nav', 'song_page', 'songs_list', 'footer'] as const;
export type StudioPlacement = (typeof STUDIO_PLACEMENTS)[number];

/**
 * The two funnel steps this site owns. The remaining five
 * (mastering_page_view → demo_play → pricing_view → signup_start →
 * signup_complete) are fired by the pilot page itself.
 */
export const STUDIO_IMPRESSION = 'studio_impression';
export const STUDIO_CLICK = 'studio_click';

/** Endpoint the pilot's funnel counters live behind (CORS is open to this site). */
export const STUDIO_EVENT_ENDPOINT =
  'https://ayqpvu9amk.execute-api.us-east-1.amazonaws.com/event';

/**
 * The outbound URL, carrying the placement so the pilot page can attribute the
 * visit. Without this, once a second surface exists the aggregate click count
 * hides which placement actually works — which is the whole reason for adding
 * it before the second surface rather than after.
 */
export function studioUrl(placement: StudioPlacement): string {
  const u = new URL(STUDIO_URL);
  u.searchParams.set('cta_source', placement);
  return u.toString();
}

/** Read the placement back off a landing URL. Returns null for anything unknown. */
export function placementFromUrl(url: string): StudioPlacement | null {
  try {
    const v = new URL(url).searchParams.get('cta_source');
    return (STUDIO_PLACEMENTS as readonly string[]).includes(v ?? '')
      ? (v as StudioPlacement)
      : null;
  } catch {
    return null;
  }
}

/** The pilot's headline terms, kept in one place so the site cannot drift from the page. */
export const STUDIO_PRICE_CAD = 25;
export const STUDIO_PILOT_TRACKS = 5;
