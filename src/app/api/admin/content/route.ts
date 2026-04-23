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
import { requireAuth, unauthorizedResponse } from '@/lib/auth-helper';
import { ContentType, ContentStatus } from '@/types/content';
import { z } from 'zod';

const contentRepo = new ContentRepository();
const categoryRepo = new CategoryRepository();
const tagRepo = new TagRepository();

const createContentUseCase = new CreateContentUseCase(
  contentRepo,
  categoryRepo,
  tagRepo
);

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
  featuredImage: z.string().url().optional(),
  audioUrl: z.string().url().optional(),
  audioDuration: z.number().int().min(0).optional(),
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
    // Verify authentication
    try {
      await requireAuth(request);
    } catch {
      return unauthorizedResponse();
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
    // Verify authentication
    try {
      await requireAuth(request);
    } catch {
      return unauthorizedResponse();
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
      audioDuration: validation.data.audioDuration,
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
    console.error('[API:ADMIN_CREATE_CONTENT] Error:', error);

    const errorMessage = error instanceof Error
      ? error.message
      : 'Failed to create content';

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
