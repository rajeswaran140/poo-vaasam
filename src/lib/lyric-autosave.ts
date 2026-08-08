/**
 * Lyric autosave — pure decision logic for the Lyric Critic's writing surface.
 *
 * WHY A WORKING COPY AND NOT JUST "SAVE MORE OFTEN". In this model every save
 * creates a VERSION, and a version is a deliberate act — it is the unit the
 * critique is filed against and the thing the poet compares revisions across.
 * Autosaving straight to versions would file one every few seconds of typing
 * and bury the handful of real revisions under hundreds of keystroke snapshots,
 * destroying the exact history the draft library exists to keep.
 *
 * So drafts carry a WORKING COPY: unsaved text, overwritten in place, never
 * versioned. Autosave writes there. "Save version" stays an explicit button and
 * behaves exactly as before. Work is never lost; history stays intentional.
 *
 * Raj writes lyrics in Word / Google Input Tools / by hand today, and the thing
 * that keeps him there is that this page cannot be left and returned to. That
 * is what the working copy fixes.
 */

/**
 * Idle time before autosave fires. Long enough not to fire mid-line while
 * composing (Tamil transliteration commits a word at a time, so keystroke gaps
 * are naturally longer than in English), short enough that a closed tab loses
 * at most a phrase.
 */
export const AUTOSAVE_DEBOUNCE_MS = 2500;

export type AutosaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export interface AutosaveInput {
  /** Null until the draft has been created — a new draft needs a title first. */
  draftId: string | null;
  /** What is in the editor right now. */
  text: string;
  /** The working copy last persisted for this draft. */
  savedWorking: string | null;
  /** True while a save (auto or manual) is in flight. */
  saving: boolean;
}

/**
 * Whether an autosave should fire right now.
 *
 * Deliberately refuses on a draft that does not exist yet. Autosaving a new
 * draft would have to invent a title, and a library full of "Untitled" rows is
 * worse than losing text the poet never chose to keep — creation stays an
 * explicit act.
 */
export function shouldAutosave({ draftId, text, savedWorking, saving }: AutosaveInput): boolean {
  if (!draftId) return false;
  if (saving) return false;
  if (!text.trim()) return false;
  return text !== (savedWorking ?? '');
}

/** Status for the indicator, derived from the same inputs. */
export function autosaveStatus(input: AutosaveInput, lastError: boolean = false): AutosaveStatus {
  if (lastError) return 'error';
  if (input.saving) return 'saving';
  if (!input.draftId) return 'clean';
  if (input.text !== (input.savedWorking ?? '')) return 'dirty';
  return 'saved';
}

export function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'dirty':
      return 'Unsaved changes';
    case 'saved':
      return 'All changes saved';
    case 'error':
      return 'Could not save — your text is still here';
    default:
      return '';
  }
}

/**
 * Should the editor offer to restore a working copy on load?
 *
 * Only when it actually differs from the latest saved version — otherwise the
 * prompt fires on every open and gets trained away, and the one time it matters
 * it will be dismissed by reflex.
 *
 * Whitespace-insensitive on the ends only: a trailing newline is not a change
 * worth interrupting for, but internal spacing IS meaningful in a lyric (line
 * breaks separate பல்லவி from சரணம்), so it is never normalised away.
 */
export function shouldOfferRestore(workingLyrics: string | undefined | null, latestVersionLyrics: string): boolean {
  if (!workingLyrics) return false;
  return workingLyrics.trim() !== latestVersionLyrics.trim();
}

/**
 * True when the current text is identical to a saved version, i.e. there is
 * nothing new to file. Used to disable "Save version" so the history does not
 * collect consecutive identical entries.
 */
export function isRedundantVersion(text: string, latestVersionLyrics: string | null): boolean {
  if (latestVersionLyrics == null) return false;
  return text.trim() === latestVersionLyrics.trim();
}
