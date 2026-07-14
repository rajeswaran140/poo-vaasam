/**
 * First-party analytics event contract — shared by the client beacon and the
 * server store. These are the interactions GA4 either misses (ad-blocked) or
 * that we want to OWN in DynamoDB: audio plays, shares (esp. WhatsApp — the #1
 * diaspora channel), outbound YouTube opens, subscribe clicks, PWA installs.
 *
 * `target` is a single free-form key whose meaning depends on `type`:
 *   play → song id · share → channel (whatsapp/facebook/copy/native) ·
 *   youtube → destination (channel / video:<id>) · subscribe → source CTA ·
 *   install → "pwa" · inbound → referral source (whatsapp/…), captured on
 *   landing from a utm_source-tagged link. This keeps per-type top-N breakdowns
 *   cheap without a second dimension.
 *
 * PER-SONG ATTRIBUTION. A share/inbound beacon may additionally carry `songId`.
 * The channel-keyed counter is written EXACTLY as before (the existing dashboard
 * breakdown depends on it), and a second DERIVED counter records the song. That
 * answers "which song do people actually forward?" — which, until the 2026-07-14
 * audit, nothing could: `trackShare` accepted a songId, handed it to GA4, then
 * dropped it before the beacon, and the GA4 copy was never read back.
 *
 * Derived types are deliberately NOT client-sendable: the beacon is public and
 * unauthenticated, so `eventBeaconSchema` accepts only EVENT_TYPES and the
 * SERVER decides what else to write.
 */

import { z } from 'zod';

/** Types a browser may POST to /api/events. */
export const EVENT_TYPES = ['play', 'share', 'youtube', 'subscribe', 'install', 'inbound'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Types only the SERVER writes, derived from a beacon's `songId`. */
export const DERIVED_EVENT_TYPES = ['share_song', 'inbound_song'] as const;
export type DerivedEventType = (typeof DERIVED_EVENT_TYPES)[number];

/** Everything the store may persist. */
export const STORE_EVENT_TYPES = [...EVENT_TYPES, ...DERIVED_EVENT_TYPES] as const;
export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

/** Payload the browser beacon sends to POST /api/events. */
export const eventBeaconSchema = z.object({
  type: z.enum(EVENT_TYPES),
  target: z.string().trim().min(1).max(120).optional(),
  /** Which song this share/landing was about — powers the per-song counter. */
  songId: z.string().trim().min(1).max(120).optional(),
});
export type EventBeacon = z.infer<typeof eventBeaconSchema>;

/** Which client events carry per-song meaning, and what they derive into. */
const SONG_DERIVATIONS: Partial<Record<EventType, DerivedEventType>> = {
  share: 'share_song',
  inbound: 'inbound_song',
};

/**
 * The extra per-song counter a beacon implies, if any. Pure, so the route stays
 * a thin adapter and the rule itself is unit-testable.
 */
export function derivedSongEvent(
  beacon: EventBeacon
): { type: DerivedEventType; target: string } | null {
  if (!beacon.songId) return null;
  const type = SONG_DERIVATIONS[beacon.type];
  return type ? { type, target: beacon.songId } : null;
}

/**
 * Make a target value safe to embed in the DynamoDB sort key, where `#` is the
 * field delimiter. Empty/whitespace collapses to "-" so every event still has a
 * stable, queryable key.
 */
export function sanitizeTarget(target?: string): string {
  const t = (target ?? '').trim().replace(/#/g, '_').slice(0, 120).trim();
  return t.length ? t : '-';
}
