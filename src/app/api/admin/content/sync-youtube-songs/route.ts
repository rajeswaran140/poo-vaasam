/**
 * POST /api/admin/content/sync-youtube-songs
 *
 * "Sync songs from YouTube" — READS the channel and creates on-site song pages
 * for uploads that don't have one yet. Two modes:
 *   { dryRun: true }  (default)         → list the missing long-form songs
 *   { dryRun: false, videoIds: [...] }  → create pages for the approved subset
 *
 * Hard guarantees:
 *  - READ-ONLY on YouTube. It never posts, edits, or deletes anything on the
 *    channel — the only YouTube calls are reads (channel feed + thumbnail HEAD).
 *  - NO S3 per page. `featuredImage` points straight at i.ytimg.com; no object
 *    is written to the media bucket for a synced song.
 *  - NO lyrics. Body is the neutral stub (songStubBody).
 *
 * Admin-gated + Bearer (it mutates in create mode). New pages are baked into the
 * static /songs + /content routes on the NEXT deploy (build-time data).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';
import { fetchChannelVideos } from '@/lib/youtube-feed';
import { getYouTubeId } from '@/lib/utils/youtube';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import { missingSongVideos, songStubBody, ytThumbnailCandidates } from '@/lib/youtube-song-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_AUTHOR = 'இராஜ்';
const CHANNEL_LIMIT = 200;

const schema = z.object({
  dryRun: z.boolean().optional().default(true),
  videoIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).max(100).optional(),
});

/** Every YouTube video id already covered by a SONGS record (any status). */
async function existingSongVideoIds(repo: ContentRepository): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await repo.findByType(ContentType.SONGS, { limit: 100, lastEvaluatedKey: cursor });
    for (const c of page.items) {
      const vid = c.youtubeVideoId || getYouTubeId(c.videoUrl);
      if (vid) ids.add(vid);
    }
    cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);
  return ids;
}

/** Best non-404 YouTube thumbnail (maxres → hq). HEAD only — read-only, no S3. */
async function resolveThumbnail(videoId: string): Promise<string> {
  const [maxres, hq] = ytThumbnailCandidates(videoId);
  try {
    const res = await fetch(maxres, { method: 'HEAD' });
    if (res.ok) return maxres;
  } catch {
    /* fall through to the always-present hqdefault */
  }
  return hq;
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isYouTubeVideosConfigured()) {
    return NextResponse.json({ success: false, error: 'YouTube channel not configured' }, { status: 503 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { dryRun, videoIds } = parsed.data;

  const repo = new ContentRepository();
  // READ-ONLY: channel feed + existing-page diff. No YouTube writes, ever.
  const [channelVideos, existing] = await Promise.all([
    fetchChannelVideos(SITE.youtube.channelId, CHANNEL_LIMIT),
    existingSongVideoIds(repo),
  ]);
  const missing = missingSongVideos(channelVideos, existing);

  if (dryRun) {
    return NextResponse.json({ success: true, dryRun: true, missing });
  }

  // Create mode: only the approved subset, and only ones STILL genuinely missing
  // (re-diffed above, so a page added between scan and create is never dupliated).
  const approved = new Set(videoIds ?? []);
  const toCreate = missing.filter((m) => approved.has(m.id));
  if (toCreate.length === 0) {
    return NextResponse.json({ success: true, dryRun: false, created: [], failed: [], needsRedeploy: false });
  }

  const useCase = new CreateContentUseCase(repo, new CategoryRepository(), new TagRepository());
  const created: Array<{ id: string; videoId: string; title: string }> = [];
  const failed: Array<{ videoId: string; error: string }> = [];

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
        featuredImage, // i.ytimg.com — no S3 object created for this song
      });
      created.push({ id: content.id, videoId: m.id, title: m.title });
    } catch (err) {
      console.error('[sync-youtube-songs] create failed', m.id, err);
      failed.push({ videoId: m.id, error: 'create failed' });
    }
  }

  return NextResponse.json({
    success: true,
    dryRun: false,
    created,
    failed,
    needsRedeploy: created.length > 0,
  });
}
