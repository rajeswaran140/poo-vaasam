/**
 * /admin/workflow — Studio production-pipeline kanban.
 *
 * One column per WorkflowState, every Content row placed in its column.
 * Rows without an explicit workflowState fall back to a sensible inference:
 *   PUBLISHED  → 'published_site'  (it's already on the public site)
 *   DRAFT      → 'draft'           (everything else)
 *
 * Click a card's selector to advance it through the pipeline; the existing
 * /admin/content/[id]/edit page handles full editing.
 */

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { WORKFLOW_STATES, WORKFLOW_LABELS, type WorkflowState } from '@/types/content';
import { WorkflowSelect } from '@/components/admin/WorkflowSelect';

export const revalidate = 60;

interface ContentObject {
  id: string;
  title: string;
  type: string;
  status: string;
  workflowState?: string;
}

function inferState(c: ContentObject): { state: WorkflowState; explicit: boolean } {
  const w = c.workflowState;
  if (w && (WORKFLOW_STATES as readonly string[]).includes(w)) {
    return { state: w as WorkflowState, explicit: true };
  }
  return {
    state: c.status === 'PUBLISHED' ? 'published_site' : 'draft',
    explicit: false,
  };
}

async function getAllContent(): Promise<ContentObject[]> {
  try {
    const repo = new ContentRepository();
    const res = await repo.findAll({ limit: 500 });
    return res.items.map((e) => e.toObject() as ContentObject);
  } catch (err) {
    console.error('[admin/workflow] failed to load content:', err);
    return [];
  }
}

export default async function AdminWorkflowPage() {
  const items = await getAllContent();

  // Group by state.
  const byState: Record<WorkflowState, ContentObject[]> = {} as Record<WorkflowState, ContentObject[]>;
  for (const s of WORKFLOW_STATES) byState[s] = [];
  for (const c of items) {
    const { state } = inferState(c);
    byState[state].push(c);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Production workflow</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {items.length} item{items.length === 1 ? '' : 's'} across the pipeline. Cards without an explicit state inherit one from <code>status</code>:
          PUBLISHED → <em>Live</em>, otherwise <em>Draft</em>.
        </p>
      </header>

      {/* Horizontally scrolling kanban — 9 columns won't fit on most viewports */}
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
                      return (
                        <article
                          key={c.id}
                          className="rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                        >
                          <p className="mb-1 line-clamp-2 font-tamil text-sm font-medium text-gray-900 dark:text-gray-100" title={c.title}>
                            {c.title}
                          </p>
                          <p className="mb-2 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {c.type}
                          </p>
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
    </div>
  );
}
