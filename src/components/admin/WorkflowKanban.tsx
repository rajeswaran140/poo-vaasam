'use client';

/**
 * Production-pipeline kanban (Phase 1 Studio).
 *
 * Takes pre-fetched content from the server page and handles all the
 * interactive bits client-side:
 *   - type filter (All / Songs / Poems / …)
 *   - per-column newest-first sort
 *   - completion summary in the header
 *   - empty-pipeline callout
 *   - inline WorkflowSelect per card (the only DB write the page makes)
 *
 * The 9 sequential states are rendered as 9 horizontally scrolling columns;
 * cards without an explicit `workflowState` infer one from `status`
 * (PUBLISHED → 'published_site', else 'draft').
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { WORKFLOW_STATES, WORKFLOW_LABELS, type WorkflowState } from '@/types/content';
import { WorkflowSelect } from '@/components/admin/WorkflowSelect';

export interface WorkflowItem {
  id: string;
  title: string;
  type: string;
  status: string;
  workflowState?: string;
  /** ISO-8601 string. Server normalises Date → string before handing off. */
  updatedAt?: string;
  createdAt?: string;
}

interface Props {
  items: WorkflowItem[];
}

export function inferState(c: WorkflowItem): { state: WorkflowState; explicit: boolean } {
  const w = c.workflowState;
  if (w && (WORKFLOW_STATES as readonly string[]).includes(w)) {
    return { state: w as WorkflowState, explicit: true };
  }
  return {
    state: c.status === 'PUBLISHED' ? 'published_site' : 'draft',
    explicit: false,
  };
}

/** Compact "Nm/h/d ago" string, with date fallback past 30 days. */
export function relativeTime(iso?: string, nowMs = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const seconds = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}

const TYPE_TONE: Record<string, string> = {
  SONGS:   'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  POEMS:   'bg-green-100  text-green-800  dark:bg-green-500/20  dark:text-green-300',
  LYRICS:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  STORIES: 'bg-pink-100   text-pink-800   dark:bg-pink-500/20   dark:text-pink-300',
  ESSAYS:  'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
};

const TYPE_ICON: Record<string, string> = {
  SONGS: '🎵', POEMS: '📝', LYRICS: '🎤', STORIES: '📖', ESSAYS: '✍️',
};

export function WorkflowKanban({ items }: Props) {
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');

  // Distinct types actually present in the data — feeds the filter dropdown.
  const availableTypes = useMemo(() => {
    const set = new Set(items.map((i) => i.type).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(
    () => (typeFilter === 'all' ? items : items.filter((i) => i.type === typeFilter)),
    [items, typeFilter]
  );

  // Group + sort newest-first within each column.
  const byState = useMemo(() => {
    const groups: Record<WorkflowState, WorkflowItem[]> = {} as Record<WorkflowState, WorkflowItem[]>;
    for (const s of WORKFLOW_STATES) groups[s] = [];
    for (const c of filtered) {
      const { state } = inferState(c);
      groups[state].push(c);
    }
    for (const s of WORKFLOW_STATES) {
      groups[s].sort((a, b) => {
        const ta = Date.parse(a.updatedAt ?? a.createdAt ?? '');
        const tb = Date.parse(b.updatedAt ?? b.createdAt ?? '');
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });
    }
    return groups;
  }, [filtered]);

  const livecount = byState['published_site'].length;
  const inPipeline = filtered.length - livecount;

  return (
    <div className="space-y-4">
      {/* Header: filter + tally */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Type filter"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="all">All</option>
              {availableTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {filtered.length} shown of {items.length}
          </p>
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200" aria-live="polite">
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-500/20 dark:text-green-300">{livecount} Live</span>
          {' · '}
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">{inPipeline} in pipeline</span>
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400">
          No content {typeFilter === 'all' ? 'yet' : `of type "${typeFilter}"`}.
        </p>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="flex gap-3 min-w-max">
            {WORKFLOW_STATES.map((s) => {
              const cards = byState[s];
              return (
                <section
                  key={s}
                  aria-label={`${WORKFLOW_LABELS[s]} column`}
                  className="w-64 flex-shrink-0 rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60"
                >
                  <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {WORKFLOW_LABELS[s]}
                    </span>
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {cards.length}
                    </span>
                  </header>
                  <div className="space-y-2 p-2">
                    {cards.length === 0 ? (
                      <p className="rounded-md bg-white p-3 text-center text-[11px] text-gray-400 dark:bg-gray-900 dark:text-gray-600">
                        —
                      </p>
                    ) : (
                      cards.map((c) => {
                        const { state, explicit } = inferState(c);
                        const tone = TYPE_TONE[c.type] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
                        const icon = TYPE_ICON[c.type] ?? '·';
                        return (
                          <article
                            key={c.id}
                            className="rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                          >
                            <p className="mb-1 line-clamp-2 font-tamil text-sm font-medium text-gray-900 dark:text-gray-100" title={c.title}>
                              {c.title}
                            </p>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>
                                <span aria-hidden>{icon}</span>{c.type}
                                {!explicit && <span className="opacity-70">· auto</span>}
                              </span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500" title={c.updatedAt ?? c.createdAt}>
                                {relativeTime(c.updatedAt ?? c.createdAt)}
                              </span>
                            </div>
                            <WorkflowSelect contentId={c.id} initialState={state} hasExplicit={explicit} />
                            <div className="mt-2 flex justify-end gap-2 text-[11px]">
                              <Link href={`/admin/content/${c.id}/edit`} className="text-orange-600 hover:underline dark:text-orange-400">
                                Edit
                              </Link>
                              <Link href={`/content/${c.id}`} target="_blank" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                                View
                              </Link>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
