/**
 * Admin Content API Routes
 *
 * List and manage content for admin panel
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { ContentType, ContentStatus, WORKFLOW_STATES } from '@/types/content';
import { DomainError } from '@/application/errors';
import { z } from 'zod';

const contentRepo = new ContentRepository();
const categoryRepo = new CategoryRepository();
const tagRepo = new TagRepository();

const createContentUseCase = new CreateContentUseCase(
  contentRepo,
  categoryRepo,
  tagRepo
);

// Treat empty-string URL fields (sent by the admin form when left blank) as absent
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

// Validation schemas
const createContentSchema = z.object({
  type: z.nativeEnum(ContentType),
  title: z.string().min(1).max(200).trim(),
  body: z.string().min(1).max(50000).trim(),
  description: z.string().max(500).trim().optional(),
  author: z.string().min(1).max(100).trim(),
  status: z.nativeEnum(ContentStatus).default(ContentStatus.DRAFT),
  categoryIds: z.array(z.string()).max(10).default([]),
  tagIds: z.array(z.string()).max(20).default([]),
  featuredImage: z.preprocess(emptyToUndefined, z.string().url().optional()),
  audioUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  videoUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  previewVideoUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // 11-char YouTube video ID — alphanumeric + - and _ (the URL-safe base64
  // alphabet YouTube uses for video IDs).
  youtubeVideoId: z.preprocess(emptyToUndefined, z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Must be an 11-character YouTube video ID').optional()),
  wavUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  stemsUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  midiUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  thumbnailUrl: z.preprocess(emptyToUndefined, z.string().url().optional()),
  workflowState: z.preprocess(emptyToUndefined, z.enum(WORKFLOW_STATES as unknown as [string, ...string[]]).optional()),
  // The admin form's number input emits a string ("180"); coerce so a typed
  // duration validates instead of failing the whole create with a 400.
  audioDuration: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  seoTitle: z.preprocess(emptyToUndefined, z.string().max(60).optional()),
  seoDescription: z.preprocess(emptyToUndefined, z.string().max(160).optional()),
});

/**
 * GET /api/admin/content
 * List content with filters for admin panel
 *
 * Query params:
 * - type: ContentType (optional)
 * - status: ContentStatus (optional)
 * - limit: number (default 50)
 * - lastEvaluatedKey: string (for pagination)
 *
 * @requires Authentication
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    try {
      await requireAdmin(request);
    } catch (authError) {
      return authErrorResponse(authError);
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as ContentType | null;
    const status = searchParams.get('status') as ContentStatus | null;
    const limit = parseInt(searchParams.get('limit') || '50');
    const lastEvaluatedKeyParam = searchParams.get('lastEvaluatedKey');

    // Parse lastEvaluatedKey if provided
    let lastEvaluatedKey;
    if (lastEvaluatedKeyParam) {
      try {
        lastEvaluatedKey = JSON.parse(lastEvaluatedKeyParam);
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid lastEvaluatedKey format' },
          { status: 400 }
        );
      }
    }

    let result;

    // Filter by type
    if (type && Object.values(ContentType).includes(type)) {
      result = await contentRepo.findByType(type, {
        limit,
        lastEvaluatedKey,
        status: status || undefined,
      });
    }
    // Filter by status only
    else if (status && Object.values(ContentStatus).includes(status)) {
      result = await contentRepo.findAll({
        limit,
        lastEvaluatedKey,
        status,
      });
    }
    // No filters - get all
    else {
      // Get both published and draft, with drafts first
      const published = await contentRepo.findAll({
        limit: Math.ceil(limit / 2),
        status: ContentStatus.PUBLISHED,
      });
      const draft = await contentRepo.findAll({
        limit: Math.ceil(limit / 2),
        status: ContentStatus.DRAFT,
      });

      result = {
        items: [...draft.items, ...published.items],
        total: draft.total + published.total,
        limit,
        hasMore: draft.hasMore || published.hasMore,
        lastEvaluatedKey: published.lastEvaluatedKey,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        items: result.items.map((item) => item.toObject()),
        total: result.total,
        limit: result.limit,
        hasMore: result.hasMore,
        lastEvaluatedKey: result.lastEvaluatedKey,
      },
      message: 'Content retrieved successfully',
    });
  } catch (error) {
    console.error('[API:ADMIN_GET_CONTENT] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch content' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/content
 * Create new content
 *
 * @requires Authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    try {
      await requireAdmin(request);
    } catch (authError) {
      return authErrorResponse(authError);
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = createContentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // Create content using use case
    const content = await createContentUseCase.execute({
      type: validation.data.type,
      title: validation.data.title,
      body: validation.data.body,
      description: validation.data.description || '',
      author: validation.data.author,
      status: validation.data.status,
      categoryIds: validation.data.categoryIds,
      tagIds: validation.data.tagIds,
      featuredImage: validation.data.featuredImage,
      audioUrl: validation.data.audioUrl,
      videoUrl: validation.data.videoUrl,
      previewVideoUrl: validation.data.previewVideoUrl,
      youtubeVideoId: validation.data.youtubeVideoId,
      wavUrl: validation.data.wavUrl,
      stemsUrl: validation.data.stemsUrl,
      midiUrl: validation.data.midiUrl,
      thumbnailUrl: validation.data.thumbnailUrl,
      workflowState: validation.data.workflowState as never,
      audioDuration: validation.data.audioDuration,
      seoTitle: validation.data.seoTitle,
      seoDescription: validation.data.seoDescription,
    });

    return NextResponse.json(
      {
        success: true,
        data: content.toObject(),
        message: 'Content created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    // Expected business-rule failures (e.g. "Categories not found") are safe to
    // show and map to 400. Everything else is an internal fault: log the detail
    // server-side and return a generic message so DynamoDB/internal text never
    // leaks to the client.
    if (error instanceof DomainError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    console.error('[API:ADMIN_CREATE_CONTENT] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create content. Please try again.' },
      { status: 500 }
    );
  }
}
