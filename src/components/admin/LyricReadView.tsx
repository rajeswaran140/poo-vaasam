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

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, Copy, Check } from 'lucide-react';

interface LyricReadViewProps {
  lyrics: string;
  title?: string;
  onClose: () => void;
}

// `null` = nothing recently copied, `'all'` = the whole lyric, a number =
// the line index. Read view supports both because a Suno prompt wants the
// whole block, while iterating with an AI reviewer usually wants one line.
type CopyTarget = null | 'all' | number;

export function LyricReadView({ lyrics, title, onClose }: LyricReadViewProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState<CopyTarget>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lines = useMemo(() => lyrics.split('\n'), [lyrics]);

  async function copy(text: string, target: CopyTarget) {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      // Older browsers / locked-down policies — surface it rather than
      // silently swallowing so the poet notices and can retry.
      setCopied(null);
    }
  }

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

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
          onClick={() => copy(lyrics, 'all')}
          disabled={!lyrics.trim()}
          className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="Copy all lyrics"
          aria-live="polite"
          title="Copy the whole lyric — good for a Suno prompt"
        >
          {copied === 'all' ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy all
            </>
          )}
        </button>
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
        {/* Per-line rendering so each non-blank line gets its own hover
            copy affordance — good for "just this line, please" iterations
            with an AI reviewer. Blank source lines render as an nbsp so a
            stanza break still occupies vertical space. Wrapping is via
            whitespace-pre-wrap on each row, so a long line still wraps to
            multiple visual rows without losing its copy target. */}
        <div className="font-tamil text-lg leading-relaxed text-gray-900 dark:text-gray-100 print:text-black">
          {lines.map((line, i) => {
            const hasText = line.trim().length > 0;
            return (
              <div
                key={i}
                data-testid="lyric-line"
                className="group relative -mx-2 flex items-start rounded px-2 hover:bg-gray-100/60 dark:hover:bg-gray-800/40"
                style={{ fontFamily: 'inherit' }}
              >
                <span className="whitespace-pre-wrap">{line || ' '}</span>
                {hasText && (
                  <button
                    type="button"
                    onClick={() => copy(line, i)}
                    aria-label={`Copy line ${i + 1}`}
                    title="Copy this line"
                    className="ml-auto flex-shrink-0 self-center pl-3 text-gray-400 opacity-0 transition-opacity hover:text-gray-700 focus:opacity-100 group-hover:opacity-100 dark:text-gray-500 dark:hover:text-gray-200 print:hidden"
                  >
                    {copied === i ? (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
