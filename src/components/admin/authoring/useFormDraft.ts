'use client';

/**
 * Autosave an in-progress content form to localStorage so a session expiry
 * (this app bounces to /login on 401), tab close, or accidental navigation
 * never loses the writer's work.
 *
 * Behaviour:
 *  - On mount (once enabled), detect a previously-saved draft and expose it for
 *    an explicit "restore" — we never silently overwrite the live form.
 *  - Establish the dirty BASELINE the first time the hook is enabled. On the New
 *    page that's the empty form; on the Edit page pass `enabled: !loading` so the
 *    baseline is the LOADED content — otherwise loading would look like an edit
 *    and autosave/guard would fire on unchanged content.
 *  - Autosave only once the form is DIRTY vs that baseline (debounced), so the
 *    initial render can't clobber a recoverable draft before the writer restores.
 *  - `clear()` on successful submit drops the draft.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'tg:content-draft:';
const DEBOUNCE_MS = 800;

interface Stored<T> {
  savedAt: number;
  data: T;
}

export interface FormDraft {
  /** A prior draft found on mount (offer "restore"); null once handled. */
  draftAvailable: { savedAt: number } | null;
  /** Timestamp of the most recent autosave this session, or null. */
  savedAt: number | null;
  /** True once the form differs from its established baseline. */
  isDirty: boolean;
  restore: () => void;
  dismiss: () => void;
  clear: () => void;
}

export function useFormDraft<T>(
  key: string,
  data: T,
  apply: (data: T) => void,
  opts: { enabled?: boolean } = {}
): FormDraft {
  const enabled = opts.enabled ?? true;
  const storageKey = PREFIX + key;

  // null until the baseline is captured (the first enabled render).
  const baseline = useRef<string | null>(null);
  const [draftAvailable, setDraftAvailable] = useState<{ savedAt: number } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const serialized = JSON.stringify(data);
  const isDirty = baseline.current !== null && serialized !== baseline.current;

  // 1) Capture the dirty baseline once, the first time we're enabled.
  useEffect(() => {
    if (enabled && baseline.current === null) {
      baseline.current = serialized;
    }
  }, [enabled, serialized]);

  // 2) Detect an existing draft once enabled (offer restore; don't auto-apply).
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored<T>;
        if (parsed && typeof parsed.savedAt === 'number') {
          setDraftAvailable({ savedAt: parsed.savedAt });
        }
      }
    } catch {
      /* corrupt / unavailable storage — ignore */
    }
  }, [storageKey, enabled]);

  // 3) Debounced autosave — only when dirty vs the captured baseline.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (baseline.current === null || serialized === baseline.current) return;
    const id = setTimeout(() => {
      try {
        const at = Date.now();
        window.localStorage.setItem(storageKey, JSON.stringify({ savedAt: at, data }));
        setSavedAt(at);
      } catch {
        /* quota / private mode — best-effort */
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [serialized, data, storageKey, enabled]);

  const restore = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored<T>;
        if (parsed?.data) apply(parsed.data);
      }
    } catch {
      /* ignore */
    }
    setDraftAvailable(null);
  }, [storageKey, apply]);

  const dismiss = useCallback(() => setDraftAvailable(null), []);

  const clear = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
    setDraftAvailable(null);
    setSavedAt(null);
  }, [storageKey]);

  return { draftAvailable, savedAt, isDirty, restore, dismiss, clear };
}
