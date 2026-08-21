/**
 * release-impact — are new uploads ADDITIVE or CANNIBALISING?
 *
 *   npx tsx scripts/release-impact.ts [--from 2026-07-08] [--cutoff 2026-07-01] [--json]
 *
 * Answers the question that keeps recurring: at a release every ~2 days, does
 * each upload steal distribution from the existing catalogue?
 *
 * METHOD (see src/lib/release-impact.ts for why each choice matters):
 *   1. FIXED COHORT — every long-form song published before `--cutoff`. The
 *      definition never moves, so the cohort cannot drift as new songs appear.
 *   2. EXPONENTIAL DETREND — fit log(views) vs day and compare RESIDUALS on
 *      release days vs quiet days.
 *   3. EFFECT-SIZE GATE — the gap must clear half a pooled sd to count.
 *
 * ⚠️ WHY NOT JUST COMPARE RELEASE DAYS TO QUIET DAYS. Because releases cluster
 * in high-traffic periods. Run raw over Jul 8 - Aug 5 2026 that comparison says
 * the catalogue did +65.6% BETTER on release days — pure surge artifact.
 * Detrended, the same data gives -0.99% vs +3.75%: a 4.7pt gap on a 14.1% sd,
 * i.e. noise. The detrend is not a refinement, it is the whole measurement.
 *
 * ⚠️ IMPRESSIONS ARE NOT HERE and cannot be. `impressions` /
 * `impressionsClickThroughRate` return HTTP 400 from the Analytics API — they
 * are Studio-only. This measures VIEWS. For the impressions half, use the
 * impressions log on /admin/youtube.
 *
 * Reads only. Needs YOUTUBE_OAUTH_CLIENT_ID/_SECRET + YOUTUBE_ANALYTICS_REFRESH_TOKEN
 * (Analytics) and YOUTUBE_API_KEY (public reads). Never writes creds to disk.
 */
import { fitDecay, residuals, assessImpact, newViewerSubsPer1k, type DayPoint } from '../src/lib/release-impact';
import { SITE } from '../src/config/site';

const UPLOADS_PLAYLIST = 'UU' + SITE.youtube.channelId.slice(2);
const SHORT_MAX_SECONDS = 180;
/** Analytics finalises ~3 days back; anything inside this is incomplete. */
const LAG_DAYS = 3;

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

async function analyticsToken(): Promise<string> {
  const { YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET, YOUTUBE_ANALYTICS_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_OAUTH_CLIENT_ID || !YOUTUBE_OAUTH_CLIENT_SECRET || !YOUTUBE_ANALYTICS_REFRESH_TOKEN) {
    throw new Error('YOUTUBE_OAUTH_CLIENT_ID / _SECRET / YOUTUBE_ANALYTICS_REFRESH_TOKEN are required');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: YOUTUBE_OAUTH_CLIENT_ID,
      client_secret: YOUTUBE_OAUTH_CLIENT_SECRET,
      refresh_token: YOUTUBE_ANALYTICS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`Analytics token mint failed (${res.status})`);
  return json.access_token;
}

async function analytics(token: string, query: string): Promise<{ rows?: (string | number)[][] }> {
  const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Analytics ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

function durationSeconds(iso: string | undefined): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

interface Upload {
  id: string;
  title: string;
  publishedAt: string;
}

async function longFormUploads(key: string): Promise<Upload[]> {
  const ids: string[] = [];
  let pageToken = '';
  do {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50` +
        `&playlistId=${UPLOADS_PLAYLIST}&key=${key}&pageToken=${pageToken}`
    );
    if (!res.ok) throw new Error(`playlistItems ${res.status}`);
    const body = (await res.json()) as {
      items?: { contentDetails?: { videoId?: string } }[];
      nextPageToken?: string;
    };
    for (const i of body.items ?? []) if (i.contentDetails?.videoId) ids.push(i.contentDetails.videoId);
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);

  const out: Upload[] = [];
  for (let n = 0; n < ids.length; n += 50) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(n, n + 50).join(',')}&key=${key}`
    );
    if (!res.ok) throw new Error(`videos ${res.status}`);
    const body = (await res.json()) as {
      items?: { id: string; snippet: { title: string; publishedAt: string }; contentDetails: { duration?: string } }[];
    };
    for (const v of body.items ?? []) {
      if (durationSeconds(v.contentDetails.duration) <= SHORT_MAX_SECONDS) continue;
      if (v.snippet.title.toLowerCase().includes('#shorts')) continue;
      out.push({ id: v.id, title: v.snippet.title.split('|')[0].trim(), publishedAt: v.snippet.publishedAt.slice(0, 10) });
    }
  }
  return out.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

async function main() {
  const asJson = process.argv.includes('--json');
  const end = isoDay(LAG_DAYS);
  const from = arg('--from', isoDay(LAG_DAYS + 28));
  const cutoff = arg('--cutoff', '2026-07-01');
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is required');

  const token = await analyticsToken();
  const uploads = await longFormUploads(key);
  const cohort = uploads.filter((u) => u.publishedAt < cutoff);
  const releaseDates = new Set(uploads.filter((u) => u.publishedAt >= from).map((u) => u.publishedAt));
  if (cohort.length === 0) throw new Error(`no long-form songs published before ${cutoff}`);

  const cohortRows = await analytics(
    token,
    `startDate=${from}&endDate=${end}&metrics=views&dimensions=day&filters=video==${cohort.map((c) => c.id).join(',')}`
  );
  const series: DayPoint[] = (cohortRows.rows ?? []).map((r) => ({ date: String(r[0]), views: Number(r[1]) }));

  const totalRows = await analytics(token, `startDate=${from}&endDate=${end}&metrics=views&dimensions=day`);
  const total = new Map((totalRows.rows ?? []).map((r) => [String(r[0]), Number(r[1])]));

  const fit = fitDecay(series);
  if (!fit) throw new Error('not enough finalized days to fit a trend');
  const rows = residuals(series, fit, releaseDates);
  const impact = assessImpact(rows);

  // New-viewer subscriber conversion over the same window.
  const totals = await analytics(token, `startDate=${from}&endDate=${end}&metrics=views,subscribersGained,subscribersLost`);
  const [v, sg, sl] = (totals.rows?.[0] ?? [0, 0, 0]).map(Number);
  const srcRows = await analytics(token, `startDate=${from}&endDate=${end}&metrics=views&dimensions=insightTrafficSourceType`);
  const subViews = Number((srcRows.rows ?? []).find((r) => r[0] === 'SUBSCRIBER')?.[1] ?? 0);
  const adjusted = newViewerSubsPer1k(sg - sl, v, subViews);

  if (asJson) {
    console.log(JSON.stringify({ window: { from, end }, cutoff, cohortSize: cohort.length, fit, rows, impact,
      subs: { net: sg - sl, views: v, subscriberViews: subViews, headlinePer1k: v ? ((sg - sl) / v) * 1000 : null, newViewerPer1k: adjusted } }, null, 2));
    return;
  }

  console.log(`RELEASE IMPACT — ${from} .. ${end} (finalized)\n`);
  console.log(`fixed cohort      : ${cohort.length} long-form songs published before ${cutoff}`);
  console.log(`releases in window: ${releaseDates.size}`);
  console.log(`cohort decay      : ${fit.dailyPct.toFixed(2)}%/day` +
    (fit.halfLifeDays ? `  (half-life ${fit.halfLifeDays.toFixed(0)} days)` : '  (not decaying)'));

  console.log(`\n${'date'.padEnd(12)}${'cohort'.padStart(8)}${'expected'.padStart(10)}${'residual'.padStart(10)}${'total'.padStart(9)}  release?`);
  for (const r of rows) {
    console.log(
      `${r.date.padEnd(12)}${r.actual.toLocaleString().padStart(8)}${Math.round(r.expected).toLocaleString().padStart(10)}` +
        `${`${r.residualPct >= 0 ? '+' : ''}${r.residualPct.toFixed(1)}%`.padStart(10)}` +
        `${(total.get(r.date) ?? 0).toLocaleString().padStart(9)}  ${r.isReleaseDay ? '← RELEASE' : ''}`
    );
  }

  if (!impact) {
    console.log('\nNot enough release/quiet days in this window for a verdict.');
  } else {
    console.log(`\nrelease days  n=${impact.releaseDays}  mean residual ${impact.releaseMeanPct >= 0 ? '+' : ''}${impact.releaseMeanPct.toFixed(2)}%`);
    console.log(`quiet days    n=${impact.quietDays}  mean residual ${impact.quietMeanPct >= 0 ? '+' : ''}${impact.quietMeanPct.toFixed(2)}%`);
    console.log(`difference    ${impact.differencePts >= 0 ? '+' : ''}${impact.differencePts.toFixed(2)} pts` +
      `  |  pooled sd ${impact.pooledSd.toFixed(1)}%  |  effect ${impact.effectInSds.toFixed(2)} sd`);
    console.log(`\nVERDICT: ${impact.verdict.toUpperCase()}\n  ${impact.summary}`);
  }

  console.log(`\nsubscriber conversion over the window`);
  console.log(`  headline        ${v ? (((sg - sl) / v) * 1000).toFixed(2) : '—'} per 1k views`);
  console.log(`  new-viewer only ${adjusted != null ? adjusted.toFixed(2) : '—'} per 1k (excludes ${subViews.toLocaleString()} already-subscribed views)`);
  console.log(`\nImpressions are Studio-only and are NOT in this report — record them in the impressions log on /admin/youtube.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
