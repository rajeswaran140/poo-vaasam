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
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';
import { fetchChannelUploadsWithDurations } from '@/lib/youtube-uploads';
import { matchVideoByTitle } from '@/lib/song-video-match';
import { isShort } from '@/lib/youtube-shorts';
import { deriveDurationSeconds, s3KeyFromUrl } from '@/lib/derive-song-duration';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { setSongTheme } from '@/lib/song-theme-write';
import { generateSongCover } from '@/application/use-cases/GenerateSongCover';
import { triggerRelease } from '@/lib/amplify-deploy';
import { SONG_THEMES } from '@/config/song-themes';
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
  theme: z.union([z.enum(SONG_THEMES as unknown as [string, ...string[]]), z.literal('')]).optional(),
  generateCover: z.boolean().optional().default(true),
  deploy: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    // Defense-in-depth CSRF: this route mutates (creates a song, triggers a
    // deploy), so reject cookie-only auth — require an explicit Bearer token.
    requireBearer(request);
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

    // Don't publish a title that's already a published song. Page through the
    // whole published set (case-insensitive) rather than trusting a single
    // bounded page — a fixed cap would silently miss duplicates as the
    // catalogue grows.
    const target = input.title.trim().toLowerCase();
    let cursor: Record<string, unknown> | undefined;
    let isDuplicate = false;
    do {
      const page = await contentRepo.findByType(ContentType.SONGS, {
        status: ContentStatus.PUBLISHED,
        limit: 100,
        lastEvaluatedKey: cursor,
      });
      if (page.items.some((c) => (c.title ?? '').trim().toLowerCase() === target)) {
        isDuplicate = true;
        break;
      }
      cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor);

    if (isDuplicate) {
      return NextResponse.json(
        { success: false, error: 'A song with this title is already published' },
        { status: 409 }
      );
    }

    // Verify the audio object actually exists in storage BEFORE publishing —
    // otherwise a typo'd/not-yet-uploaded key would create a live, playable-
    // looking song whose audio 404s.
    const audioKey = s3KeyFromUrl(input.audioUrl);
    const audioExists = audioKey ? await S3Operations.fileExists(audioKey) : false;
    if (!audioExists) {
      return NextResponse.json(
        { success: false, error: 'Audio file not found in storage — upload it before publishing.' },
        { status: 422 }
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
    const songId = obj.id as string;

    // Post-create steps are BEST-EFFORT: a theme or cover failure must never
    // unpublish a song that was created successfully.
    let appliedTheme: string | undefined;
    if (input.theme) {
      try {
        await setSongTheme(songId, input.theme);
        appliedTheme = input.theme;
      } catch (e) {
        console.error('[publish] theme write failed', e);
      }
    }

    let featuredImage: string | undefined;
    let coverError: string | undefined;
    if (input.generateCover) {
      const cover = await generateSongCover(songId);
      if (cover.ok) featuredImage = cover.featuredImage;
      else coverError = cover.error;
    }

    // Go live: kick off an Amplify RELEASE so the build-time /songs picks it up.
    let deploy: { jobId: string | null } | undefined;
    let deployError: string | undefined;
    if (input.deploy) {
      const appId = process.env.AMPLIFY_APP_ID;
      if (!appId) {
        deployError = 'AMPLIFY_APP_ID not configured';
      } else {
        const d = await triggerRelease(appId, process.env.AMPLIFY_BRANCH || 'master');
        if (d.ok) deploy = { jobId: d.jobId ?? null };
        else deployError = d.error;
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: songId,
          title: obj.title,
          audioDuration: obj.audioDuration ?? null,
          youtubeVideoId: obj.youtubeVideoId ?? null,
          matched: Boolean(youtubeVideoId && !input.youtubeVideoId),
          theme: appliedTheme ?? null,
          featuredImage: featuredImage ?? null,
          ...(coverError ? { coverError } : {}),
          ...(deploy ? { deploy } : {}),
          ...(deployError ? { deployError } : {}),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/admin/songs/publish] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to publish song' }, { status: 502 });
  }
}
