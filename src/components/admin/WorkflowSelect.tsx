'use client';

/**
 * Inline workflow-state picker. Optimistic update, PATCHes the workflow
 * API. Mirrors the ThemeSelect pattern from /admin/songs.
 */

import { useId, useState } from 'react';
import { WORKFLOW_STATES, WORKFLOW_LABELS, type WorkflowState } from '@/types/content';
import { adminFetch } from '@/lib/client-auth';

interface Props {
  contentId: string;
  initialState: WorkflowState;
  /** True when the DB has an explicit value (vs the legacy fallback). */
  hasExplicit: boolean;
}

const RESET_VALUE = '__unset__';

export function WorkflowSelect({ contentId, initialState, hasExplicit: hasExplicitInitial }: Props) {
  const [state, setState] = useState<WorkflowState>(initialState);
  const [hasExplicit, setHasExplicit] = useState(hasExplicitInitial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusId = useId();

  const selectValue = hasExplicit ? state : RESET_VALUE;

  const save = async (next: string) => {
    const clearing = next === RESET_VALUE;
    const previousState = state;
    const previousHasExplicit = hasExplicit;

    if (!clearing) setState(next as WorkflowState);
    setHasExplicit(!clearing);
    setSaving(true);
    setStatus('Saving…');

    try {
      const res = await adminFetch(`/api/admin/content/${contentId}/workflow`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: clearing ? '' : next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setStatus(clearing ? 'Reset' : 'Saved');
    } catch (err) {
      setState(previousState);
      setHasExplicit(previousHasExplicit);
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={selectValue}
        onChange={(e) => save(e.target.value)}
        disabled={saving}
        aria-label="Workflow state"
        aria-describedby={statusId}
        className={`rounded border px-2 py-1 text-xs ${
          hasExplicit ? 'border-orange-300 bg-orange-50' : 'border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900'
        } disabled:opacity-60`}
        title={hasExplicit ? 'Explicit state — pick "—" to clear' : 'Inferred from status'}
      >
        <option value={RESET_VALUE}>—</option>
        {WORKFLOW_STATES.map((s) => (
          <option key={s} value={s}>{WORKFLOW_LABELS[s]}</option>
        ))}
      </select>
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {status ?? ''}
      </span>
      {saving && <span aria-hidden className="text-[10px] text-gray-400">…</span>}
      {!saving && status?.startsWith('Save failed') && (
        <span aria-hidden className="text-[10px] text-red-600" title={status}>!</span>
      )}
    </div>
  );
}
