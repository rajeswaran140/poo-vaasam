/**
 * tamilagaval-conversion-audit — what converts, and which hooks are missing.
 *
 *   npx tsx scripts/tamilagaval-conversion-audit.ts
 *
 * READ-ONLY. Conversion is measured as subscribers and likes **per 1,000
 * views**, never as totals: a total just re-ranks by reach, which is the one
 * thing already visible in Studio.
 *
 * ⚠️ WHAT IT WILL NOT TELL YOU. It reports rates and counts. It does not
 * explain WHY one song converts at 8.77 subs/1k and another at 0.00 — nothing
 * measurable here separates them, including average view percentage, which
 * appears at 48% in both the best and the worst converter. Do not read a
 * creative prescription out of this output; see the conversion doc for why.
 *
 * Videos under 200 views are excluded — a rate over 40 views is noise.
 *
 * Quota: playlistItems + videos.list only, about 6 units for the whole
 * catalogue. The Analytics API has its own separate budget.
 */
import { amplifyEnv } from './lib/amplify-env';

const UP = 'UUZCuphXleq-mXVYgvqh-OlQ';

async function main() {
  const env = await amplifyEnv();
  const key = env.YOUTUBE_API_KEY;
  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.YOUTUBE_OAUTH_CLIENT_ID,
      client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
      refresh_token: env.YOUTUBE_ANALYTICS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })).json();
  const AT = tok.access_token as string;

  const ids: string[] = [];
  let page = '';
  do {
    const r = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${UP}&maxResults=50&key=${key}${page ? `&pageToken=${page}` : ''}`)).json();
    for (const i of r.items ?? []) ids.push(i.contentDetails.videoId);
    page = r.nextPageToken ?? '';
  } while (page);

  type Meta = { title: string; secs: number; desc: string; pub: string };
  const meta = new Map<string, Meta>();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(',')}&key=${key}`)).json();
    for (const v of d.items ?? []) {
      const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails?.duration ?? '');
      meta.set(v.id, {
        title: v.snippet.title,
        secs: m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0,
        desc: v.snippet.description ?? '',
        pub: v.snippet.publishedAt,
      });
    }
  }

  const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  Object.entries({
    ids: 'channel==MINE', startDate: '2026-05-01',
    endDate: new Date().toISOString().slice(0, 10),
    dimensions: 'video', metrics: 'views,likes,subscribersGained,averageViewPercentage',
    maxResults: '200', sort: '-views',
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  const rep = await (await fetch(u, { headers: { Authorization: `Bearer ${AT}` } })).json();

  type Row = { id: string; title: string; views: number; likes: number; subs: number; avp: number; isShort: boolean };
  const rows: Row[] = [];
  for (const r of rep.rows ?? []) {
    const [id, views, likes, subs, avp] = r as [string, number, number, number, number];
    const m = meta.get(id);
    if (!m || views < 200) continue;           // too small to rate reliably
    rows.push({ id, title: m.title, views, likes, subs, avp, isShort: m.secs > 0 && m.secs <= 180 });
  }

  const per1k = (n: number, v: number) => (v ? (n / v) * 1000 : 0);
  const songs = rows.filter((r) => !r.isShort);

  console.log(`SONGS with >=200 views: ${songs.length}\n`);
  console.log('BEST SUBSCRIBER CONVERSION (subs per 1,000 views)');
  console.log('   subs/1k  likes/1k   views   avp%   title');
  for (const r of [...songs].sort((a, b) => per1k(b.subs, b.views) - per1k(a.subs, a.views)).slice(0, 8)) {
    console.log(`   ${per1k(r.subs, r.views).toFixed(2).padStart(7)}  ${per1k(r.likes, r.views).toFixed(1).padStart(7)}  ${String(r.views).padStart(6)}  ${r.avp.toFixed(0).padStart(4)}   ${r.title.slice(0, 40)}`);
  }
  console.log('\nWORST SUBSCRIBER CONVERSION');
  for (const r of [...songs].sort((a, b) => per1k(a.subs, a.views) - per1k(b.subs, b.views)).slice(0, 6)) {
    console.log(`   ${per1k(r.subs, r.views).toFixed(2).padStart(7)}  ${per1k(r.likes, r.views).toFixed(1).padStart(7)}  ${String(r.views).padStart(6)}  ${r.avp.toFixed(0).padStart(4)}   ${r.title.slice(0, 40)}`);
  }

  // Does reach correlate with conversion? Split at the median view count.
  const byViews = [...songs].sort((a, b) => a.views - b.views);
  const mid = Math.floor(byViews.length / 2);
  const lo = byViews.slice(0, mid), hi = byViews.slice(mid);
  const avg = (xs: Row[], f: (r: Row) => number) => xs.reduce((a, b) => a + f(b), 0) / (xs.length || 1);
  console.log('\nDOES REACH HELP CONVERSION?');
  console.log(`  smaller half (n=${lo.length}, median ${lo[Math.floor(lo.length / 2)]?.views} views): ` +
    `${avg(lo, (r) => per1k(r.subs, r.views)).toFixed(2)} subs/1k · ${avg(lo, (r) => per1k(r.likes, r.views)).toFixed(1)} likes/1k`);
  console.log(`  larger half  (n=${hi.length}, median ${hi[Math.floor(hi.length / 2)]?.views} views): ` +
    `${avg(hi, (r) => per1k(r.subs, r.views)).toFixed(2)} subs/1k · ${avg(hi, (r) => per1k(r.likes, r.views)).toFixed(1)} likes/1k`);

  // Mechanical hooks, catalogue-wide.
  const all = [...meta.values()];
  const missing = (re: RegExp) => all.filter((m) => !re.test(m.desc)).length;
  console.log(`\nMECHANICAL HOOKS MISSING (of ${all.length} uploads)`);
  console.log(`  no sub_confirmation=1 link : ${missing(/sub_confirmation=1/)}`);
  console.log(`  no playlist link           : ${missing(/playlist\?list=/)}`);
  console.log(`  no UTM-tagged site link    : ${missing(/utm_source=youtube/)}`);
  console.log(`  no music-composition link  : ${missing(/music-composition/)}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
