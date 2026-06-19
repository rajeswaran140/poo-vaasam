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

import { readFileSync } from 'node:fs';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { Lyrics } from '@/domain/songs/Lyrics';
import { lyricsToCues, toSRT, toWebVTT, parseSrt, type CaptionCue } from '@/lib/captions';
import { alignLyricLineStarts, fillStarts } from '@/lib/align-lyrics';
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

/** Download the video's ASR (auto) caption track as timed cues, for alignment. */
async function fetchAsrCues(accessToken: string, videoId: string): Promise<CaptionCue[]> {
  const list = await fetch(
    `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = (await list.json()) as { items?: { id: string; snippet: { trackKind?: string } }[] };
  const asr = (listData.items ?? []).find((c) => c.snippet.trackKind === 'asr');
  if (!asr) return [];
  const dl = await fetch(`https://www.googleapis.com/youtube/v3/captions/${asr.id}?tfmt=srt`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!dl.ok) throw new Error(`ASR download failed: HTTP ${dl.status}`);
  return parseSrt(await dl.text());
}

async function main() {
  const id = arg('--id');
  const language = arg('--language') ?? 'ta';
  const name = arg('--name') ?? 'பாடல் வரிகள்';
  const useVtt = has('--vtt');
  const isDraft = has('--draft');

  // Two sources of lyrics:
  //  - --id <contentId>: a stored site song (lyrics + video + duration from DB).
  //  - --video + --duration + lyrics (from --lyrics-file or stdin): a YouTube-only
  //    song with no site content item.
  let lyrics: Lyrics;
  let lyricLines: string[];
  // Blank-line blocks (stanzas/couplets) — used by --group to show a block's
  // lines together as one caption instead of one line at a time.
  let blocks: string[][];
  let videoId: string;
  let totalSec: number;
  let label: string;

  if (id) {
    const content = await new ContentRepository().findById(id);
    if (!content) throw new Error(`Content not found: ${id}`);
    if (content.lyrics.isEmpty()) {
      throw new Error(`No structured lyrics stored for "${content.title}" — add them in /admin first.`);
    }
    lyrics = content.lyrics;
    blocks = lyrics.sections.map((s) => s.lines.map((l) => l.text));
    lyricLines = blocks.flat();
    videoId = arg('--video') ?? content.youtubeVideoId ?? getYouTubeId(content.videoUrl ?? '') ?? '';
    totalSec = Number(arg('--duration') ?? content.audioDuration ?? 0);
    label = content.title;
  } else {
    videoId = arg('--video') ?? '';
    if (!videoId) throw new Error('Required: --id <contentId>  OR  --video <id> --duration <sec> (+ lyrics via --lyrics-file/stdin).');
    totalSec = Number(arg('--duration') ?? 0);
    const lyricsFile = arg('--lyrics-file');
    const raw = lyricsFile ? readFileSync(lyricsFile, 'utf8') : readFileSync(0, 'utf8');
    // Drop bracketed stage directions / section headers ("[Intro …]", "[Break …]",
    // "[Chorus — Pallavi]") so they never become caption text.
    const text = raw
      .split(/\r?\n/)
      .filter((l) => !/^\s*\[.*\]\s*$/.test(l))
      .join('\n');
    lyrics = Lyrics.fromPlainText(text);
    if (lyrics.isEmpty()) throw new Error('No lyrics provided (via --lyrics-file or stdin).');
    blocks = text
      .split(/\n[ \t]*\n/)
      .map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
      .filter((b) => b.length > 0);
    lyricLines = blocks.flat();
    label = arg('--title') ?? videoId;
  }

  if (!videoId) throw new Error('No YouTube video id (pass --video <id>).');
  if (!(totalSec > 0)) throw new Error('Unknown track duration (pass --duration <seconds>).');

  const startSec = Number(arg('--start-offset') ?? 0);
  // Clear the screen during instrumental breaks (default 12s in --from-asr; off
  // otherwise). Overridable with --max-cue <sec>.
  const maxCueSec = Number(arg('--max-cue') ?? (has('--from-asr') ? 12 : 0)) || undefined;
  const token = await mintWriteToken();

  // --from-asr: borrow the audio-aligned timestamps from the video's auto-caption
  // track and snap the authored lyrics onto them (accurate timing, incl. the
  // instrumental gaps). Otherwise distribute evenly (optionally past an intro).
  let cues: CaptionCue[];
  if (has('--from-asr')) {
    const asr = await fetchAsrCues(token, videoId);
    if (asr.length === 0) throw new Error('No ASR track to align to (the video has no auto-captions yet).');
    const rawStarts = alignLyricLineStarts(lyricLines, asr);
    const matched = rawStarts.filter((v) => typeof v === 'number').length;
    const starts = fillStarts(rawStarts, totalSec, startSec);

    // --group: caption each blank-line block (couplet/stanza) as one multi-line
    // cue, timed to its first line — avoids fast short lines flashing one by one.
    // Otherwise one cue per line.
    let entries: { text: string; startSeconds: number }[];
    if (has('--group')) {
      entries = [];
      let fi = 0;
      for (const b of blocks) {
        entries.push({ text: b.join('\n'), startSeconds: starts[fi] });
        fi += b.length;
      }
    } else {
      entries = lyricLines.map((t, i) => ({ text: t, startSeconds: starts[i] }));
    }

    const synced = Lyrics.fromObject({ sections: [{ kind: 'other', lines: entries }] });
    cues = lyricsToCues(synced, { totalSec, maxCueSec });
    console.log(`🎬 ${label} → ${videoId}`);
    console.log(
      `   ${cues.length} cues${has('--group') ? ` (grouped from ${blocks.length} blocks)` : ''} · aligned to ASR (${matched}/${lyricLines.length} lines matched)`
    );
  } else {
    cues = lyricsToCues(lyrics, { totalSec, startSec, maxCueSec });
    console.log(`🎬 ${label} → ${videoId}`);
    console.log(`   ${cues.length} cues · ${useVtt ? 'WebVTT' : 'SRT'} · lang=${language}${isDraft ? ' · draft' : ''}`);
    if (!lyrics.isTimeSynced()) console.log(`   (no timestamps — evenly distributed across ${totalSec}s)`);
  }
  if (cues.length === 0) throw new Error('Lyrics produced no caption cues.');
  const caption = useVtt ? toWebVTT(cues) : toSRT(cues);

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
