'use client';

/**
 * Persistent floating "Subscribe" pill that sits at the bottom-right of every
 * page, above the BackToTop button. Always visible (no scroll gating) — the
 * point is to keep the channel one click away even after the visitor scrolls
 * past the hero/footer CTAs. Dismissible per-session via a small × button so
 * we don't pester anyone who's already subscribed.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isYouTubeChannelConfigured, youtubeSubscribeUrl } from '@/config/site';

const DISMISS_KEY = 'tamilagaval:subscribe-floater:dismissed';

export function FloatingSubscribe() {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid SSR/CSR flicker

  useEffect(() => {
    if (!isYouTubeChannelConfigured()) return;
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || !isYouTubeChannelConfigured()) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch { /* ignore — storage may be blocked in private mode */ }
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-1 animate-fade-in-up">
      <a
        href={youtubeSubscribeUrl('floater')}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="YouTube சந்தா"
        title="YouTube சந்தா"
        className="group inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white shadow-2xl shadow-black/40 ring-1 ring-white/20 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="மூடு"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/80 shadow-lg ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
