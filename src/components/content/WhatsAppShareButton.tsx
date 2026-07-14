'use client';

/**
 * Compact, reusable WhatsApp share button — WhatsApp is the #1 organic channel
 * for the diaspora-Tamil audience, so it belongs on every browse surface (song
 * rows, tiles, home), not just the content detail page. Pre-fills a warm Tamil
 * message + the (absolute) link so a forward renders a rich card; records the
 * share first-party via trackShare so dark-social is measurable.
 *
 * `compact` renders an icon-only pill (for dense rows/tiles); otherwise a
 * labelled brand-green button. Pass an ABSOLUTE url (WhatsApp needs it).
 *
 * `asButton` renders a <button> (opens WhatsApp via window.open) instead of an
 * <a>. Use it on browse tiles whose whole card is already a <Link> — an <a>
 * can't nest inside an <a> (invalid HTML → hydration mismatch). The button
 * swallows the click so sharing doesn't also navigate into the content page.
 */

import { whatsappShareUrl } from '@/lib/whatsapp-share';
import { trackShare } from '@/lib/analytics-events';

export const WhatsAppGlyph = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
  </svg>
);

interface Props {
  /** ABSOLUTE url to the content (WhatsApp only previews absolute links). */
  url: string;
  title: string;
  /** Tamil call-to-action: songs "listen" (கேளுங்கள்), text "read" (படியுங்கள்). */
  verb?: 'listen' | 'read';
  /** Icon-only pill for dense rows/tiles. */
  compact?: boolean;
  /** Render a <button> (window.open) instead of <a> — for tiles wrapped in a Link. */
  asButton?: boolean;
  /**
   * The song being shared. Powers the per-song share counter (share_song) so we
   * can answer "which song do people actually forward?" — pass it wherever the
   * id is to hand.
   */
  songId?: string;
  className?: string;
}

export function WhatsAppShareButton({ url, title, verb = 'listen', compact = false, asButton = false, songId, className = '' }: Props) {
  const href = whatsappShareUrl({ title, url, verb });
  const label = `${title} — WhatsApp-இல் பகிருங்கள்`;
  const record = () => trackShare('whatsapp', songId ? { songId } : undefined);

  if (asButton) {
    // The whole card is a <Link>, so we can't emit a nested <a>. A <button>
    // that opens WhatsApp and stops propagation shares without also following
    // the card link (mirrors the like-button pattern already used on tiles).
    const onClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      record();
      window.open(href, '_blank', 'noopener,noreferrer');
    };
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title="WhatsApp-இல் பகிருங்கள்"
        className={`flex shrink-0 items-center rounded-full p-2 text-[#25D366] transition-colors hover:bg-[#25D366]/10 hover:text-[#1ebe57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/60 ${className}`}
      >
        <WhatsAppGlyph className="h-[18px] w-[18px]" />
      </button>
    );
  }

  if (compact) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title="WhatsApp-இல் பகிருங்கள்"
        onClick={record}
        className={`flex shrink-0 items-center px-2 py-2.5 text-[#25D366] transition-colors hover:text-[#1ebe57] focus-visible:text-[#1ebe57] focus-visible:outline-none ${className}`}
      >
        <WhatsAppGlyph className="h-[18px] w-[18px]" />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      onClick={record}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-2 font-tamil text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1ebe57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/60 ${className}`}
    >
      <WhatsAppGlyph className="h-4 w-4" /> WhatsApp
    </a>
  );
}
