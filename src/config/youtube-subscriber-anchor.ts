/**
 * Exact-subscriber anchors.
 *
 * `channels.list` rounds `subscriberCount` to 3 significant figures above 1,000
 * (a true 1,118 is served as 1,110), so the public API can never give us an
 * exact figure. Studio's Realtime card CAN — it is exact for the channel owner
 * — and one exact reading plus Analytics' daily `subscribersGained/Lost` is
 * enough to reconstruct an exact count going forward.
 *
 * WHY A DATED LIST RATHER THAN A CONSTANT. Accumulation drifts: every day of
 * gained/lost carries its own rounding and revision, so the derived figure
 * slowly diverges from truth. Re-anchoring is therefore expected maintenance,
 * not a bug fix — and keeping the anchors as a dated list means a re-anchor is
 * one appended line with a visible history, instead of a silent edit to a magic
 * number where the old value is lost.
 *
 * TO RE-ANCHOR: read the Realtime card in YouTube Studio, append an entry with
 * today's date, and leave the old ones in place.
 */

export interface SubscriberAnchor {
  /** YYYY-MM-DD the reading was taken. */
  date: string;
  /** Exact subscriber count as shown by Studio's Realtime card. */
  count: number;
  /** Where the number came from, so a future reader can re-derive it. */
  source: string;
}

/** Newest LAST. `latestSubscriberAnchor()` picks the most recent. */
export const SUBSCRIBER_ANCHORS: readonly SubscriberAnchor[] = [
  { date: '2026-07-27', count: 1118, source: 'YouTube Studio Realtime card' },
] as const;

/** Most recent anchor at or before `onOrBefore` (default: the newest of all). */
export function latestSubscriberAnchor(onOrBefore?: string): SubscriberAnchor | null {
  const usable = SUBSCRIBER_ANCHORS.filter((a) => !onOrBefore || a.date <= onOrBefore);
  if (!usable.length) return null;
  return usable.reduce((best, a) => (a.date > best.date ? a : best));
}
