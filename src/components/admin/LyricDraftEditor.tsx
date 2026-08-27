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

import { useEffect, useState } from 'react';
import { ReactTransliterate } from 'react-transliterate';
import 'react-transliterate/dist/index.css';
import { Languages, Keyboard, Maximize2, Minimize2 } from 'lucide-react';
import type { AutosaveStatus } from '@/lib/lyric-autosave';
import { autosaveLabel } from '@/lib/lyric-autosave';
import { useInputtoolsProxyOverride } from '@/lib/transliterate-proxy';

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
  const wrapperClass = expanded
    ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-white p-6 sm:p-10 dark:bg-gray-950'
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
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-pressed={expanded}
          aria-label={expanded ? 'Collapse editor' : 'Expand editor to full screen'}
          className="ml-auto flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
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

      {/* In expanded mode the field grows to fill the flex column; in normal
          mode it uses `rows` as before. `flex-1 min-h-0` on the wrapper lets
          the textarea take all remaining vertical space in expanded mode
          while a plain `<textarea rows>` still respects rows in normal mode. */}
      <div className={expanded ? 'flex flex-1 min-h-0 flex-col' : ''}>
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
                className={`${shared}${expanded ? ' flex-1 h-full text-base' : ''}`}
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
