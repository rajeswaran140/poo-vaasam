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

import { useState } from 'react';
import { ReactTransliterate } from 'react-transliterate';
import 'react-transliterate/dist/index.css';
import { Languages, Keyboard } from 'lucide-react';
import type { AutosaveStatus } from '@/lib/lyric-autosave';
import { autosaveLabel } from '@/lib/lyric-autosave';

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  status?: AutosaveStatus;
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
}: Props) {
  const [translit, setTranslit] = useState(true);
  const label = autosaveLabel(status);

  const shared =
    `mt-1 w-full rounded-lg border px-3 py-2 font-tamil border-gray-300 bg-white text-gray-900 ` +
    `focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 ` +
    `dark:bg-gray-900 dark:text-gray-100 ${className}`;

  return (
    <div>
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
      </div>

      {translit ? (
        <ReactTransliterate
          value={value}
          onChangeText={onChange}
          lang="ta"
          placeholder={placeholder}
          containerClassName="relative"
          activeItemStyles={{ backgroundColor: '#7C3AED', color: 'white' }}
          renderComponent={(props: Record<string, unknown>) => (
            <textarea {...props} id={id} rows={rows} maxLength={maxLength} dir="auto" className={shared} />
          )}
        />
      ) : (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          dir="auto"
          placeholder={placeholder}
          className={shared}
        />
      )}
    </div>
  );
}
