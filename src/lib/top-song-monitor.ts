/**
 * Top-10 song monitor — Raj's four-metric decision tree, adapted to the API's
 * real limits.
 *
 * Auto (Analytics API): per-song VIEWS + AVERAGE VIEW DURATION, recent window vs
 * the prior one. Manual (Studio-only): IMPRESSIONS + CTR, logged periodically
 * (the API flatly rejects those two). The diagnosis classifies each top song:
 *   - satisfaction : watch-time ↓  (content/hook problem)
 *   - ctr          : CTR ↓ (thumbnail/title) — only when impressions/CTR logged
 *   - distribution : views ↓ but engagement stable = reduced exposure/reach
 *   - stable       : views not materially down
 * so a temporary reach cooldown is told apart from a real content shift.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import {
  fetchTopVideosWindow,
  isYouTubeAnalyticsConfigured,
  type TopVideoRow,
  type Result,
} from '@/lib/youtube-analytics';

export type SongDiagnosis = 'distribution' | 'ctr' | 'satisfaction' | 'stable' | 'insufficient';

export interface SongMetrics {
  views: number;
  avgViewDuration: number; // seconds — watch-time proxy
  impressions?: number | null; // Studio-only, manually logged
  ctr?: number | null; // Studio-only (percent)
}

/**
 * Pure: classify what changed for a song, current vs prior. Priority
 * satisfaction → ctr → distribution (worst-signal first). CTR is only evaluated
 * when impressions/CTR were logged for BOTH periods.
 */
export function diagnoseSong(cur: SongMetrics, prev: SongMetrics, dropPct = 20): SongDiagnosis {
  if (prev.views <= 0) return 'insufficient';
  const down = (c: number, p: number) => p > 0 && ((p - c) / p) * 100 >= dropPct;
  if (!down(cur.views, prev.views)) return 'stable';
  if (down(cur.avgViewDuration, prev.avgViewDuration)) return 'satisfaction';
  if (cur.ctr != null && prev.ctr != null && down(cur.ctr, prev.ctr)) return 'ctr';
  return 'distribution';
}

export interface ImpressionLog {
  videoId: string;
  impressions: number;
  ctr: number;
  checkedAt: string;
  periodEnd?: string;
}

const IMP_PK = 'IMPRESS';

export async function logImpressions(o: ImpressionLog): Promise<void> {
  await DynamoDBOperations.put({ PK: IMP_PK, SK: `${o.checkedAt}#${o.videoId}`, ...o });
}

/** Latest logged Studio impressions/CTR per video (newest checkedAt wins). */
export async function readLatestImpressions(): Promise<Map<string, { impressions: number; ctr: number }>> {
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk',
    expressionAttributeValues: { ':pk': IMP_PK },
    scanIndexForward: false,
    limit: 1000,
  });
  const m = new Map<string, { impressions: number; ctr: number }>();
  for (const it of res.Items ?? []) {
    const vid = String(it.videoId ?? '');
    if (vid && !m.has(vid)) m.set(vid, { impressions: Number(it.impressions ?? 0), ctr: Number(it.ctr ?? 0) });
  }
  return m;
}

export interface MonitorRow {
  videoId: string;
  title: string;
  views: number;
  viewsDeltaPct: number | null;
  avgViewDuration: number;
  watchDeltaPct: number | null;
  impressions: number | null;
  ctr: number | null;
  diagnosis: SongDiagnosis;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Pure: join recent/prior windows + titles + logged impressions → diagnosed rows (top N by recent views). */
export function buildTopSongMonitor(
  recent: TopVideoRow[],
  prior: TopVideoRow[],
  titles: Map<string, string>,
  impressions: Map<string, { impressions: number; ctr: number }>,
  topN = 10
): MonitorRow[] {
  const priorMap = new Map(prior.map((r) => [r.videoId, r]));
  return [...recent]
    .sort((a, b) => b.views - a.views)
    .slice(0, topN)
    .map((r) => {
      const p = priorMap.get(r.videoId);
      const imp = impressions.get(r.videoId);
      const cur: SongMetrics = {
        views: r.views,
        avgViewDuration: r.averageViewDuration,
        impressions: imp?.impressions ?? null,
        ctr: imp?.ctr ?? null,
      };
      return {
        videoId: r.videoId,
        title: titles.get(r.videoId) ?? r.videoId,
        views: r.views,
        viewsDeltaPct: p && p.views > 0 ? r1(((r.views - p.views) / p.views) * 100) : null,
        avgViewDuration: r.averageViewDuration,
        watchDeltaPct:
          p && p.averageViewDuration > 0 ? r1(((r.averageViewDuration - p.averageViewDuration) / p.averageViewDuration) * 100) : null,
        impressions: imp?.impressions ?? null,
        ctr: imp?.ctr ?? null,
        diagnosis: p
          ? diagnoseSong(cur, { views: p.views, avgViewDuration: p.averageViewDuration, impressions: null, ctr: null })
          : 'insufficient',
      };
    });
}

/** Recent + prior windows (finalized, ending yesterday). */
function windows(days: number): { recent: [string, string]; prior: [string, string] } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const rStart = new Date(end);
  rStart.setUTCDate(end.getUTCDate() - (days - 1));
  const pEnd = new Date(rStart);
  pEnd.setUTCDate(rStart.getUTCDate() - 1);
  const pStart = new Date(pEnd);
  pStart.setUTCDate(pEnd.getUTCDate() - (days - 1));
  return { recent: [fmt(rStart), fmt(end)], prior: [fmt(pStart), fmt(pEnd)] };
}

async function resolveTitles(ids: string[]): Promise<Map<string, string>> {
  const key = process.env.YOUTUBE_API_KEY;
  const m = new Map<string, string>();
  if (!key || ids.length === 0) return m;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.slice(0, 50).join(',')}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return m;
    const json = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
    for (const it of json.items ?? []) m.set(it.id, it.snippet.title);
  } catch {
    /* titles are best-effort */
  }
  return m;
}

/** Orchestrate: two Analytics windows + titles + logged impressions → the monitor. */
export async function fetchTopSongMonitor(days = 7, topN = 10): Promise<Result<MonitorRow[]>> {
  if (!isYouTubeAnalyticsConfigured()) return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  const { recent, prior } = windows(days);
  const [rRes, pRes] = await Promise.all([
    fetchTopVideosWindow(recent[0], recent[1]),
    fetchTopVideosWindow(prior[0], prior[1]),
  ]);
  if (!rRes.ok) return rRes;
  if (!pRes.ok) return pRes;
  const topIds = [...rRes.data].sort((a, b) => b.views - a.views).slice(0, topN).map((r) => r.videoId);
  const [titles, imp] = await Promise.all([resolveTitles(topIds), readLatestImpressions()]);
  return { ok: true, data: buildTopSongMonitor(rRes.data, pRes.data, titles, imp, topN) };
}
