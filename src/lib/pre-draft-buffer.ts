/**
 * Pre-draft buffer — protects text typed BEFORE the poet has titled and saved
 * a draft for the first time.
 *
 * The server-side working copy [[lyric-autosave]] deliberately refuses to fire
 * until a draft record exists, so the library never fills up with "Untitled"
 * rows. That design is right for library cleanliness, wrong for typing safety:
 * if the tab is closed after 20 minutes of composing, the text is gone.
 *
 * This buffer closes that window. As soon as the poet types, we debounce a
 * write to localStorage. On next load, if no draft is open and the buffer has
 * text, the form offers to restore it. The moment a draft is saved (or opened),
 * the buffer clears — the server working copy takes over from there.
 *
 * All storage errors (quota, private browsing) fail silently: the buffer is a
 * safety net, not a source of truth, so we never let it interrupt writing.
 */

export const PRE_DRAFT_BUFFER_KEY = 'lyric-critic:pre-draft';

/**
 * Idle time before writing the buffer. Long enough to coalesce a fast typing
 * burst into one write, short enough that a closed tab loses at most a phrase.
 */
export const PRE_DRAFT_BUFFER_DEBOUNCE_MS = 800;

/**
 * Buffers older than this are treated as stale and ignored on restore. A week
 * is long enough that a poet returning from a trip still gets their in-progress
 * text, short enough that a forgotten buffer from months ago doesn't surface as
 * "here's some text you don't remember writing".
 */
export const PRE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PreDraftBuffer {
  lyrics: string;
  title: string;
  updatedAt: number;
}

/**
 * Read the buffer. Returns null when there's nothing worth restoring — no
 * buffer, empty lyrics, stale, or corrupted JSON. Callers can trust a non-null
 * result to be presentable to the poet without further validation.
 */
export function readBuffer(storage: Storage): PreDraftBuffer | null {
  try {
    const raw = storage.getItem(PRE_DRAFT_BUFFER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PreDraftBuffer>;
    if (typeof parsed.lyrics !== 'string' || !parsed.lyrics.trim()) return null;
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
    if (Date.now() - updatedAt > PRE_DRAFT_MAX_AGE_MS) return null;
    return {
      lyrics: parsed.lyrics,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Write the buffer. Only writes when there are actual lyrics to save —
 * title-only entries are not worth restoring later and just add noise to the
 * "restore?" prompt.
 */
export function writeBuffer(input: { lyrics: string; title: string }, storage: Storage): void {
  if (!input.lyrics.trim()) {
    // Empty lyrics means nothing to protect — clear rather than store.
    clearBuffer(storage);
    return;
  }
  try {
    storage.setItem(
      PRE_DRAFT_BUFFER_KEY,
      JSON.stringify({ lyrics: input.lyrics, title: input.title, updatedAt: Date.now() })
    );
  } catch {
    /* quota exceeded / private mode — nothing we can do, and it's not worth
       interrupting composition to say so. */
  }
}

export function clearBuffer(storage: Storage): void {
  try {
    storage.removeItem(PRE_DRAFT_BUFFER_KEY);
  } catch {
    /* ignore */
  }
}
