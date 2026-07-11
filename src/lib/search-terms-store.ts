/**
 * Search-terms snapshot store (DynamoDB) — the trend-over-time layer of the
 * query-discovery tracker.
 *
 * Storage model (existing single table):
 *   PK = "SEARCHSNAP#<scope>"   scope = "CHANNEL" or a videoId
 *   SK = "<YYYY-MM-DD>"          one snapshot per day
 *   terms: [{ term, views, estimatedMinutesWatched }]  (Analytics order = rank)
 *   capturedAt (ISO)
 *
 * A daily job calls captureSearchTermsSnapshot; the dashboard reads the latest
 * snapshot and diffs it against the live terms (computeSearchTermsTrend) to show
 * per-term views + rank deltas. Snapshots are the ONLY place a "position" is
 * derived — and it's *our* observed Analytics ordering, never a search.list rank.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { fetchSearchTerms, type SearchTermRow, type Result } from '@/lib/youtube-analytics';

export interface SearchTermsSnapshot {
  scope: string;
  date: string;
  terms: SearchTermRow[];
  capturedAt: string;
}

const pkFor = (scope: string) => `SEARCHSNAP#${scope}`;
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Fetch the current search terms for a scope and persist a dated snapshot. */
export async function captureSearchTermsSnapshot(opts?: {
  videoId?: string;
  days?: number;
  date?: string;
}): Promise<Result<SearchTermsSnapshot>> {
  const scope = opts?.videoId ?? 'CHANNEL';
  const res = await fetchSearchTerms(opts?.videoId, opts?.days ?? 28);
  if (!res.ok) return res;
  const snapshot: SearchTermsSnapshot = {
    scope,
    date: opts?.date ?? todayUtc(),
    terms: res.data,
    capturedAt: new Date().toISOString(),
  };
  await DynamoDBOperations.put({ PK: pkFor(scope), SK: snapshot.date, ...snapshot });
  return { ok: true, data: snapshot };
}

/** Most-recent snapshots for a scope, newest first. */
export async function readRecentSnapshots(scope: string, count = 14): Promise<SearchTermsSnapshot[]> {
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk',
    expressionAttributeValues: { ':pk': pkFor(scope) },
    scanIndexForward: false, // SK (date) descending → newest first
    limit: count,
  });
  return (res.Items ?? []).map((it) => ({
    scope: String(it.scope ?? scope),
    date: String(it.date ?? it.SK),
    terms: Array.isArray(it.terms) ? (it.terms as SearchTermRow[]) : [],
    capturedAt: String(it.capturedAt ?? ''),
  }));
}

export interface TrendTerm {
  term: string;
  views: number;
  rank: number;
  /** views change vs the previous snapshot; null when the term is new. */
  viewsDelta: number | null;
  /** rank change vs previous (positive = moved UP); null when new. */
  rankDelta: number | null;
  isNew: boolean;
}

/**
 * Pure: diff the current terms against a previous snapshot into per-term trend.
 * Current order IS the rank (Analytics sorts by views desc). Terms present in
 * the previous snapshot but gone now are dropped (not returned) — the panel
 * shows what's currently driving search, annotated with movement.
 */
export function computeSearchTermsTrend(
  current: SearchTermRow[],
  previous?: SearchTermsSnapshot | null
): TrendTerm[] {
  const prev = new Map<string, { views: number; rank: number }>();
  (previous?.terms ?? []).forEach((t, i) => prev.set(t.term, { views: t.views, rank: i + 1 }));
  return current.map((t, i) => {
    const rank = i + 1;
    const p = prev.get(t.term);
    return {
      term: t.term,
      views: t.views,
      rank,
      viewsDelta: p ? t.views - p.views : null,
      rankDelta: p ? p.rank - rank : null,
      isNew: !p,
    };
  });
}
