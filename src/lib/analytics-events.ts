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
 * Fire a first-party beacon to /api/events alongside GA4. Survives ad-blockers
 * that drop gtag, so the admin dashboard keeps a floor of truth. Fire-and-forget
 * — never throws, never blocks navigation (sendBeacon is built for unload).
 */
function beacon(type: string, target?: string, songId?: string): void {
  if (typeof navigator === 'undefined') return;
  const body = JSON.stringify({
    type,
    ...(target ? { target } : {}),
    ...(songId ? { songId } : {}),
  });
  try {
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch('/api/events', {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  } catch {
    // ignore — analytics must never break the page
  }
}

/**
 * Fire when a visitor clicks any "Subscribe" CTA. The `source` mirrors the
 * UTM `utm_content` value we tag the outbound URL with, so attribution lines
 * up across both the GA4 event (site-side) and YouTube channel inbound
 * traffic (referral-side, when YouTube preserves UTMs).
 */
export function trackSubscribeClick(source: string): void {
  gtag()?.('event', 'subscribe_click', { source });
  beacon('subscribe', source);
}

/**
 * Fire when audio starts playing for a new track (not on resume / pause /
 * scrub). Powered by the MusicPlayerProvider autoplay effect — one event per
 * track-start, including queue advances. Title is sent so we can break down
 * by song on the admin dashboard without joining on song_id.
 */
export function trackAudioPlay(songId: string, songTitle: string): void {
  gtag()?.('event', 'audio_play', { song_id: songId, song_title: songTitle });
  beacon('play', songId);
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
  beacon('youtube', destination);
}

/**
 * Fire when a visitor shares content. `channel` is the share surface
 * (whatsapp / whatsapp_status / facebook / copy / native) — WhatsApp is the #1
 * diaspora channel, so proving shares happen there is the whole point of owning
 * this first-party. `opts.songId` / `opts.assetId` add source-song + asset
 * attribution to the GA4 `share` event (they map to the `source_song_id` /
 * `status_asset_id` custom dimensions).
 *
 * `songId` also rides the first-party beacon, so the answer to "WHICH song do
 * people forward?" lands in DynamoDB where we can actually read it back. Until
 * the 2026-07-14 audit it was handed to GA4 and then dropped here — and nothing
 * ever read the GA4 copy, so the question was unanswerable. The beacon's
 * channel-keyed counter is unchanged; the per-song counter is derived from
 * `songId` server-side (see lib/event-types → derivedSongEvent).
 */
export function trackShare(channel: string, opts?: { songId?: string; assetId?: string }): void {
  gtag()?.('event', 'share', {
    method: channel,
    share_channel: channel,
    ...(opts?.songId ? { source_song_id: opts.songId } : {}),
    ...(opts?.assetId ? { status_asset_id: opts.assetId } : {}),
  });
  beacon('share', channel, opts?.songId);
}

/** Fire when the visitor installs the PWA (accepted the install prompt). */
export function trackInstall(): void {
  gtag()?.('event', 'pwa_install');
  beacon('install', 'pwa');
}

/**
 * Fire once on landing when the visitor arrived via a utm_source-tagged link
 * (e.g. a WhatsApp share). Makes inbound dark-social traffic measurable
 * first-party — WhatsApp otherwise arrives as direct/no-referrer. `source` is
 * the utm_source (whatsapp / facebook / …).
 */
export function trackInbound(source: string, songId?: string): void {
  gtag()?.('event', 'inbound_visit', { source, ...(songId ? { source_song_id: songId } : {}) });
  beacon('inbound', source, songId);
}
