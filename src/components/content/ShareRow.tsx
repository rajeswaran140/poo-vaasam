'use client';

/**
 * Working share buttons for the content detail page. Renders Facebook,
 * X (Twitter), WhatsApp and a copy-link button. On devices with the
 * Web Share API (most phones) the primary button hands off to the OS
 * sheet for richer targets (Telegram, Signal, etc.).
 */

import { useState } from 'react';
import { Link2, Check, Share2 } from 'lucide-react';
import { whatsappShareUrl } from '@/lib/whatsapp-share';
import { trackShare } from '@/lib/analytics-events';

// Inline brand glyphs — lucide-react no longer ships Facebook/Twitter logos,
// and matching the brand marks correctly is worth a few lines of SVG.
const FacebookIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const XIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const WhatsAppIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
  </svg>
);

interface ShareRowProps {
  url: string;
  title: string;
  /** Tunes the WhatsApp call-to-action: songs "listen", text "read". */
  verb?: 'listen' | 'read';
}

export function ShareRow({ url, title, verb = 'listen' }: ShareRowProps) {
  const [copied, setCopied] = useState(false);
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  const tw = `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`;
  // WhatsApp = the primary channel for this audience → a warm pre-filled message.
  const wa = whatsappShareUrl({ title, url, verb });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      trackShare('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — silently ignore; user can use a share button instead */
    }
  };

  const onNativeShare = async () => {
    try {
      await navigator.share({ title, url });
      trackShare('native');
    } catch {
      /* user cancelled or share failed — no-op */
    }
  };

  const linkClass =
    'inline-flex items-center justify-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 font-tamil text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60';
  // WhatsApp is the primary call-to-action — brand-green, leads the row.
  const waClass =
    'inline-flex items-center justify-center gap-2 rounded-full border border-transparent bg-[#25D366] px-4 py-2 font-tamil text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1ebe57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/60';

  return (
    <div className="flex flex-wrap gap-2">
      <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" className={waClass} onClick={() => trackShare('whatsapp')}>
        <WhatsAppIcon className="h-4 w-4" /> WhatsApp
      </a>
      {canNativeShare && (
        <button type="button" onClick={onNativeShare} aria-label="Share" className={linkClass}>
          <Share2 className="h-4 w-4" aria-hidden /> பகிருங்கள்
        </button>
      )}
      <a href={fb} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" className={linkClass} onClick={() => trackShare('facebook')}>
        <FacebookIcon className="h-4 w-4" /> Facebook
      </a>
      <a href={tw} target="_blank" rel="noopener noreferrer" aria-label="Share on X" className={linkClass} onClick={() => trackShare('twitter')}>
        <XIcon className="h-4 w-4" /> X
      </a>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'இணைப்பு நகலெடுக்கப்பட்டது' : 'இணைப்பை நகலெடு'}
        className={linkClass}
      >
        {copied ? <Check className="h-4 w-4 text-orange-600" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {copied ? 'நகலெடுக்கப்பட்டது' : 'இணைப்பு'}
      </button>
    </div>
  );
}
