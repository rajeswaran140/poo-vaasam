/**
 * Data loader for the /admin/workflow production-pipeline board.
 *
 * The pipeline spans DRAFT (in-progress: Lyrics → Video) AND PUBLISHED (Live),
 * so BOTH statuses must be loaded — querying only PUBLISHED (findAll's default)
 * left every pre-publish column permanently empty, defeating the board.
 * Archived content is intentionally excluded. Lives outside the page module
 * because Next.js forbids arbitrary named exports from a `page` file.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import type { WorkflowItem } from '@/components/admin/WorkflowKanban';

const PIPELINE_STATUSES = [ContentStatus.DRAFT, ContentStatus.PUBLISHED] as const;

function toWorkflowItem(o: Record<string, unknown>): WorkflowItem {
  // Date → ISO string so the client component (no Date hydration) is happy.
  const toIso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : undefined;
  return {
    id: String(o.id),
    title: String(o.title ?? ''),
    type: String(o.type ?? ''),
    status: String(o.status ?? 'DRAFT'),
    workflowState: typeof o.workflowState === 'string' ? o.workflowState : undefined,
    updatedAt: toIso(o.updatedAt),
    createdAt: toIso(o.createdAt),
  };
}

/** Load every pipeline item (drafts + live), paged, across statuses. Never
 *  throws — a DB failure yields an empty board plus a log. */
export async function getAllContent(): Promise<WorkflowItem[]> {
  try {
    const repo = new ContentRepository();
    const out: WorkflowItem[] = [];
    for (const status of PIPELINE_STATUSES) {
      let cursor: Record<string, unknown> | undefined;
      // Up to 10 pages × 200 = 2000 items per status (catalogue is far smaller).
      for (let i = 0; i < 10; i++) {
        const res = await repo.findAll({ limit: 200, status, lastEvaluatedKey: cursor });
        for (const e of res.items) out.push(toWorkflowItem(e.toObject() as Record<string, unknown>));
        cursor = res.lastEvaluatedKey as Record<string, unknown> | undefined;
        if (!cursor) break;
      }
    }
    return out;
  } catch (err) {
    console.error('[admin/workflow] failed to load content:', err);
    return [];
  }
}
