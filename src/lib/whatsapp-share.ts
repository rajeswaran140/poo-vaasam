/**
 * WhatsApp is the #1 organic sharing channel for the diaspora-Tamil audience, so
 * the pre-filled message matters: a warm call-to-action (emoji + Tamil verb +
 * title + link) gets forwarded far more than a bare URL. `wa.me/?text=` with no
 * phone number opens WhatsApp and lets the user pick any chat / group / Status.
 *
 * The shared link is tagged `utm_source=whatsapp&utm_medium=share` so the inbound
 * visit it generates is attributable (otherwise WhatsApp arrives as direct/
 * no-referrer dark social) — GA4 reads UTMs natively + InboundTracker catches it
 * first-party.
 */

import { appendUtm } from '@/lib/utm';

export interface WhatsAppShareOptions {
  title: string;
  url: string;
  /** How the content is consumed — picks the Tamil call-to-action + emoji. */
  verb?: 'listen' | 'read';
  /**
   * Extra/override UTM tags merged over the defaults (`utm_source=whatsapp`,
   * `utm_medium=share`). Lets a specific surface attribute more precisely — e.g.
   * a WhatsApp *Status* share passes `utm_medium=whatsapp_status` +
   * `utm_content=<songId>` so inbound visits trace back to the exact song.
   */
  utm?: Record<string, string>;
}

/** The human-readable message WhatsApp pre-fills (before URL-encoding). */
export function whatsappShareText({ title, url, verb = 'listen', utm }: WhatsAppShareOptions): string {
  const cta = verb === 'read' ? 'படியுங்கள்' : 'கேளுங்கள்';
  const emoji = verb === 'read' ? '📜' : '🎵';
  const tagged = appendUtm(url, { utm_source: 'whatsapp', utm_medium: 'share', ...utm });
  return `${emoji} ${title} — ${cta}: ${tagged}`;
}

/** `wa.me` share link with the pre-filled, URL-encoded message. */
export function whatsappShareUrl(opts: WhatsAppShareOptions): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsappShareText(opts))}`;
}
