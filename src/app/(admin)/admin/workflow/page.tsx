/**
 * /admin/workflow — Studio production-pipeline kanban (server data fetch +
 * client-side filter/sort/render via <WorkflowKanban>).
 */

import { WorkflowKanban } from '@/components/admin/WorkflowKanban';
import { getAllContent } from '@/lib/workflow-content';

// Fetch at request time, not build. Amplify doesn't run ISR, so a `revalidate`
// page froze at build — workflow-state changes (persisted by the kanban) and
// newly-created drafts never showed up on reload. Runtime DynamoDB reads work
// via the inlined APP_AWS_* creds (same as the admin API routes).
export const dynamic = 'force-dynamic';

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
