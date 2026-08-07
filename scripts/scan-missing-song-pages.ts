/**
 * scan-missing-song-pages — which channel songs have no on-site /content page.
 *
 *   npx tsx scripts/scan-missing-song-pages.ts [--json]
 *
 * READ-ONLY. This is the same diff the admin route
 * `/api/admin/content/sync-youtube-songs` runs in `dryRun` mode, callable from
 * a shell so the gap can be measured without an admin session. It creates
 * nothing — neither content records nor YouTube writes.
 *
 * WHY IT MATTERS. The channel's reach is rented: 49% of views come from
 * suggested-video allocation that YouTube can withdraw at any time, while
 * Google Search sent 41 views in 65 days. Every song without a page is a song
 * that cannot be found anywhere Raj owns. Measured 2026-08-07: the sitemap
 * carried 19 song pages against 62 long-form uploads.
 *
 * ⚠️ THE DIFF IS DELIBERATELY OVER-BROAD. It counts a video as covered if ANY
 * content record of ANY type references it, not just SONGS — because Raj files
 * some songs under POEM. A duplicate page is worse than a missing one: two
 * pages for one video split the inbound links and neither is obviously wrong.
 * See the note in the sync route.
 */
import { ContentRepository } from '../src/infrastructure/database/ContentRepository';
import { ContentType } from '../src/types/content';
import { fetchChannelVideos } from '../src/lib/youtube-feed';
import { getYouTubeId } from '../src/lib/utils/youtube';
import { SITE } from '../src/config/site';
import { missingSongVideos } from '../src/lib/youtube-song-sync';

const CHANNEL_LIMIT = 200;

async function existingVideoIds(repo: ContentRepository): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  for (const type of Object.values(ContentType)) {
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await repo.findByType(type, { limit: 100, lastEvaluatedKey: cursor });
      for (const c of page.items) {
        const vid = c.youtubeVideoId || getYouTubeId(c.videoUrl);
        if (vid && !seen.has(vid)) seen.set(vid, type);
      }
      cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor);
  }
  return seen;
}

async function main() {
  const json = process.argv.includes('--json');
  const repo = new ContentRepository();

  const [channelVideos, existing] = await Promise.all([
    fetchChannelVideos(SITE.youtube.channelId, CHANNEL_LIMIT),
    existingVideoIds(repo),
  ]);
  const missing = missingSongVideos(channelVideos, existing.keys());

  if (json) {
    console.log(JSON.stringify({ channelVideos: channelVideos.length, covered: existing.size, missing }, null, 2));
    return;
  }

  const byType = [...existing.values()].reduce<Record<string, number>>(
    (acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});

  console.log(`channel videos fetched : ${channelVideos.length}`);
  console.log(`videos already covered : ${existing.size}  ${JSON.stringify(byType)}`);
  console.log(`long-form songs MISSING a page : ${missing.length}\n`);
  missing.forEach((m, i) => console.log(`${String(i + 1).padStart(3)}. ${m.id}  ${m.title}`));
  console.log(`\nvideoIds for the create step:\n${JSON.stringify(missing.map((m) => m.id))}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
