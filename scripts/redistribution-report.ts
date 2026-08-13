/**
 * Redistribution report — which songs are better received than distributed.
 * Read-only: YouTube Analytics + Data API + the DynamoDB theme join.
 *   npx tsx scripts/redistribution-report.ts [--top 12]
 */
import { execFileSync } from 'node:child_process';
import { rankRedistribution, topRediscovery, type RedistributionInput } from '@/lib/song-redistribution';

const UP = 'UUZCuphXleq-mXVYgvqh-OlQ'; // uploads playlist (channel UC… → UU…)
const TOP = Number(process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : 12);
const sh = (c: string) => execFileSync('bash', ['-lc', c], { encoding: 'utf8', maxBuffer: 64e6 });
const env = JSON.parse(sh(`aws amplify get-app --app-id d3rkmepk4popv0 --region ca-central-1 --query 'app.environmentVariables' --output json`));

async function main() {
  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({
      client_id: env.YOUTUBE_OAUTH_CLIENT_ID, client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
      refresh_token: env.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  })).json();
  const AT = tok.access_token as string;
  const END = '2026-08-10', START = '2025-08-13';
  const an = async (p: Record<string, string>) => {
    const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    Object.entries({ ids: 'channel==MINE', ...p }).forEach(([k, v]) => u.searchParams.set(k, v));
    const d = await (await fetch(u, { headers: { Authorization: `Bearer ${AT}` } })).json();
    const h = (d.columnHeaders ?? []).map((x: { name: string }) => x.name);
    return (d.rows ?? []).map((r: unknown[]) => Object.fromEntries(h.map((n: string, i: number) => [n, r[i]])));
  };
  const stats = await an({ startDate: START, endDate: END, dimensions: 'video', maxResults: '200', sort: '-views',
    metrics: 'views,averageViewPercentage,subscribersGained,likes,comments,shares' });

  // publishedAt + duration, to compute age and drop Shorts
  const ids: string[] = [], meta = new Map<string, { pub: string; dur: number; title: string }>();
  let page = '';
  do {
    const d = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${UP}&maxResults=50&key=${env.YOUTUBE_API_KEY}${page ? `&pageToken=${page}` : ''}`)).json();
    d.items.forEach((i: { contentDetails: { videoId: string } }) => ids.push(i.contentDetails.videoId));
    page = d.nextPageToken ?? '';
  } while (page);
  for (let i = 0; i < ids.length; i += 50) {
    const d = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(',')}&key=${env.YOUTUBE_API_KEY}`)).json();
    for (const v of d.items) {
      const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails.duration ?? '') ?? [];
      meta.set(v.id, { pub: v.snippet.publishedAt, title: v.snippet.title, dur: (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) });
    }
  }
  // theme join
  const scan = JSON.parse(sh(`aws dynamodb scan --table-name TamilWebContent --region ca-central-1 --filter-expression 'begins_with(PK, :p) AND SK = :s' --expression-attribute-values '{":p":{"S":"CONTENT#"},":s":{"S":"METADATA"}}' --output json`));
  const themeByVid = new Map<string, string>();
  for (const it of scan.Items ?? []) {
    const vid = it.youtubeVideoId?.S, th = it.theme?.S;
    if (vid && th) themeByVid.set(vid, th);
  }
  const asOf = new Date(`${END}T00:00:00Z`).getTime();
  const rows: RedistributionInput[] = stats
    .filter((s: Record<string, number | string>) => (meta.get(String(s.video))?.dur ?? 0) > 180)
    .map((s: Record<string, number>) => {
      const m = meta.get(String(s.video))!;
      const ageDays = Math.max(1, (asOf - new Date(m.pub).getTime()) / 86400000);
      const v = s.views || 1;
      return {
        videoId: String(s.video), title: m.title.split('|')[0].trim(), theme: themeByVid.get(String(s.video)) ?? null,
        views: s.views, ageDays, viewsPerDay: s.views / ageDays,
        subsPer1k: (s.subscribersGained / v) * 1000, retention: s.averageViewPercentage,
        engagement: (s.comments / v) * 1000, likesPer1k: (s.likes / v) * 1000, sharesPer1k: (s.shares / v) * 1000,
      };
    });
  const { ranked, ineligible } = rankRedistribution(rows);
  console.log(`catalogue: ${rows.length} long-form songs · eligible ${ranked.length} · excluded ${ineligible.length}`);
  console.log(`  excluded: ${ineligible.map((i) => `${i.title.slice(0, 22)}(${i.reason})`).join(', ') || '—'}`);
  console.log(`\n${'#'.padStart(3)}  ${'score'.padStart(6)} ${'qual'.padStart(6)} ${'reach'.padStart(6)}  ${'v/day'.padStart(6)} ${'AVP'.padStart(5)} ${'sh/1k'.padStart(6)} ${'sub/1k'.padStart(6)}  theme      title`);
  for (const r of ranked.slice(0, TOP)) {
    const s = rows.find((x) => x.videoId === r.videoId)!;
    console.log(`${String(r.rank).padStart(3)}  ${r.score.toFixed(2).padStart(6)} ${r.quality.toFixed(2).padStart(6)} ${r.reach.toFixed(2).padStart(6)}  ${(s.viewsPerDay ?? 0).toFixed(0).padStart(6)} ${(s.retention ?? 0).toFixed(0).padStart(5)} ${(s.sharesPer1k ?? 0).toFixed(0).padStart(6)} ${(s.subsPer1k ?? 0).toFixed(1).padStart(6)}  ${(r.theme ?? '—').padEnd(10).slice(0, 10)} ${r.title.slice(0, 34)}`);
  }
  const top = topRediscovery(ranked);
  console.log(`\n⭐ Rediscover this week: ${top ? `${top.title} (${top.videoId})\n   ${top.why}` : 'nothing qualifies — distribution matches reception across the catalogue'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
