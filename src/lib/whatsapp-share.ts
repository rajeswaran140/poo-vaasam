/**
 * WhatsApp is the #1 organic sharing channel for the diaspora-Tamil audience, so
 * the pre-filled message matters: a warm call-to-action (emoji + Tamil verb +
 * title + link) gets forwarded far more than a bare URL. `wa.me/?text=` with no
 * phone number opens WhatsApp and lets the user pick any chat / group / Status.
 */

export interface WhatsAppShareOptions {
  title: string;
  url: string;
  /** How the content is consumed — picks the Tamil call-to-action + emoji. */
  verb?: 'listen' | 'read';
}

/** The human-readable message WhatsApp pre-fills (before URL-encoding). */
export function whatsappShareText({ title, url, verb = 'listen' }: WhatsAppShareOptions): string {
  const cta = verb === 'read' ? 'படியுங்கள்' : 'கேளுங்கள்';
  const emoji = verb === 'read' ? '📜' : '🎵';
  return `${emoji} ${title} — ${cta}: ${url}`;
}

/** `wa.me` share link with the pre-filled, URL-encoded message. */
export function whatsappShareUrl(opts: WhatsAppShareOptions): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsappShareText(opts))}`;
}
