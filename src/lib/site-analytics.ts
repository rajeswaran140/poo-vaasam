/**
 * First-party site analytics — the data we own in DynamoDB, independent of GA4.
 * Right now that's per-content `viewCount` (incremented by the /api/content/[id]/view
 * beacon). Surfaced in /admin/analytics alongside the GA4-derived traffic so the
 * dashboard still shows something even when GA4 is unconfigured or ad-blocked.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { contentPath } from '@/config/vanity-paths';

export interface ViewedContent {
  id: string;
  title: string;
  type: string;
  /** Canonical public path (vanity URL when one exists, e.g. /thayagam). */
  path: string;
  viewCount: number;
}

export interface ContentViewSummary {
  /** Sum of viewCount across all published content. */
  totalViews: number;
  /** Number of published content items considered. */
  itemCount: number;
  /** Top-viewed items, descending. */
  top: ViewedContent[];
  /**
   * id → title for every published item. The first-party event counters key
   * per-song rows by content id (`cnt_…`), so the dashboard needs this to render
   * "which song gets forwarded" as titles rather than opaque ids. Free — we've
   * already paged the whole catalogue to sum views.
   */
  titleById: Record<string, string>;
}

/**
 * Pure: summarise on-site view counts across already-`toObject()`'d content rows.
 * Separated from the DB read so it's unit-testable.
 */
export function summariseContentViews(
  items: Array<Record<string, unknown>>,
  topN = 10
): ContentViewSummary {
  const viewed: ViewedContent[] = items.map((c) => ({
    id: String(c.id ?? ''),
    title: String(c.title ?? ''),
    type: String(c.type ?? ''),
    path: contentPath(String(c.id ?? '')),
    viewCount: Number(c.viewCount ?? 0),
  }));
  const totalViews = viewed.reduce((sum, v) => sum + v.viewCount, 0);
  const top = [...viewed].sort((a, b) => b.viewCount - a.viewCount).slice(0, topN);
  const titleById: Record<string, string> = {};
  for (const v of viewed) if (v.id) titleById[v.id] = v.title;
  return { totalViews, itemCount: viewed.length, top, titleById };
}

/** Read published content from DynamoDB (paged) and summarise its view counts. */
export async function fetchContentViewSummary(topN = 10): Promise<ContentViewSummary> {
  const repo = new ContentRepository();
  const items: Array<Record<string, unknown>> = [];
  let cursor: Record<string, unknown> | undefined;
  // Cap at 10 pages (1000 items) — matches the sitemap's paging guard.
  for (let i = 0; i < 10; i++) {
    const res = await repo.findAll({ limit: 100, status: ContentStatus.PUBLISHED, lastEvaluatedKey: cursor });
    for (const entity of res.items) items.push(entity.toObject() as Record<string, unknown>);
    cursor = res.lastEvaluatedKey as Record<string, unknown> | undefined;
    if (!cursor) break;
  }
  return summariseContentViews(items, topN);
}
