/**
 * Publish SONGS content for new audio files in S3, linking each to its YouTube
 * upload so `youtubeVideoId` (and `audioDuration`) are set at creation time.
 *
 * Safe + idempotent: it only creates a song when its audio file already exists
 * in s3://tamil-web-media/audio/poem-music/ AND it isn't published yet. A song
 * whose audio hasn't been uploaded is reported as "waiting" and skipped — so
 * this can be run now and re-run after each upload with no double-creates.
 *
 * Linking: matches the audio's title against the channel's uploads via the Data
 * API (needs YOUTUBE_API_KEY). When the key isn't available locally, a small
 * fallback map covers the 3 songs known to be missing as of 2026-06-07.
 *
 *   Dry run:  AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/publish-new-song-videos.ts
 *   Write:    WRITE=1 AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/publish-new-song-videos.ts
 *
 * After a WRITE, redeploy Amplify — /songs is generated at build time (the SSR
 * runtime has no DynamoDB creds), so new songs only appear after a deploy.
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';
import { iso8601DurationToSeconds, isShort } from '@/lib/youtube-shorts';
import { matchVideoByTitle, normalizeTitle } from '@/lib/song-video-match';
import { SITE } from '@/config/site';

const WRITE = process.env.WRITE === '1';
const BUCKET = 'tamil-web-media';
const PREFIX = 'audio/poem-music/';
// Serve via the media CDN (MEDIA_BASE_URL) so new songs get a CDN audioUrl and
// the S3 bucket can stay private; fall back to the direct S3 URL if unset.
const S3_BASE = (process.env.MEDIA_BASE_URL || `https://${BUCKET}.s3.us-east-1.amazonaws.com`).replace(/\/+$/, '');
const AUDIO = /\.(mp3|wav|m4a|aac|ogg)$/i;
const AUTHOR = 'இராஜ்';

const titleOf = (key: string) => (key.split('/').pop() || '').replace(AUDIO, '').trim();
// Encode each path segment but keep the '/', matching the existing songs' URLs.
const urlOf = (key: string) => `${S3_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
const bodyOf = (t: string) => `${t} — ஒலி வடிவப் பாடல். முழு வீடியோ YouTube-ல்.`;

// Fallback song→video links (used only when the Data API match isn't available,
// e.g. no YOUTUBE_API_KEY locally). Keyed by normalised title.
const KNOWN_LINKS: Record<string, string> = {
  [normalizeTitle('கண்ணோடு நீர் அள்ளி')]: 'DozdKmt0cLY',
  [normalizeTitle('செவ்விழி ஓவியமே')]: 'h1WgaJW9khI',
  [normalizeTitle('பொன்வானம் சாயுதே')]: 'd3puwsvsZdI',
};

interface YtVideo {
  id: string;
  title: string;
  duration?: string;
}

/** Channel uploads (long-form only) with durations, via the Data API. [] without a key. */
async function fetchUploads(channelId: string): Promise<YtVideo[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const uploads = channelId.startsWith('UC') ? `UU${channelId.slice(2)}` : channelId;
  const out: YtVideo[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const url =
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50` +
      `&playlistId=${uploads}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as {
      items?: { snippet?: { title?: string; resourceId?: { videoId?: string } } }[];
      nextPageToken?: string;
    };
    for (const it of json.items ?? []) {
      const id = it.snippet?.resourceId?.videoId;
      if (id) out.push({ id, title: it.snippet?.title ?? '' });
    }
    pageToken = json.nextPageToken ?? '';
    if (!pageToken) break;
  }
  // durations (one batched videos.list call)
  if (out.length) {
    const ids = out.map((v) => v.id).join(',');
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${key}`
    );
    if (res.ok) {
      const json = (await res.json()) as {
        items?: { id?: string; contentDetails?: { duration?: string } }[];
      };
      const byId = new Map((json.items ?? []).map((v) => [v.id, v.contentDetails?.duration]));
      for (const v of out) v.duration = byId.get(v.id) ?? undefined;
    }
  }
  // Songs link to the full video, never the Short of the same song.
  return out.filter((v) => !isShort(v));
}

async function main() {
  const s3 = new S3Client({ region: 'us-east-1' });
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const keys = (listed.Contents ?? []).map((o) => o.Key ?? '').filter((k) => AUDIO.test(k));

  const contentRepo = new ContentRepository();
  const useCase = new CreateContentUseCase(contentRepo, new CategoryRepository(), new TagRepository());
  const existing = await contentRepo.findByType(ContentType.SONGS, {
    limit: 300,
    status: ContentStatus.PUBLISHED,
  });
  const have = new Set(existing.items.map((i) => i.toObject().title));

  const videos = await fetchUploads(SITE.youtube.channelId);
  console.log(
    `mode=${WRITE ? 'WRITE' : 'DRY-RUN'}  s3 audio=${keys.length}  published=${have.size}  yt videos=${videos.length}`
  );

  let created = 0;
  let waiting = 0;
  for (const key of keys) {
    const title = titleOf(key);
    if (have.has(title)) continue; // already a song

    const audioUrl = urlOf(key);
    const match = matchVideoByTitle(title, videos);
    const youtubeVideoId = match?.id ?? KNOWN_LINKS[normalizeTitle(title)];
    const audioDuration = match?.duration ? iso8601DurationToSeconds(match.duration) ?? undefined : undefined;

    console.log(
      `${WRITE ? 'CREATE' : 'PLAN  '}: ${title}  ${
        youtubeVideoId ? `→ yt:${youtubeVideoId}${audioDuration ? ` (${audioDuration}s)` : ''}` : '(no YT link — set later)'
      }`
    );
    if (!WRITE) {
      created++;
      continue;
    }

    const c = await useCase.execute({
      type: ContentType.SONGS,
      title,
      body: bodyOf(title),
      description: '',
      author: AUTHOR,
      status: ContentStatus.PUBLISHED,
      categoryIds: [],
      tagIds: [],
      audioUrl,
      ...(youtubeVideoId ? { youtubeVideoId } : {}),
      ...(audioDuration ? { audioDuration } : {}),
    });
    console.log(`        created id=${c.toObject().id}`);
    created++;
  }

  // Report the songs we expect but whose audio hasn't been uploaded yet.
  const s3Titles = new Set(keys.map(titleOf));
  for (const norm of Object.keys(KNOWN_LINKS)) {
    const present = [...s3Titles].some((t) => normalizeTitle(t) === norm);
    if (!present) waiting++;
  }
  console.log(
    `done — ${WRITE ? `created ${created}` : `${created} to create`}, ${waiting} still waiting on an S3 audio upload.` +
      (WRITE && created ? ' Now redeploy Amplify so /songs picks them up.' : '')
  );
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
