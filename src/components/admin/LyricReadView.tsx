'use client';

/**
 * Read-mode overlay for a lyric.
 *
 * The Lyric Critic and the draft library both need "sit back and just read
 * what you wrote" — a full-viewport, non-editable, typographically calm view
 * with no toolbar and no chrome. Pressing Escape or clicking the backdrop
 * closes; a Print button hands off to the browser's print dialog so a poet
 * can send themselves a hardcopy for the couch or the studio.
 *
 * Renders as a fixed-position overlay so it works from any parent layout;
 * scrolls internally so a long lyric doesn't push the page.
 *
 * The whitespace is preserved (`whitespace-pre-wrap`) — a stanza break in
 * the editor stays a stanza break here. Font is `font-tamil` for Tamil
 * rendering; falls through to the shell's font stack for mixed content.
 */

import { useEffect, useRef } from 'react';
import { X, Printer } from 'lucide-react';

interface LyricReadViewProps {
  lyrics: string;
  title?: string;
  onClose: () => void;
}

export function LyricReadView({ lyrics, title, onClose }: LyricReadViewProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close button on open so Escape/Enter/Space work without an
  // extra tab, and screen-readers announce the modal boundary.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape closes. Attached to the document so it works even if focus has
  // wandered somewhere odd (Tamil IME popups sometimes steal it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open — the overlay has its own scroller and
  // page-behind scrolling under it feels broken.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Reading ${title}` : 'Reading lyric'}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-white/95 backdrop-blur-sm dark:bg-gray-950/95"
      onClick={(e) => {
        // Backdrop click closes; clicks inside the content column don't bubble.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top-right controls — fixed within the overlay so they stay visible
          while the lyric scrolls. Small, unobtrusive, out of the reading eye
          line. */}
      <div className="fixed right-4 top-4 flex items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="Print"
        >
          <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="Close read mode"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Reading column — max-width caps line-length so long lines break at a
          readable measure. Generous padding + line-height so it feels like a
          page, not a diff panel. */}
      <div className="mx-auto w-full max-w-2xl px-6 py-16 sm:px-8 sm:py-20">
        {title && (
          <h1 className="mb-8 text-center font-tamil text-2xl font-semibold text-gray-900 dark:text-gray-100 print:mb-6 print:text-black">
            {title}
          </h1>
        )}
        <pre
          // pre + whitespace-pre-wrap: stanza breaks + indentation preserved.
          // Tabular-nums prevents wobble on any numeric interjection.
          className="whitespace-pre-wrap font-tamil text-lg leading-relaxed text-gray-900 dark:text-gray-100 print:text-black"
          style={{ fontFamily: 'inherit' }}
        >
          {lyrics}
        </pre>
      </div>
    </div>
  );
}
