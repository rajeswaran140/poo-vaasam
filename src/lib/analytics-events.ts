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
