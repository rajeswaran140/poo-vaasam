'use client';

/**
 * Records inbound dark-social arrivals first-party. When a visitor lands via a
 * utm_source-tagged link (e.g. a WhatsApp share — see lib/whatsapp-share), this
 * fires one `inbound` event so the channel is measurable in the admin dashboard,
 * not just GA4 (which ad-blockers drop). Renders nothing; mounted once globally.
 *
 * Only a small allow-list of sources is recorded so the metric stays meaningful
 * (a random ?utm_source in the wild doesn't pollute it).
 */

import { useEffect } from 'react';
import { trackInbound } from '@/lib/analytics-events';

// Includes our OWN share surfaces (the native OS sheet and copy-link), because
// on a phone those are the two commonest ways a link actually reaches WhatsApp —
// and while they went out untagged, the return visit arrived as "direct" and
// this never fired. We can't know which app the OS sheet handed off to, so we
// record the surface honestly instead of assuming "whatsapp".
const KNOWN_SOURCES = new Set([
  'whatsapp',
  'facebook',
  'telegram',
  'instagram',
  'twitter',
  'native',
  'copy',
]);

export function InboundTracker() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const source = params.get('utm_source')?.toLowerCase();
      // utm_content carries the source song id on Status/share links, so an
      // inbound landing is attributable to the exact song that was shared.
      const songId = params.get('utm_content') || undefined;
      if (source && KNOWN_SOURCES.has(source)) trackInbound(source, songId);
    } catch {
      // analytics must never break the page
    }
  }, []);

  return null;
}
