/**
 * Manual search-position OBSERVATION log (DynamoDB) — the human-observed layer
 * of the query-discovery tracker. A real spot-check ("I searched X and saw the
 * song at #2") is recorded here; the automated search-terms layer stays
 * separate. Positions here are HUMAN-observed, never a search.list API rank.
 *
 * Storage model (existing single table):
 *   PK = "SEARCHOBS#<videoId>"
 *   SK = "<checkedAt ISO>#<query>"   (newest-first when queried descending)
 *   position (int | null), region, viewsAtObservation, videoAgeHours, checkedAt
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { opportunityScore, opportunityGap } from '@/lib/opportunity-score';
import type { SongQuerySet } from '@/config/song-search-queries';

export interface SearchObservation {
  videoId: string;
  query: string;
  /** Observed rank; null = not found in the window checked (a real gap). */
  position: number | null;
  region?: string;
  viewsAtObservation?: number;
  videoAgeHours?: number;
  checkedAt: string;
}

const pkFor = (videoId: string) => `SEARCHOBS#${videoId}`;

export async function logObservation(o: SearchObservation): Promise<void> {
  await DynamoDBOperations.put({ PK: pkFor(o.videoId), SK: `${o.checkedAt}#${o.query}`, ...o });
}

/** Latest observation per query for a song (newest checkedAt wins). */
export async function readLatestObservations(videoId: string): Promise<Map<string, SearchObservation>> {
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk',
    expressionAttributeValues: { ':pk': pkFor(videoId) },
    scanIndexForward: false, // SK (checkedAt#query) descending → newest first
    limit: 1000,
  });
  const latest = new Map<string, SearchObservation>();
  for (const it of res.Items ?? []) {
    const o = it as SearchObservation;
    if (o.query && !latest.has(o.query)) latest.set(o.query, o); // first seen = newest
  }
  return latest;
}

export interface ScorecardRow {
  query: string;
  intent: string;
  conversion: string;
  position: number | null;
  region?: string;
  checkedAt?: string;
  opportunity: number;
  gap: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Pure: join a song's tracked-query set with its latest observations into a
 * scorecard, sorted by opportunity GAP descending — the biggest places to
 * improve first (high intent × conversion but poor/absent position).
 */
export function buildScorecard(set: SongQuerySet, latest: Map<string, SearchObservation>): ScorecardRow[] {
  return set.queries
    .map((q) => {
      const obs = latest.get(q.query);
      const position = obs?.position ?? null;
      return {
        query: q.query,
        intent: q.intent,
        conversion: q.conversion,
        position,
        region: obs?.region,
        checkedAt: obs?.checkedAt,
        opportunity: round3(opportunityScore(q, position)),
        gap: round3(opportunityGap(q, position)),
      };
    })
    .sort((a, b) => b.gap - a.gap);
}
