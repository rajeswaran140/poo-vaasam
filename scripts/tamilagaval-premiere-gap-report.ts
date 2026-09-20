/**
 * tamilagaval-premiere-gap-report — does the upload → premiere gap matter?
 *
 *   npx tsx scripts/tamilagaval-premiere-gap-report.ts [--limit 48]
 *
 * READ-ONLY. Joins the gap observations recorded by the preflight with each
 * video's launch-day views, and reports whether the checklist's "keep the gap
 * under 48h" rule holds.
 *
 * ⚠️ IT WILL SAY "not enough data" FOR A WHILE, AND THAT IS THE POINT. The rule
 * became advice on the strength of a single case (QDJG1P7D0Aw: 71.6h, 2 views
 * in 89 minutes) and was repeated to Raj for months. The most recent comparable
 * release contradicts it — வெண்மதி sat 69.5h and took 46 views in its first
 * 3.4 hours. This refuses to call it either way until both sides have five
 * releases, because concluding from two anecdotes is the mistake it exists to
 * stop.
 *
 * Only releases observed BEFORE they aired can appear: YouTube overwrites
 * publishedAt at air time, so everything published before this script existed
 * is permanently unmeasurable.
 */
import { PremiereObservationRepository } from '@/infrastructure/database/PremiereObservationRepository';
import { report, ASSERTED_GAP_LIMIT_HOURS, type LaunchResult } from '@/lib/premiere-observation';
import { amplifyEnv } from './lib/amplify-env';

async function main() {
  const i = process.argv.indexOf('--limit');
  const limit = i >= 0 && Number.isFinite(Number(process.argv[i + 1]))
    ? Number(process.argv[i + 1])
    : ASSERTED_GAP_LIMIT_HOURS;

  const observations = await new PremiereObservationRepository().list();
  if (!observations.length) {
    console.log('No observations yet. They are recorded by the preflight:');
    console.log('  npx tsx scripts/tamilagaval-release-preflight.ts <VIDEO_ID>');
    console.log('Run it on every premiere BEFORE it airs — afterwards the gap is unrecoverable.');
    return;
  }

  const env = await amplifyEnv();
  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.YOUTUBE_OAUTH_CLIENT_ID ?? '',
      client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET ?? '',
      refresh_token: env.YOUTUBE_ANALYTICS_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
  })).json();
  const AT = (tok as { access_token?: string }).access_token;
  if (!AT) throw new Error('could not mint an analytics token');

  const results: LaunchResult[] = [];
  for (const o of observations) {
    const day0 = o.scheduledStartTime.slice(0, 10);
    // Analytics lags 2-3 days; a premiere that has not aired, or aired too
    // recently, returns nothing. Null, not zero — a missing reading must not
    // be counted as a bad launch.
    const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    Object.entries({
      ids: 'channel==MINE', startDate: day0, endDate: day0,
      dimensions: 'day', metrics: 'views', filters: `video==${o.videoId}`,
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const rep = await (await fetch(u, { headers: { Authorization: `Bearer ${AT}` } })).json();
    const views = (rep.rows ?? [])[0]?.[1];
    results.push({ observation: o, day0Views: typeof views === 'number' ? views : null });
  }

  console.log(`${observations.length} observation(s) · threshold ${limit}h\n`);
  console.log('  gap(h)   d0 views   aired            title');
  for (const r of results.sort((a, b) => a.observation.gapHours - b.observation.gapHours)) {
    console.log(
      `  ${String(r.observation.gapHours).padStart(6)}   ` +
      `${String(r.day0Views ?? '—').padStart(8)}   ` +
      `${r.observation.scheduledStartTime.slice(0, 16)}   ${r.observation.title.slice(0, 34)}`
    );
  }

  const out = report(results, limit);
  console.log(`\n  under ${limit}h : ${out.under.length} release(s)` +
    (out.medianUnder !== null ? `, median ${out.medianUnder} views` : ''));
  console.log(`  ${limit}h or more : ${out.over.length} release(s)` +
    (out.medianOver !== null ? `, median ${out.medianOver} views` : ''));
  console.log(`\n  ${out.verdict}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
