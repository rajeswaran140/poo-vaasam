'use client';

/**
 * The Lyric Critic's writing surface — a Tamil-typing textarea with a save
 * indicator.
 *
 * WHY THIS EXISTS RATHER THAN <TamilTextarea>. That component predates the
 * admin dark theme: it hardcodes light-mode greys and a purple accent, renders
 * its own label row, and has never been mounted on any page. Reusing it here
 * would have dropped a light-only block into a dark form. This keeps the same
 * transliteration engine (react-transliterate, the behaviour Raj gets from
 * Google Input Tools) and inherits the form's own styling instead.
 *
 * The toggle matters: transliteration is right when composing from English
 * phonetics, wrong when pasting or fixing existing Tamil — the suggestion popup
 * fires on every word and gets in the way. Both modes write to the same value.
 */

import { useEffect, useRef, useState } from 'react';
import { ReactTransliterate } from 'react-transliterate';
import 'react-transliterate/dist/index.css';
import { Languages, Keyboard, Maximize2, Minimize2, Copy, Check, ZoomIn, ZoomOut } from 'lucide-react';
import type { AutosaveStatus } from '@/lib/lyric-autosave';
import { autosaveLabel } from '@/lib/lyric-autosave';
import { useInputtoolsProxyOverride } from '@/lib/transliterate-proxy';

/**
 * Font-size zoom for the textarea. Tamil combines vowels + consonants into
 * glyph clusters that get hard to proofread at the default 16px on a big
 * screen — the two extra steps here (18px and 20px) match what Raj already
 * uses when zooming the whole browser page, but scoped to the editor so the
 * rest of the admin chrome stays put. Persisted per-browser so re-opening
 * the form doesn't force resetting each time.
 */
const ZOOM_LEVELS = ['text-base', 'text-lg', 'text-xl', 'text-2xl'] as const;
const DEFAULT_ZOOM_INDEX = 0;
const ZOOM_STORAGE_KEY = 'lyric-editor:zoom';

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  status?: AutosaveStatus;
  /**
   * Caret position after a click, key or selection change — lets the parent
   * work out which word is under the cursor. Reported rather than resolved
   * here: this component owns typing, not what the word means.
   */
  onCaret?: (caret: number) => void;
  /** Extra hint shown beside the status, e.g. the last-saved time. */
  statusDetail?: string;
}

const STATUS_TONE: Record<AutosaveStatus, string> = {
  clean: 'text-gray-400 dark:text-gray-500',
  dirty: 'text-amber-600 dark:text-amber-400',
  saving: 'text-gray-500 dark:text-gray-400',
  saved: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
};

export function LyricDraftEditor({
  id,
  value,
  onChange,
  rows = 14,
  maxLength = 8000,
  placeholder,
  className = '',
  status = 'clean',
  statusDetail,
  onCaret,
}: Props) {
  const [translit, setTranslit] = useState(true);
  // Full-viewport edit mode. Textarea + toolbar + transliteration all stay
  // live — this is FOCUS mode, not read mode. Autosave still fires from the
  // parent's effect because the component doesn't unmount.
  const [expanded, setExpanded] = useState(false);
  // Copy-all flashes to a check for ~1.5s so the user gets non-toast
  // feedback the write to the clipboard actually happened.
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Zoom index defaults to base and hydrates from localStorage in an effect
  // so SSR + client match; a direct localStorage read in useState would
  // trip Next's hydration diff on the first render.
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isInteger(n) && n >= 0 && n < ZOOM_LEVELS.length) setZoomIndex(n);
    } catch {
      /* private mode / disabled storage — keep default */
    }
  }, []);
  function setZoom(nextIndex: number) {
    const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, nextIndex));
    setZoomIndex(clamped);
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }
  const zoomClass = ZOOM_LEVELS[zoomIndex];
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  useInputtoolsProxyOverride();
  const reportCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
    onCaret?.(e.currentTarget.selectionStart ?? 0);
  const label = autosaveLabel(status);

  // Escape collapses. Attached to document so an IME popup can't swallow it.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Lock body scroll while expanded — the overlay has its own space.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  // Clear any pending "copied" reset if we unmount, so a stale timer
  // doesn't try to setState after teardown.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  async function copyAll() {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers or a locked-down policy — fall back to selecting
      // the textarea so the user can hit Ctrl/Cmd-C themselves.
      const el = document.getElementById(id) as HTMLTextAreaElement | null;
      el?.select();
    }
  }

  // Base textarea styling — used in both normal and expanded modes. In
  // expanded mode we override the height so the field fills the viewport.
  const shared =
    `mt-1 w-full rounded-lg border px-3 py-2 font-tamil border-gray-300 bg-white text-gray-900 ` +
    `focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 ` +
    `dark:bg-gray-900 dark:text-gray-100 ${className}` +
    (expanded ? ' resize-none' : '');

  // Expanded mode wraps the whole editor in a fixed overlay. Same DOM tree,
  // so the ReactTransliterate context + suggestion popup + autosave state
  // all persist across the toggle. z-50 puts us above the admin sidebar
  // (also z-50, but earlier in DOM order) and the sticky admin header (z-40)
  // — anything lower left the sidebar visibly on top of the "expanded" view.
  //
  // NB: no `overflow-hidden` here. It clipped the transliteration suggestion
  // popup (position:absolute inside the wrapper, positioned at caret+10) so
  // suggestions rendered when typing near the bottom of the textarea were
  // both invisible AND non-interactive. Body-scroll is locked by the effect
  // above, so the overflow-hidden here was doing nothing except clipping.
  const wrapperClass = expanded
    ? 'fixed inset-0 z-50 flex flex-col bg-white p-6 sm:p-10 dark:bg-gray-950'
    : '';

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setTranslit((t) => !t)}
          aria-pressed={translit}
          className="flex items-center gap-1.5 rounded-md bg-purple-50 px-2.5 py-1 text-xs text-purple-700 transition-colors hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
          title={translit ? 'Switch to direct Tamil input' : 'Switch to English → Tamil typing'}
        >
          {translit ? (
            <>
              <Languages className="h-3 w-3" aria-hidden="true" />
              English → Tamil
            </>
          ) : (
            <>
              <Keyboard className="h-3 w-3" aria-hidden="true" />
              Direct Tamil
            </>
          )}
        </button>
        {label && (
          <span className={`text-xs ${STATUS_TONE[status]}`} role="status" data-testid="autosave-status">
            {label}
            {statusDetail && status === 'saved' ? ` · ${statusDetail}` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Zoom pair. Kept compact (icon-only + a small level label) so the
              toolbar doesn't grow — every existing button still has room. */}
          <div
            role="group"
            aria-label="Text size"
            className="flex items-center gap-0 overflow-hidden rounded-md border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
          >
            <button
              type="button"
              onClick={() => setZoom(zoomIndex - 1)}
              disabled={!canZoomOut}
              aria-label="Decrease text size"
              className="px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Smaller (fits more on screen)"
            >
              <ZoomOut className="h-3 w-3" aria-hidden="true" />
            </button>
            <span
              className="min-w-[1.75rem] border-x border-gray-200 px-1 text-center text-[10px] font-medium tabular-nums text-gray-500 dark:border-gray-800 dark:text-gray-400"
              aria-hidden="true"
            >
              {zoomIndex + 1}/{ZOOM_LEVELS.length}
            </span>
            <button
              type="button"
              onClick={() => setZoom(zoomIndex + 1)}
              disabled={!canZoomIn}
              aria-label="Increase text size"
              className="px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Bigger (easier to proofread Tamil glyphs)"
            >
              <ZoomIn className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={copyAll}
            disabled={!value.trim()}
            aria-label="Copy all lyrics"
            aria-live="polite"
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            title="Copy the whole lyric to the clipboard — paste into Suno, ChatGPT, etc."
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-green-600 dark:text-green-400" aria-hidden="true" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" aria-hidden="true" /> Copy
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-pressed={expanded}
            aria-label={expanded ? 'Collapse editor' : 'Expand editor to full screen'}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            title={expanded ? 'Collapse (Esc)' : 'Expand to full screen'}
          >
            {expanded ? (
              <>
                <Minimize2 className="h-3 w-3" aria-hidden="true" /> Collapse
              </>
            ) : (
              <>
                <Maximize2 className="h-3 w-3" aria-hidden="true" /> Expand
              </>
            )}
          </button>
        </div>
      </div>

      {/* In expanded mode the field grows to fill the flex column and caps
          its readable width — a viewport-wide textarea produces long,
          hard-to-scan lines on a big monitor, so we centre a comfortable
          reading column. `flex-1 min-h-0` on the wrapper lets the textarea
          take all remaining vertical space; `mx-auto max-w-3xl w-full`
          centres it. Normal mode is unchanged. */}
      <div className={expanded ? 'mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col' : ''}>
        {translit ? (
          <ReactTransliterate
            value={value}
            onChangeText={onChange}
            lang="ta"
            placeholder={placeholder}
            containerClassName={expanded ? 'relative flex flex-1 min-h-0 flex-col' : 'relative'}
            activeItemStyles={{ backgroundColor: '#7C3AED', color: 'white' }}
            renderComponent={(props: Record<string, unknown>) => (
              <textarea
                {...props}
                id={id}
                rows={expanded ? undefined : rows}
                maxLength={maxLength}
                dir="auto"
                className={`${shared} ${zoomClass}${expanded ? ' flex-1 h-full' : ''}`}
                onSelect={reportCaret}
                onClick={reportCaret}
                onKeyUp={reportCaret}
              />
            )}
          />
        ) : (
          <textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={expanded ? undefined : rows}
            maxLength={maxLength}
            dir="auto"
            placeholder={placeholder}
            className={`${shared}${expanded ? ' flex-1 h-full text-base' : ''}`}
            onSelect={reportCaret}
            onClick={reportCaret}
            onKeyUp={reportCaret}
          />
        )}
      </div>
    </div>
  );
}
