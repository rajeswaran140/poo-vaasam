/**
 * tamilagaval-release-preflight — run the release checklist against a live video.
 *
 *   npx tsx scripts/tamilagaval-release-preflight.ts <VIDEO_ID>
 *
 * READ-ONLY. Builds a VideoSnapshot from the Data API and hands it to
 * checkRelease(), so the findings are exactly what src/lib/release-checklist.ts
 * defines — no second opinion, no drift.
 *
 * WHY IT EXISTS: the post-premiere audit script is useless before a premiere
 * airs (no duration, no analytics, no views), but that is precisely when a
 * metadata mistake is still cheap to fix. This is the pre-flight half.
 *
 * Credentials follow the same SSM pattern as the other tamilagaval scripts.
 */

import { checkRelease, type VideoSnapshot, type Finding } from '../src/lib/release-checklist';

const APP_ID = 'd3rkmepk4popv0';
const BRANCH = 'master';
const REGION = 'ca-central-1';

async function sh(cmd: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('bash', ['-c', cmd], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function token(): Promise<string> {
  const p = `/amplify/${APP_ID}/${BRANCH}`;
  const cs = await sh(`aws --region ${REGION} ssm get-parameter --name "${p}/YOUTUBE_OAUTH_CLIENT_SECRET" --with-decryption --query 'Parameter.Value' --output text`);
  const rt = await sh(`aws --region ${REGION} ssm get-parameter --name "${p}/YOUTUBE_DATA_REFRESH_TOKEN" --with-decryption --query 'Parameter.Value' --output text`);
  const ci = await sh(`aws --region ${REGION} amplify get-app --app-id ${APP_ID} --query 'app.environmentVariables.YOUTUBE_OAUTH_CLIENT_ID' --output text`);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: ci, client_secret: cs, refresh_token: rt, grant_type: 'refresh_token' }),
  });
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('OAuth token refresh failed');
  return j.access_token;
}

const api = async (tok: string, path: string) => {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  return r.json() as Promise<Record<string, any>>;
};

async function main() {
  const args = process.argv.slice(2);
  const forceShort = args.includes('--short');
  const videoId = args.find((a) => !a.startsWith('--'));
  if (!videoId) {
    console.error('usage: tamilagaval-release-preflight.ts <VIDEO_ID> [--short]');
    process.exit(2);
  }
  const tok = await token();

  const v = await api(tok, `videos?part=snippet,contentDetails,status&id=${videoId}`);
  const item = v.items?.[0];
  if (!item) { console.error(`video ${videoId} not found`); process.exit(1); }
  const sn = item.snippet;

  // Playlist membership: ask each channel playlist whether it holds this video.
  const pls = await api(tok, `playlists?part=id,snippet&channelId=UCZCuphXleq-mXVYgvqh-OlQ&maxResults=50`);
  const playlistIds: string[] = [];
  for (const pl of pls.items ?? []) {
    const hit = await api(tok, `playlistItems?part=id&playlistId=${pl.id}&videoId=${videoId}&maxResults=1`);
    if ((hit.items ?? []).length > 0) playlistIds.push(pl.id);
  }

  const caps = await api(tok, `captions?part=snippet&videoId=${videoId}`);
  const captionTracks = (caps.items ?? []).map((c: any) => ({
    trackKind: c.snippet?.trackKind ?? 'standard',
    language: c.snippet?.language ?? '',
  }));

  const duration: string | undefined = item.contentDetails?.duration;
  const isUpcoming = sn.liveBroadcastContent === 'upcoming';

  const snapshot: VideoSnapshot = {
    videoId,
    title: sn.title ?? '',
    description: sn.description ?? '',
    tags: sn.tags ?? [],
    categoryId: sn.categoryId ?? '',
    defaultLanguage: sn.defaultLanguage,
    defaultAudioLanguage: sn.defaultAudioLanguage,
    // maxres only exists once a custom thumbnail has been set.
    hasCustomThumbnail: Boolean(sn.thumbnails?.maxres),
    // The API exposes no "is this a Short" field -- YouTube decides from aspect
    // ratio as well as length, and neither is derivable here. The duration test
    // below is a floor, not a verdict: it catches sub-minute clips, but a Short
    // can now run to 3 minutes, and a premiere has no duration at all until it
    // airs. Pass --short when you know, which is why the flag exists.
    isShort: forceShort || (duration ? /^PT(\d{1,2})S$/.test(duration) : false),
    playlistIds,
    captionTracks,
    isUpcoming,
  };

  const findings: Finding[] = checkRelease(snapshot);
  const bySev = (s: string) => findings.filter((f) => f.severity === s);

  console.log('='.repeat(70));
  console.log(`RELEASE PRE-FLIGHT — ${videoId}`);
  console.log('='.repeat(70));
  console.log(`title      : ${snapshot.title}`);
  console.log(`state      : ${isUpcoming ? 'UPCOMING PREMIERE (not yet aired)' : 'published'}`);
  console.log(`category   : ${snapshot.categoryId}   lang: ${snapshot.defaultLanguage ?? '-'} / audio: ${snapshot.defaultAudioLanguage ?? '-'}`);
  console.log(`tags       : ${snapshot.tags.length}   playlists: ${playlistIds.length}   captions: ${captionTracks.length}`);
  console.log(`thumbnail  : ${snapshot.hasCustomThumbnail ? 'custom' : 'MISSING'}`);
  console.log('');
  console.log(`findings   : ${bySev('blocker').length} blocker · ${bySev('gap').length} gap · ${bySev('note').length} note`);
  console.log('');
  for (const sev of ['blocker', 'gap', 'note'] as const) {
    for (const f of bySev(sev)) {
      console.log(`[${sev.toUpperCase()}] ${f.title}`);
      console.log(`   ${f.detail}`);
      if (f.fix) console.log(`   fix: ${f.fix}`);
      console.log('');
    }
  }
}

main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
