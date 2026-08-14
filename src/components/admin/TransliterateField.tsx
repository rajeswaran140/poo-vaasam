'use client';

/**
 * TransliterateField — English→Tamil transliteration input, comparable to Google
 * Input Tools. As you type a latin word, a candidate dropdown appears (fetched
 * via the same-origin /api/admin/transliterate proxy — the browser can't reach
 * Google directly). ↑/↓ to choose, Enter/Tab to commit, Space commits the
 * highlighted word + a space, Esc dismisses. Plain typing always works even if
 * suggestions fail (it degrades to literal text).
 *
 * Controlled: value/onChange come from the parent. Works as <input> or
 * <textarea> via `multiline`.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { activeLatinToken, commitCandidate } from '@/lib/transliterate';

interface TransliterateFieldProps {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  required?: boolean;
  lang?: string;
  /**
   * Accessible name. The field renders a bare <input>/<textarea> with no
   * visible <label>, so without this a screen reader announces an unnamed
   * combobox — and any test querying by label cannot reach it.
   */
  ariaLabel?: string;
}

export function TransliterateField({
  value,
  onChange,
  multiline = false,
  rows = 4,
  placeholder,
  className = '',
  required = false,
  lang = 'ta',
  ariaLabel,
}: TransliterateFieldProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const tokenStart = useRef<number>(0);
  const pendingCaret = useRef<number | null>(null);
  const seq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  // Restore the caret after a controlled-value change (commit / replace).
  useEffect(() => {
    if (pendingCaret.current != null && ref.current) {
      const pos = pendingCaret.current;
      ref.current.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  });

  const close = useCallback(() => {
    setOpen(false);
    setCandidates([]);
    setActive(0);
  }, []);

  const fetchFor = useCallback(
    (token: string, start: number) => {
      const mySeq = ++seq.current;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(async () => {
        try {
          // suppressExpiryRedirect: suggestions are a non-critical aid fired on
          // every keystroke — a 401 (e.g. a momentarily stale token) must NOT
          // sign the admin out mid-typing; it just means "no suggestions".
          const res = await adminFetch(
            `/api/admin/transliterate?text=${encodeURIComponent(token)}&lang=${lang}&n=9`,
            { suppressExpiryRedirect: true }
          );
          if (mySeq !== seq.current) return; // a newer keystroke superseded this
          if (!res.ok) { close(); return; } // 401/error → no suggestions, keep typing literally
          const d = await res.json();
          const list: string[] = Array.isArray(d.candidates) ? d.candidates : [];
          if (list.length > 0) {
            tokenStart.current = start;
            setCandidates(list);
            setActive(0);
            setOpen(true);
          } else {
            close();
          }
        } catch {
          if (mySeq === seq.current) close();
        }
      }, 120);
    },
    [lang, close]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart ?? next.length;
    const tok = activeLatinToken(next, caret);
    if (tok) fetchFor(tok.token, tok.start);
    else close();
  };

  const commit = (index: number, trailingSpace: boolean) => {
    const el = ref.current;
    if (!el) return;
    const cand = candidates[index];
    if (!cand) return;
    const caret = el.selectionStart ?? value.length;
    const { text, caret: nextCaret } = commitCandidate(value, tokenStart.current, caret, cand, trailingSpace);
    pendingCaret.current = nextCaret;
    onChange(text);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || candidates.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (i + 1) % candidates.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (i - 1 + candidates.length) % candidates.length);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        commit(active, false);
        break;
      case ' ':
        e.preventDefault();
        commit(active, true); // commit highlighted word + a space
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  const shared = {
    ref: ref as never,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: () => setTimeout(close, 120), // allow click-to-select before closing
    placeholder,
    required,
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
  };

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          {...shared}
          rows={rows}
          className={`w-full resize-y rounded-lg border border-purple-300 bg-purple-50 px-4 py-3 font-tamil transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-purple-700 dark:bg-gray-800 dark:text-gray-100 ${className}`}
        />
      ) : (
        <input
          {...shared}
          type="text"
          className={`w-full rounded-lg border border-purple-300 bg-purple-50 px-4 py-3 font-tamil transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-purple-700 dark:bg-gray-800 dark:text-gray-100 ${className}`}
        />
      )}

      {open && candidates.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-60 w-72 max-w-full overflow-auto rounded-lg border border-purple-300 bg-white py-1 shadow-xl dark:border-purple-700 dark:bg-gray-800"
        >
          {candidates.map((c, i) => (
            <li
              key={`${c}-${i}`}
              role="option"
              aria-selected={i === active}
              // onMouseDown (not onClick) so we commit before the field's blur fires.
              onMouseDown={(e) => { e.preventDefault(); commit(i, false); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 font-tamil text-sm ${
                i === active ? 'bg-purple-600 text-white' : 'text-gray-800 dark:text-gray-100'
              }`}
            >
              <span className="mr-2 text-xs opacity-60">{i + 1}</span>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
