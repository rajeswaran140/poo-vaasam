/**
 * POST /api/admin/songs/publish — one-call "Publish Song".
 *
 * Creates a PUBLISHED song from an uploaded audio URL + title, and (Phase 1):
 *   - auto-links it to its YouTube upload by title (long-form, not the Short),
 *   - auto-derives audioDuration from the WAV header (or the matched video).
 * Cover art, theme, and the go-live deploy are layered on in later phases.
 *
 * Admin-gated. Runs in the request path (force-dynamic) — it writes DynamoDB +
 * reads S3, both of which work at runtime via the inlined APP_AWS_* creds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';
import { fetchChannelUploadsWithDurations } from '@/lib/youtube-uploads';
import { matchVideoByTitle } from '@/lib/song-video-match';
import { isShort } from '@/lib/youtube-shorts';
import { deriveDurationSeconds } from '@/lib/derive-song-duration';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { SITE } from '@/config/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_AUTHOR = 'இராஜ்';
const placeholderBody = (title: string) => `${title} — ஒலி வடிவப் பாடல். முழு வீடியோ YouTube-ல்.`;

const publishSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  body: z.string().max(50000).trim().optional(),
  author: z.string().max(100).trim().optional(),
  audioUrl: z.url(),
  youtubeVideoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/, 'Must be an 11-character YouTube video ID')
    .optional(),
  audioDuration: z.coerce.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  let input: z.infer<typeof publishSchema>;
  try {
    input = publishSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'Invalid input', details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }

  try {
    const contentRepo = new ContentRepository();

    // Don't publish a title that's already a published song.
    const published = await contentRepo.findByType(ContentType.SONGS, {
      status: ContentStatus.PUBLISHED,
      limit: 300,
    });
    if (published.items.some((c) => c.title.trim() === input.title)) {
      return NextResponse.json(
        { success: false, error: 'A song with this title is already published' },
        { status: 409 }
      );
    }

    // Auto-link to the matching long-form YouTube upload (unless one was given),
    // capturing that video's ISO duration as a fallback for the song length.
    let youtubeVideoId = input.youtubeVideoId;
    let matchedVideoDuration: string | undefined;
    if (!youtubeVideoId) {
      const uploads = (await fetchChannelUploadsWithDurations(SITE.youtube.channelId)).filter(
        (u) => !isShort(u)
      );
      const match = matchVideoByTitle(input.title, uploads);
      if (match) {
        youtubeVideoId = match.id;
        matchedVideoDuration = match.duration;
      }
    }

    const audioDuration =
      input.audioDuration ??
      (await deriveDurationSeconds({
        audioUrl: input.audioUrl,
        matchedVideoDuration,
        readRange: (key, end) => S3Operations.getRange(key, end),
      }));

    const useCase = new CreateContentUseCase(contentRepo, new CategoryRepository(), new TagRepository());
    const content = await useCase.execute({
      type: ContentType.SONGS,
      title: input.title,
      body: input.body || placeholderBody(input.title),
      description: '',
      author: input.author || DEFAULT_AUTHOR,
      status: ContentStatus.PUBLISHED,
      categoryIds: [],
      tagIds: [],
      audioUrl: input.audioUrl,
      ...(youtubeVideoId ? { youtubeVideoId } : {}),
      ...(audioDuration ? { audioDuration } : {}),
    });

    const obj = content.toObject();
    return NextResponse.json(
      {
        success: true,
        data: {
          id: obj.id,
          title: obj.title,
          audioDuration: obj.audioDuration ?? null,
          youtubeVideoId: obj.youtubeVideoId ?? null,
          matched: Boolean(youtubeVideoId && !input.youtubeVideoId),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/admin/songs/publish] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to publish song' }, { status: 502 });
  }
}
