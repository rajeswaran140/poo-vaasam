'use client';

/**
 * Warn the writer before leaving with unsaved changes (tab close / reload /
 * external navigation). In-app navigation is additionally covered by the draft
 * autosave + restore in useFormDraft.
 */
import { useEffect } from 'react';

export function useUnsavedGuard(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy property still required by some browsers to show the prompt;
      // cast avoids the (cosmetic) deprecation annotation on BeforeUnloadEvent.
      (e as { returnValue: string }).returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
