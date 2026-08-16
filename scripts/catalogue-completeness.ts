/**
 * catalogue-completeness — does tamilagaval.com actually show the catalogue?
 *
 *   npx tsx scripts/catalogue-completeness.ts           # human report
 *   npx tsx scripts/catalogue-completeness.ts --json    # for a cron to parse
 *
 * ⚠️ WHY. On 2026-08-16 `/songs` served 16 of 55 published songs and had done
 * for weeks. Every daily cron watches YouTube; none watched the WEBSITE. The
 * songs were ingested, PUBLISHED, and silently discarded by the public
 * projection. A YouTube-vs-database check would have reported a clean bill of
 * health throughout — so this compares THREE views of the catalogue:
 *
 *   channel (YouTube)  →  stored (DynamoDB)  →  visible (what /songs emits)
 *
 * The second arrow is the one nothing was watching.
 *
 * READ-ONLY. Reads the YouTube Data API, DynamoDB and the SongCatalog
 * projection. Writes nothing, anywhere. Exit code 1 ONLY for the visibility
 * gap — an unsynced song is a normal, Raj-driven state and must never page
 * anyone, because an alert that cries wolf is how the real fault survived.
 *
 * Quota: ~6 units (2× playlistItems, ~4× videos.list). Negligible against the
 * 10,000/day shared with the reporting crons.
 */
import { SongCatalog } from '../src/application/use-cases/SongCatalog';
import { ContentRepository } from '../src/infrastructure/database/ContentRepository';
import { ContentType } from '../src/types/content';
import { getYouTubeId } from '../src/lib/utils/youtube';
import { partitionShorts } from '../src/lib/youtube-shorts';
import { SITE } from '../src/config/site';
import {
  assessCatalogue,
  summariseCatalogue,
  type ChannelSong,
  type StoredSong,
} from '../src/lib/catalogue-completeness';

const API = 'https://www.googleapis.com/youtube/v3';

/** Every long-form upload with its lifetime views. Shorts are not songs. */
async function fetchChannelSongs(key: string): Promise<ChannelSong[]> {
  const channelId = SITE.youtube.channelUrl.split('/channel/')[1];
  if (!channelId) throw new Error(`no channel id in SITE.youtube.channelUrl: ${SITE.youtube.channelUrl}`);
  const uploads = `UU${channelId.slice(2)}`;

  const ids: Array<{ id: string; title: string }> = [];
  let pageToken = '';
  do {
    const res = await fetch(
      `${API}/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}&key=${key}` +
        (pageToken ? `&pageToken=${pageToken}` : '')
    );
    if (!res.ok) throw new Error(`playlistItems: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      items?: Array<{ snippet?: { title?: string; resourceId?: { videoId?: string } } }>;
      nextPageToken?: string;
    };
    for (const it of body.items ?? []) {
      const id = it.snippet?.resourceId?.videoId;
      if (id) ids.push({ id, title: it.snippet?.title ?? '' });
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);

  // duration + views in one call — videos.list costs 1 unit per request no
  // matter how many parts are requested, so asking for both is free.
  const out: Array<ChannelSong & { duration?: string }> = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await fetch(
      `${API}/videos?part=contentDetails,statistics&id=${batch.map((b) => b.id).join(',')}&key=${key}`
    );
    if (!res.ok) throw new Error(`videos.list: ${res.status}`);
    const body = (await res.json()) as {
      items?: Array<{ id?: string; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }>;
    };
    const byId = new Map((body.items ?? []).map((v) => [v.id ?? '', v]));
    for (const b of batch) {
      const v = byId.get(b.id);
      out.push({
        videoId: b.id,
        title: b.title,
        views: Number(v?.statistics?.viewCount ?? 0),
        duration: v?.contentDetails?.duration,
      });
    }
  }

  return partitionShorts(out).videos.map(({ videoId, title, views }) => ({ videoId, title, views }));
}

async function main() {
  const json = process.argv.includes('--json');
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is required');

  const channel = await fetchChannelSongs(key);

  // EVERY song record, regardless of status — assessCatalogue decides what
  // "published" means, so a status filter here would hide draft/published drift.
  const repo = new ContentRepository();
  const stored: StoredSong[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await repo.findByType(ContentType.SONGS, { limit: 100, lastEvaluatedKey: cursor });
    for (const c of page.items) {
      stored.push({
        id: c.id,
        title: c.title,
        youtubeVideoId: c.youtubeVideoId || getYouTubeId(c.videoUrl) || '',
        status: String(c.status ?? ''),
      });
    }
    cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);

  // ⚠️ The SAME projection the public pages run, not a re-derivation of its
  // rules — re-implementing them here would reproduce any bug rather than
  // detect it. `dropped` is the projection's own account of what it discarded.
  const catalog = new SongCatalog(repo);
  const { songs: visible, dropped } = await catalog.listPublishedDetailed(500);

  const report = assessCatalogue(channel, stored, visible);

  if (json) {
    console.log(JSON.stringify({ ...report, droppedByProjection: dropped }, null, 2));
  } else {
    console.log(`\n${summariseCatalogue(report)}\n`);
    console.log(`  on the channel   : ${report.channelSongs} long-form songs`);
    console.log(`  stored PUBLISHED : ${report.storedPublished}`);
    console.log(`  publicly visible : ${report.publiclyVisible}\n`);

    if (report.visibilityGap.length) {
      console.log('--- ⚠️ PUBLISHED BUT INVISIBLE (a code fault — syncing will NOT fix this) ---');
      for (const g of report.visibilityGap) console.log(`  ${g.id}  ${g.title.slice(0, 56)}`);
      console.log('  dropped by the projection:');
      for (const d of dropped) console.log(`    ${d.id}  ${d.title.slice(0, 52)}`);
      console.log();
    }

    if (report.ingestionGap.length) {
      console.log(
        `--- not yet on the site (${report.ingestionGapViews.toLocaleString()} views, ` +
          `${(report.ingestionGapShare * 100).toFixed(1)}% of the catalogue) ---`
      );
      for (const g of report.ingestionGap) {
        const flag = g.likelyRevisionOf ? '  ⚠️ REVISION?' : '';
        console.log(`  ${String(g.views ?? 0).padStart(7)}  ${g.videoId}  ${g.title.slice(0, 48)}${flag}`);
        if (g.likelyRevisionOf) {
          console.log(`           ↳ same title as ${g.likelyRevisionOf.id} — syncing would DUPLICATE it`);
        }
      }
      console.log('\n  → /admin/content → "Sync songs from YouTube" (Raj drives the tick-list)');
    }
    console.log();
  }

  // Only the visibility gap is an alert. See the header.
  if (!report.healthy) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
