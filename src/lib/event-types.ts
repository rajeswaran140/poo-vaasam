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
 */

import { z } from 'zod';

export const EVENT_TYPES = ['play', 'share', 'youtube', 'subscribe', 'install', 'inbound'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Payload the browser beacon sends to POST /api/events. */
export const eventBeaconSchema = z.object({
  type: z.enum(EVENT_TYPES),
  target: z.string().trim().min(1).max(120).optional(),
});
export type EventBeacon = z.infer<typeof eventBeaconSchema>;

/**
 * Make a target value safe to embed in the DynamoDB sort key, where `#` is the
 * field delimiter. Empty/whitespace collapses to "-" so every event still has a
 * stable, queryable key.
 */
export function sanitizeTarget(target?: string): string {
  const t = (target ?? '').trim().replace(/#/g, '_').slice(0, 120).trim();
  return t.length ? t : '-';
}
