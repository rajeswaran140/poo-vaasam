/**
 * harvest-caption-lyrics — recover Raj's own lyrics from the caption tracks
 * already uploaded to YouTube, and write them to disk as data.
 *
 *   npx tsx scripts/harvest-caption-lyrics.ts [--limit 20] [--out ./lyrics-harvest] [--apply]
 *
 * Default is a DRY RUN: it lists which songs have a human-uploaded track and
 * what the harvest would cost, and writes nothing. `--apply` downloads.
 *
 * Only `standard` (human-uploaded) tracks are read. ASR is never harvested —
 * a machine transcription of sung Tamil would look like lyrics and poison the
 * corpus that later prosody / Song-DNA work depends on.
 *
 * ⚠️ QUOTA. captions.list is 50 units and captions.download is 200, so a full
 * catalogue pass is ~5,800 against a 10,000/day budget shared with the daily
 * reporting crons. The plan is checked before anything runs; use --limit to
 * split across days. Misreading captions.list as 1 unit burned a whole day on
 * 2026-07-29.
 *
 * Writes three files per song so the data is usable by hand and by machine:
 *   <song> [<id>].txt   — the lyrics as a document, one cue per line
 *   <song> [<id>].srt   — the original track, verbatim
 *   <song> [<id>].json  — cues with timings, for alignment work
 *
 * Credentials: YOUTUBE_OAUTH_CLIENT_ID / _SECRET / YOUTUBE_DATA_REFRESH_TOKEN
 * (captions.download needs force-ssl; the read-only Analytics token cannot do
 * it). Never written to disk.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSrt,
  selectTrack,
  planHarvest,
  looksLikeLyrics,
  harvestFilename,
  type CaptionTrack,
} from '@/lib/caption-harvest';

const UPLOADS = 'UUZCuphXleq-mXVYgvqh-OlQ';
const SHORT_MAX_SECONDS = 180;

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const LIMIT = Number(flag('limit', '100'));
const OUT = flag('out', './lyrics-harvest')!;

async function accessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!,
    client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.YOUTUBE_DATA_REFRESH_TOKEN!,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('could not mint a write token (force-ssl scope required)');
  return j.access_token;
}

const KEY = process.env.YOUTUBE_API_KEY!;
const api = async (url: string, token?: string) => {
  const r = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
};

function isoSeconds(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '');
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function main() {
  const token = await accessToken();

  // --- catalogue ---
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const d: any = await api(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${UPLOADS}&maxResults=50&key=${KEY}` +
        (pageToken ? `&pageToken=${pageToken}` : '')
    );
    ids.push(...d.items.map((i: any) => i.contentDetails.videoId));
    pageToken = d.nextPageToken;
    pages++;
  } while (pageToken);

  const meta = new Map<string, { title: string; seconds: number }>();
  for (let i = 0; i < ids.length; i += 50) {
    const d: any = await api(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(',')}&key=${KEY}`
    );
    for (const it of d.items) {
      meta.set(it.id, {
        title: it.snippet.title,
        seconds: isoSeconds(it.contentDetails.duration),
      });
    }
  }

  // Long-form only: a Short's caption track is a fragment of a song, not a song.
  const songs = ids.filter((v) => (meta.get(v)?.seconds ?? 0) > SHORT_MAX_SECONDS).slice(0, LIMIT);

  const plan = planHarvest(songs.length, pages);
  console.log(`catalogue: ${ids.length} uploads, ${songs.length} long-form songs in scope`);
  console.log(`quota: worst case ${plan.maxUnits} units — ${plan.affordable ? 'OK' : 'TOO MUCH'}`);
  if (!plan.affordable) {
    console.error(`\n✗ ${plan.reason}`);
    process.exit(1);
  }
  if (!APPLY) console.log('DRY RUN — pass --apply to download. Nothing will be written.\n');
  else mkdirSync(OUT, { recursive: true });

  let withTrack = 0;
  let harvested = 0;
  let asrOnly = 0;
  let none = 0;
  let rejected = 0;

  for (const videoId of songs) {
    const info = meta.get(videoId)!;
    const label = `${info.title.split('|')[0].trim().slice(0, 38)}`;
    let tracks: CaptionTrack[] = [];
    try {
      const d: any = await api(
        `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`,
        token
      );
      tracks = (d.items ?? []).map((i: any) => ({
        id: i.id,
        trackKind: i.snippet.trackKind,
        language: i.snippet.language,
        name: i.snippet.name,
      }));
    } catch (err) {
      console.log(`  ✗ ${videoId} ${label} — captions.list failed: ${(err as Error).message}`);
      continue;
    }

    const track = selectTrack(tracks);
    if (!track) {
      if (tracks.length) {
        asrOnly++;
        console.log(`  · ${videoId} ${label} — ASR only, skipped`);
      } else {
        none++;
        console.log(`  · ${videoId} ${label} — no tracks`);
      }
      continue;
    }
    withTrack++;

    if (!APPLY) {
      console.log(`  ✓ ${videoId} ${label} — would download ${track.trackKind}/${track.language}`);
      continue;
    }

    try {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/captions/${track.id}?tfmt=srt`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
      const srt = await r.text();
      const lyrics = parseSrt(srt);

      // Shape check only — never a judgement on the words themselves.
      if (!looksLikeLyrics(lyrics)) {
        rejected++;
        console.log(`  ✗ ${videoId} ${label} — track parsed to ${lyrics.lineCount} lines, too thin to trust`);
        continue;
      }

      const stem = join(OUT, harvestFilename(videoId, info.title));
      writeFileSync(`${stem}.srt`, srt, 'utf8');
      writeFileSync(`${stem}.txt`, `${lyrics.text}\n`, 'utf8');
      writeFileSync(
        `${stem}.json`,
        `${JSON.stringify({ videoId, title: info.title, durationSec: info.seconds, ...lyrics }, null, 2)}\n`,
        'utf8'
      );
      harvested++;
      console.log(`  ✓ ${videoId} ${label} — ${lyrics.lineCount} lines`);
    } catch (err) {
      console.log(`  ✗ ${videoId} ${label} — download failed: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n${APPLY ? 'harvested' : 'would harvest'} ${APPLY ? harvested : withTrack} of ${songs.length} songs` +
      ` · ASR-only ${asrOnly} · no tracks ${none}${rejected ? ` · rejected ${rejected}` : ''}`
  );
  console.log(
    `${songs.length - withTrack} songs have no recoverable lyrics on YouTube — those are only in Raj's own files.`
  );
  if (APPLY) console.log(`written to ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
