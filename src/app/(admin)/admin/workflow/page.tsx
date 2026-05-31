/**
 * /admin/workflow — Studio production-pipeline kanban (server data fetch +
 * client-side filter/sort/render via <WorkflowKanban>).
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { WorkflowKanban, type WorkflowItem } from '@/components/admin/WorkflowKanban';

export const revalidate = 60;

async function getAllContent(): Promise<WorkflowItem[]> {
  try {
    const repo = new ContentRepository();
    const res = await repo.findAll({ limit: 500 });
    return res.items.map((e) => {
      const o = e.toObject() as Record<string, unknown>;
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
    });
  } catch (err) {
    console.error('[admin/workflow] failed to load content:', err);
    return [];
  }
}

export default async function AdminWorkflowPage() {
  const items = await getAllContent();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Production workflow</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Track every item through the 9-state Studio pipeline. Cards without an explicit
          <code className="mx-1">workflowState</code> are placed by status (PUBLISHED → Live, else Draft) and
          marked <em>auto</em>.
        </p>
      </header>

      <WorkflowKanban items={items} />
    </div>
  );
}
