/**
 * tamilagaval-caption-sweep — enforce the caption policy across the catalogue.
 *
 *   npx tsx scripts/tamilagaval-caption-sweep.ts [--limit 20] [--all] [--apply]
 *
 * **The policy (Raj, 2026-09-20):** *"we have to turn off all automatic captions
 * unless we uploaded our lyrics."* Every `asr` track is removed. A track a
 * person uploaded is never touched, so songs with real lyric captions keep
 * them.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it lists what it would delete and what
 * that would cost, and changes nothing.
 *
 * ⚠️ QUOTA. `captions.list` is **50 units**, not 1 — misreading that burned an
 * entire 10,000-unit day on 2026-07-29. A full catalogue pass is ~6,200 units
 * before a single delete, which is why `--limit 20` is the default and `--all`
 * has to be asked for. The sweep refuses to start unless the WORST case fits,
 * because one that dies halfway leaves the catalogue in a state nobody can
 * describe.
 *
 * ⚠️ IT IS A HOLDING ACTION, NOT A FIX. The tracks regenerate — two of the
 * seven deleted by hand on 2026-09-19/20 were back within hours. There is no
 * channel-wide switch (YouTube's only channel-level caption setting filters
 * inappropriate words), and language metadata does not control the ASR language
 * either. What the sweep buys is that in the hours after a premiere, when the
 * most people arrive, nobody is served a wrong-language transcript.
 *
 * The videos it reports as left with NO captions are the useful output: those
 * are the songs that deserve a real track via scripts/upload-captions.ts.
 */

import {
  decideCaptions,
  sweepCost,
  canAfford,
  type CaptionTrack,
} from '@/lib/caption-policy';
import { amplifyEnv } from './lib/amplify-env';

const UPLOADS_PLAYLIST = 'UUZCuphXleq-mXVYgvqh-OlQ';
const DEFAULT_LIMIT = 20;
/** Well under the 10,000 daily budget: the snapshot cron and ad-hoc work share it. */
const UNITS_AVAILABLE = 8_000;

const arg = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const all = process.argv.includes('--all');
  const limit = all ? Number.POSITIVE_INFINITY : arg('--limit', DEFAULT_LIMIT);

  const env = await amplifyEnv();
  const key = env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY found in neither the Amplify env nor SSM');

  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.YOUTUBE_OAUTH_CLIENT_ID ?? '',
      client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET ?? '',
      refresh_token: env.YOUTUBE_DATA_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
  })).json();
  const AT = (tok as { access_token?: string }).access_token;
  if (!AT) throw new Error('could not mint a write token');
  const H = { Authorization: `Bearer ${AT}` };

  // Newest first. playlistItems is 1 unit per page.
  const videos: Array<{ id: string; title: string }> = [];
  let page = '';
  let pages = 0;
  do {
    const r = await (await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&playlistId=${UPLOADS_PLAYLIST}&maxResults=50&key=${key}${page ? `&pageToken=${page}` : ''}`
    )).json();
    pages += 1;
    for (const i of r.items ?? []) {
      videos.push({ id: i.contentDetails.videoId, title: i.snippet.title });
    }
    page = r.nextPageToken ?? '';
  } while (page && videos.length < limit);

  const scope = videos.slice(0, Number.isFinite(limit) ? limit : videos.length);
  const worst = sweepCost(scope.length, scope.length, pages);
  console.log(
    `${scope.length} video(s) of ${videos.length} listed · worst case ~${worst} quota units` +
    `${apply ? '' : ' · DRY RUN'}`
  );
  if (!canAfford(scope.length, pages, UNITS_AVAILABLE)) {
    console.error(
      `REFUSING: worst case ${worst} units exceeds the ${UNITS_AVAILABLE} this sweep may use. ` +
      `Lower --limit, or run it across more than one day.`
    );
    process.exit(2);
  }

  let deleted = 0;
  const noCaptions: Array<{ id: string; title: string }> = [];
  const keptOurs: string[] = [];

  for (const v of scope) {
    const listed = await (await fetch(
      `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${v.id}`,
      { headers: H }
    )).json();
    const tracks: CaptionTrack[] = (listed.items ?? []).map(
      (t: { id: string; snippet: { trackKind: string; language: string } }) => ({
        id: t.id, trackKind: t.snippet.trackKind, language: t.snippet.language,
      })
    );

    const verdict = decideCaptions(tracks);
    if (verdict.keepsCaptions) keptOurs.push(v.id);
    else noCaptions.push(v);

    if (verdict.action !== 'delete') continue;

    const langs = tracks.filter((t) => t.trackKind === 'asr').map((t) => t.language).join(',');
    console.log(`  ${v.id}  ${verdict.trackIds.length} asr (${langs})  ${v.title.slice(0, 44)}`);
    if (!apply) continue;

    for (const id of verdict.trackIds) {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/captions?id=${id}`, {
        method: 'DELETE', headers: H,
      });
      console.log(`      DELETE ${id.slice(0, 20)}…  HTTP ${res.status}`);
      if (res.ok) deleted += 1;
    }
  }

  console.log(`\n${apply ? `deleted ${deleted} track(s)` : 'dry run — nothing changed'}`);
  console.log(`${keptOurs.length} video(s) keep OUR uploaded captions`);
  if (noCaptions.length) {
    console.log(`\n${noCaptions.length} video(s) now have NO captions — candidates for a real lyric track:`);
    for (const v of noCaptions.slice(0, 15)) console.log(`  ${v.id}  ${v.title.slice(0, 56)}`);
    if (noCaptions.length > 15) console.log(`  …and ${noCaptions.length - 15} more`);
    console.log(`  npx tsx scripts/upload-captions.ts --id <contentId>`);
  }
  // A deleted track can still list for a minute. Verification is the NEXT run's
  // job rather than doubling this one's quota to re-read every video.
  if (apply) console.log('\nRe-run tomorrow to confirm, and to catch what regenerates.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
