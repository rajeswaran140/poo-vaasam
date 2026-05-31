/**
 * Custom GA4 event helpers — fire-and-forget wrappers around window.gtag.
 *
 * Subscribe-click attribution is the headline use case: every Subscribe CTA
 * on the site fires the same event with a `source` parameter, so GA4 can
 * report which CTA actually converts (home_hero vs floater vs footer vs
 * about vs videos_hero). The events appear in GA4 under
 * Reports → Engagement → Events → subscribe_click, with `source` as a
 * custom dimension once you register it.
 *
 * All helpers no-op safely when gtag isn't loaded (e.g. before the script
 * has hydrated, or when GA_ID is empty), so call sites never need to guard.
 */

'use client';

type GtagFn = (...args: unknown[]) => void;

function gtag(): GtagFn | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { gtag?: GtagFn };
  return typeof w.gtag === 'function' ? w.gtag : null;
}

/**
 * Fire when a visitor clicks any "Subscribe" CTA. The `source` mirrors the
 * UTM `utm_content` value we tag the outbound URL with, so attribution lines
 * up across both the GA4 event (site-side) and YouTube channel inbound
 * traffic (referral-side, when YouTube preserves UTMs).
 */
export function trackSubscribeClick(source: string): void {
  gtag()?.('event', 'subscribe_click', { source });
}

/**
 * Fire when audio starts playing for a new track (not on resume / pause /
 * scrub). Powered by the MusicPlayerProvider autoplay effect — one event per
 * track-start, including queue advances. Title is sent so we can break down
 * by song on the admin dashboard without joining on song_id.
 */
export function trackAudioPlay(songId: string, songTitle: string): void {
  gtag()?.('event', 'audio_play', { song_id: songId, song_title: songTitle });
}

/**
 * Fire when any non-Subscribe YouTube outbound click happens — channel
 * homepage, a specific video, the /videos thumbnail grid, etc. `destination`
 * is a stable key (e.g. "channel", "video:abc123", "videos-grid") so the
 * dashboard can group click-throughs by what was opened, not which page the
 * click came from. Subscribe clicks stay on their own event for clarity.
 */
export function trackYouTubeOpen(destination: string, source?: string): void {
  gtag()?.('event', 'youtube_open', source ? { destination, source } : { destination });
}
