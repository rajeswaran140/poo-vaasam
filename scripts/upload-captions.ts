/**
 * upload-captions — generate a caption track from a song's stored lyrics and
 * upload it to its YouTube video (captions.insert).
 *
 * Completes the captions component: lyrics (component 1) → SRT/WebVTT
 * (lib/captions) → YouTube. Real auto-captions for sung Tamil are poor, so a
 * lyric-accurate track is a quality win. Uses the persisted force-ssl write
 * token (mints an access token via refresh-grant — no manual re-auth).
 *
 *   # creds live in Amplify; pull them in for the run (never written to disk):
 *   eval "$(aws amplify get-app --app-id d3rkmepk4popv0 --region ca-central-1 \
 *     --query 'app.environmentVariables' --output json | python3 -c '
 *   import sys,json;e=json.load(sys.stdin)
 *   for k in (\"YOUTUBE_OAUTH_CLIENT_ID\",\"YOUTUBE_OAUTH_CLIENT_SECRET\",\"YOUTUBE_WRITE_REFRESH_TOKEN\"):
 *       print(f\"export {k}={e[k]}\")')"
 *   npx tsx scripts/upload-captions.ts --id <contentId> [--language ta] \
 *     [--name "பாடல் வரிகள்"] [--vtt] [--draft] [--video <videoIdOverride>] [--duration <sec>]
 *
 * Requires AWS creds (DynamoDB read for the content) + the three YOUTUBE_* env
 * vars above. The caption-cue + serialisation logic is pure + unit-tested in
 * lib/captions; this script is the I/O around it.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { lyricsToCues, toSRT, toWebVTT } from '@/lib/captions';
import { getYouTubeId } from '@/lib/utils/youtube';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);

/** Exchange the persisted force-ssl refresh token for an access token. */
async function mintWriteToken(): Promise<string> {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.YOUTUBE_WRITE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refresh) {
    throw new Error(
      'Missing YOUTUBE_OAUTH_CLIENT_ID / _CLIENT_SECRET / YOUTUBE_WRITE_REFRESH_TOKEN in env.'
    );
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Token mint failed: ${data.error} ${data.error_description ?? ''}`.trim());
  }
  return data.access_token;
}

/** captions.insert as a multipart/related upload (metadata part + caption file). */
async function insertCaption(
  accessToken: string,
  snippet: { videoId: string; language: string; name: string; isDraft: boolean },
  caption: string
): Promise<{ id?: string; error?: unknown }> {
  const boundary = 'caption_boundary_' + snippet.videoId;
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ snippet }) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    caption +
    `\r\n--${boundary}--\r\n`;

  const res = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const data = await res.json();
  return res.ok ? { id: data.id } : { error: data };
}

async function main() {
  const id = arg('--id');
  if (!id) throw new Error('Required: --id <contentId>');
  const language = arg('--language') ?? 'ta';
  const name = arg('--name') ?? 'பாடல் வரிகள்';
  const useVtt = has('--vtt');
  const isDraft = has('--draft');

  const content = await new ContentRepository().findById(id);
  if (!content) throw new Error(`Content not found: ${id}`);
  if (content.lyrics.isEmpty()) {
    throw new Error(`No structured lyrics stored for "${content.title}" — add them in /admin first.`);
  }

  const videoId = arg('--video') ?? content.youtubeVideoId ?? getYouTubeId(content.videoUrl ?? '') ?? '';
  if (!videoId) throw new Error('No YouTube video id on this content (pass --video <id>).');

  const totalSec = Number(arg('--duration') ?? content.audioDuration ?? 0);
  if (!(totalSec > 0)) throw new Error('Unknown track duration (pass --duration <seconds>).');

  const cues = lyricsToCues(content.lyrics, { totalSec });
  if (cues.length === 0) throw new Error('Lyrics produced no caption cues.');
  const caption = useVtt ? toWebVTT(cues) : toSRT(cues);

  console.log(`🎬 ${content.title} → ${videoId}`);
  console.log(`   ${cues.length} cues · ${useVtt ? 'WebVTT' : 'SRT'} · lang=${language}${isDraft ? ' · draft' : ''}`);
  if (content.lyrics.isTimeSynced()) console.log('   (using per-line timestamps)');
  else console.log(`   (no timestamps — evenly distributed across ${totalSec}s; refine by hand-syncing lyrics)`);

  const token = await mintWriteToken();
  const result = await insertCaption(token, { videoId, language, name, isDraft }, caption);
  if (result.id) {
    console.log(`✅ caption track inserted: ${result.id}`);
  } else {
    console.error('❌ captions.insert failed:', JSON.stringify(result.error).slice(0, 400));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
