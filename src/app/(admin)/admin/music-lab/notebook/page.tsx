/**
 * /admin/music-lab/notebook — Composition Notebook.
 *
 * Client-side list + editor over /api/admin/compositions, matching how the
 * other admin CRUD surfaces work (adminFetch, no server read before paint).
 */

import { CompositionNotebook } from '@/components/admin/music/CompositionNotebook';

export const metadata = { title: 'Composition Notebook' };

export default function CompositionNotebookPage() {
  return <CompositionNotebook />;
}
