'use client';

/** Restore-draft prompt shown when a prior unsaved draft is found on mount. */
export function DraftBanner({
  draft,
  onRestore,
  onDismiss,
}: {
  draft: { savedAt: number } | null;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  if (!draft) return null;
  const when = new Date(draft.savedAt).toLocaleString();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
    >
      <span className="text-amber-800 dark:text-amber-200">
        You have an unsaved draft from <strong>{when}</strong>. Restore it?
      </span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          Restore draft
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-3 py-1.5 font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
