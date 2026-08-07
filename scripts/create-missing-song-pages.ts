/**
 * create-missing-song-pages — create on-site /content pages for channel songs
 * that don't have one.
 *
 *   npx tsx scripts/create-missing-song-pages.ts --ids a,b,c        # dry run
 *   npx tsx scripts/create-missing-song-pages.ts --ids a,b,c --apply
 *
 * Shell-callable twin of `/api/admin/content/sync-youtube-songs` (create mode),
 * for when there's no admin session to hand. Same guarantees as the route:
 *   - READ-ONLY on YouTube. Never posts, edits or deletes on the channel.
 *   - NO S3 objects. `featuredImage` points at i.ytimg.com.
 *   - NO lyrics and NO AI-written copy. Body is `songStubBody` — a neutral
 *     stub. Song-page prose is Raj's own words, added by him afterwards.
 *   - Re-diffs immediately before writing, so a page added between scan and
 *     create is never duplicated.
 *
 * ⚠️ TWO SONGS MUST NEVER BE CREATED BY THIS SCRIPT. It stamps every page
 * `author = இராஜ்`, which is false for:
 *   - dCFlupQYR2M நல்லதோர் வீணை செய்தே — lyrics are Mahakavi Bharathiyar's.
 *   - 0ftkBzL3qJI வாசம் வீசும் பூங்காற்றே — composed by Kapileshwer, sung by
 *     Siyad & Dhanyasri; Raj wrote only the lyrics.
 * Both are hard-blocked below. Author them by hand with the right credits.
 *
 * ⚠️ Pages are build-time data: they do NOT appear on the site until the next
 * Amplify redeploy. This script never triggers one.
 */
import { ContentRepository } from '../src/infrastructure/database/ContentRepository';
import { CategoryRepository } from '../src/infrastructure/database/CategoryRepository';
import { TagRepository } from '../src/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '../src/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '../src/types/content';
import { fetchChannelVideos } from '../src/lib/youtube-feed';
import { getYouTubeId } from '../src/lib/utils/youtube';
import { SITE } from '../src/config/site';
import { missingSongVideos, songStubBody, ytThumbnailCandidates } from '../src/lib/youtube-song-sync';

const DEFAULT_AUTHOR = 'இராஜ்';
const CHANNEL_LIMIT = 200;

/** Songs whose author is NOT Raj alone — creating them here would misattribute. */
const BLOCKED: Record<string, string> = {
  dCFlupQYR2M: 'lyrics are Mahakavi Bharathiyar’s — never credit to Raj',
  '0ftkBzL3qJI': 'composer Kapileshwer, vocals Siyad & Dhanyasri — needs real credits',
};

async function existingVideoIds(repo: ContentRepository): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const type of Object.values(ContentType)) {
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await repo.findByType(type, { limit: 100, lastEvaluatedKey: cursor });
      for (const c of page.items) {
        const vid = c.youtubeVideoId || getYouTubeId(c.videoUrl);
        if (vid) ids.add(vid);
      }
      cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor);
  }
  return ids;
}

async function resolveThumbnail(videoId: string): Promise<string> {
  const [maxres, hq] = ytThumbnailCandidates(videoId);
  try {
    const res = await fetch(maxres, { method: 'HEAD' });
    if (res.ok) return maxres;
  } catch {
    /* hqdefault always exists */
  }
  return hq;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const idsArg = process.argv[process.argv.indexOf('--ids') + 1];
  if (!idsArg || idsArg.startsWith('--')) throw new Error('--ids <comma-separated video ids> is required');
  const requested = idsArg.split(',').map((s) => s.trim()).filter(Boolean);

  const blocked = requested.filter((id) => BLOCKED[id]);
  for (const id of blocked) console.log(`BLOCKED ${id} — ${BLOCKED[id]}`);
  const allowed = new Set(requested.filter((id) => !BLOCKED[id]));

  const repo = new ContentRepository();
  const [channelVideos, existing] = await Promise.all([
    fetchChannelVideos(SITE.youtube.channelId, CHANNEL_LIMIT),
    existingVideoIds(repo),
  ]);
  const toCreate = missingSongVideos(channelVideos, existing).filter((m) => allowed.has(m.id));

  const unknown = [...allowed].filter((id) => !toCreate.some((m) => m.id === id));
  for (const id of unknown) console.log(`SKIP ${id} — already has a page, or is not a long-form channel song`);

  console.log(`\n${apply ? 'CREATING' : 'DRY RUN — would create'} ${toCreate.length} page(s):`);
  toCreate.forEach((m, i) => console.log(`${String(i + 1).padStart(3)}. ${m.id}  ${m.title}`));
  if (!apply) { console.log('\nre-run with --apply to write'); return; }

  const useCase = new CreateContentUseCase(repo, new CategoryRepository(), new TagRepository());
  const created: string[] = []; const failed: Array<[string, string]> = [];
  for (const m of toCreate) {
    try {
      const featuredImage = await resolveThumbnail(m.id);
      const content = await useCase.execute({
        type: ContentType.SONGS,
        title: m.title,
        body: songStubBody(m.title),
        description: '',
        author: DEFAULT_AUTHOR,
        status: ContentStatus.PUBLISHED,
        categoryIds: [],
        tagIds: [],
        videoUrl: m.watchUrl,
        youtubeVideoId: m.id,
        featuredImage,
      });
      created.push(m.id);
      console.log(`  ok   ${m.id} -> ${content.id}`);
    } catch (err) {
      failed.push([m.id, err instanceof Error ? err.message : String(err)]);
      console.error(`  FAIL ${m.id}`, err);
    }
  }
  console.log(`\ncreated ${created.length}, failed ${failed.length}`);
  if (created.length) console.log('⚠️  Pages are build-time data — they appear only after the next Amplify redeploy.');
}

main().catch((err) => { console.error(err); process.exit(1); });
