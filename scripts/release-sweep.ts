/**
 * release-sweep — grade recent uploads against the release checklist.
 *
 *   npx tsx scripts/release-sweep.ts [--days 7] [--limit 15] [--json]
 *
 * WHY THIS RUNS ON A SCHEDULE. Two things drift on their own:
 *   - YouTube REGENERATES auto-caption tracks after deletion. A fresh English
 *     ASR track appeared on a Tamil Short within a day of a catalogue-wide
 *     sweep, so the cleanup is not one-and-done.
 *   - A gap found by hand gets lost. A Short published 2026-07-28 shipped with
 *     no link to its own premiere; it was spotted the same day, mentioned, and
 *     then sat broken for three days across other work until a sweep found it
 *     again.
 * Neither is caught by looking harder. Both are caught by looking regularly.
 *
 * ⚠️ QUOTA. `captions.list` costs 50 units — misreading that as 1 exhausted a
 * whole day's 10,000-unit budget on 2026-07-29. One video costs ~65, so this
 * refuses to start if the requested sweep would not comfortably fit, and says
 * what it would have cost.
 *
 * Read-only. It reports; it changes nothing.
 */

import {
  summariseRelease,
  SHORTS_PLAYLIST_ID,
  ALL_SONGS_PLAYLIST_ID,
  LATEST_PLAYLIST_ID,
  type VideoSnapshot,
  type Finding,
} from '@/lib/release-checklist';
import {
  parseIsoDuration,
  isShortDuration,
  planSweep,
  DAILY_QUOTA_BUDGET,
  MAX_SWEEP_UNITS,
} from '@/lib/release-sweep';

const CHANNEL_UPLOADS_PLAYLIST = 'UUZCuphXleq-mXVYgvqh-OlQ';
const PLAYLISTS = [SHORTS_PLAYLIST_ID, ALL_SONGS_PLAYLIST_ID, LATEST_PLAYLIST_ID];

/**
 * Pages probed per video. All Songs is past 50 items, so it is two pages — the
 * exact off-by-one that twice made a video look absent from that playlist.
 */
const PLAYLIST_PAGES = PLAYLISTS.length + 1;

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const flag = (name: string) => process.argv.includes(name);

async function amplifyEnv(): Promise<Record<string, string>> {
  const { AmplifyClient, GetAppCommand } = await import('@aws-sdk/client-amplify');
  const c = new AmplifyClient({ region: 'ca-central-1' });
  const app = await c.send(new GetAppCommand({ appId: 'd3rkmepk4popv0' }));
  return app.app?.environmentVariables ?? {};
}

async function writeToken(env: Record<string, string>): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.YOUTUBE_OAUTH_CLIENT_ID ?? '',
      client_secret: env.YOUTUBE_OAUTH_CLIENT_SECRET ?? '',
      refresh_token: env.YOUTUBE_DATA_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
  });
  const j = (await res.json()) as { access_token?: string };
  return j.access_token ?? null;
}

async function main() {
  const days = arg('--days', 7);
  const limit = arg('--limit', 15);
  const env = await amplifyEnv();
  const key = env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY missing from the Amplify env');
  const token = await writeToken(env);

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Recent uploads, newest first. playlistItems is 1 unit per page.
  const listed: Array<{ id: string; title: string; publishedAt: string }> = [];
  let page = '';
  for (let i = 0; i < 3; i++) {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${CHANNEL_UPLOADS_PLAYLIST}` +
        `&maxResults=50&key=${key}${page ? `&pageToken=${page}` : ''}`
    );
    const j = (await r.json()) as { items?: Array<Record<string, any>>; nextPageToken?: string };
    for (const it of j.items ?? []) {
      listed.push({
        id: it.snippet?.resourceId?.videoId,
        title: String(it.snippet?.title ?? ''),
        publishedAt: String(it.snippet?.publishedAt ?? ''),
      });
    }
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }

  const recent = listed.filter((v) => v.publishedAt >= since).slice(0, limit);

  if (!recent.length) {
    console.log(`No uploads in the last ${days} days. Nothing to check.`);
    return;
  }

  const plan = planSweep(recent.length, PLAYLIST_PAGES);
  const cost = plan.estimatedUnits;
  if (!plan.affordable) {
    console.log(
      `Refusing: ${recent.length} videos would cost ~${cost} units of the ${DAILY_QUOTA_BUDGET}/day ` +
        `budget (cap ${MAX_SWEEP_UNITS}). Re-run with --limit ${plan.maxAffordableVideos} or fewer.`
    );
    return;
  }

  const results: Array<{ id: string; title: string; ready: boolean; findings: Finding[] }> = [];
  for (const v of recent) {
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${v.id}&key=${key}`
    );
    const vj = (await vr.json()) as { items?: Array<Record<string, any>> };
    const item = vj.items?.[0];
    if (!item) continue;
    const sn = item.snippet ?? {};
    const seconds = parseIsoDuration(item.contentDetails?.duration);

    let captionTracks: Array<{ trackKind: string; language: string }> = [];
    if (token) {
      const cr = await fetch(
        `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${v.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (cr.ok) {
        const cj = (await cr.json()) as { items?: Array<Record<string, any>> };
        captionTracks = (cj.items ?? []).map((t) => ({
          trackKind: String(t.snippet?.trackKind ?? ''),
          language: String(t.snippet?.language ?? ''),
        }));
      }
    }

    const playlistIds: string[] = [];
    for (const pid of PLAYLISTS) {
      let tok = '';
      let found = false;
      for (let p = 0; p < 10 && !found; p++) {
        const pr = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${pid}` +
            `&maxResults=50&key=${key}${tok ? `&pageToken=${tok}` : ''}`
        );
        const pj = (await pr.json()) as { items?: Array<Record<string, any>>; nextPageToken?: string };
        if ((pj.items ?? []).some((i) => i.contentDetails?.videoId === v.id)) found = true;
        if (!pj.nextPageToken) break;
        tok = pj.nextPageToken;
      }
      if (found) playlistIds.push(pid);
    }

    const snapshot: VideoSnapshot = {
      videoId: v.id,
      title: String(sn.title ?? ''),
      description: String(sn.description ?? ''),
      tags: Array.isArray(sn.tags) ? sn.tags.map(String) : [],
      categoryId: String(sn.categoryId ?? ''),
      defaultLanguage: sn.defaultLanguage,
      defaultAudioLanguage: sn.defaultAudioLanguage,
      hasCustomThumbnail: Boolean(sn.thumbnails?.maxres),
      isShort: isShortDuration(seconds),
      playlistIds,
      captionTracks,
      isUpcoming: sn.liveBroadcastContent === 'upcoming',
    };
    const s = summariseRelease(snapshot);
    results.push({ id: v.id, title: snapshot.title, ready: s.ready, findings: s.findings });
  }

  if (flag('--json')) {
    console.log(JSON.stringify({ days, checked: results.length, cost, results }, null, 2));
    return;
  }

  const needing = results.filter((r) => !r.ready);
  console.log(`Checked ${results.length} upload(s) from the last ${days} days (~${cost} quota units).`);
  console.log(`${results.length - needing.length} ready · ${needing.length} needing attention\n`);
  for (const r of needing) {
    const actionable = r.findings.filter((f) => f.severity !== 'note');
    console.log(`${r.id}  ${r.title.slice(0, 54)}`);
    for (const f of actionable) console.log(`   ${f.severity === 'blocker' ? '✗' : '•'} ${f.title}`);
    console.log('');
  }
  if (!needing.length) console.log('Nothing outstanding.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
