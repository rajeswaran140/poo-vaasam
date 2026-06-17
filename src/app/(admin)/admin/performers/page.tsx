/**
 * /admin/performers — authoring for the gated "For Performers" portal.
 *
 * Server-rendered list of songs with their performer-asset status (booleans
 * only — the gated lyrics themselves are NOT serialized here; the client editor
 * loads them on demand via the verified-admin GET). Runtime DynamoDB read works
 * via the inlined APP_AWS_* creds (same as /admin/songs).
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType } from '@/types/content';
import { PerformerAuthoring, type PerformerAdminRow } from '@/components/admin/PerformerAuthoring';

export const dynamic = 'force-dynamic';

async function getRows(): Promise<PerformerAdminRow[]> {
  try {
    const repo = new ContentRepository();
    const res = await repo.findByType(ContentType.SONGS, { limit: 200 });
    return res.items.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      published: c.isPublished(),
      hasLyrics: !!(c.lyrics && c.lyrics.trim()),
      hasTrack: !!(c.instrumentalKey && c.instrumentalKey.trim()),
      durationSeconds: c.instrumentalDuration,
    }));
  } catch (e) {
    console.error('[admin/performers] load failed', e);
    return [];
  }
}

export default async function AdminPerformersPage() {
  const rows = await getRows();
  return <PerformerAuthoring rows={rows} />;
}
