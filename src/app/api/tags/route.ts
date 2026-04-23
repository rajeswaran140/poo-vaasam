/**
 * Tags API Routes
 *
 * CRUD operations for tag management
 */

import { NextRequest, NextResponse } from 'next/server';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { requireAuth, unauthorizedResponse } from '@/lib/auth-helper';
import { z } from 'zod';

const tagRepo = new TagRepository();

// Validation schemas
const createTagSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  slug: z.string().min(1).max(100).trim().optional(),
});

const deleteTagSchema = z.object({
  id: z.string().min(1),
});

/**
 * GET /api/tags
 * List all tags
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

    const tags = await tagRepo.findAll();

    return NextResponse.json({
      success: true,
      data: tags,
      message: 'Tags retrieved successfully',
    });
  } catch (error) {
    console.error('[API:GET_TAGS] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tags
 * Create new tag
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
    const validation = createTagSchema.safeParse(body);

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

    // Create tag (slug will be auto-generated if not provided)
    const tag = await tagRepo.create({
      name: validation.data.name,
      ...(validation.data.slug && { slug: validation.data.slug }),
    } as Omit<import('@/types/content').Tag, 'id' | 'contentCount' | 'createdAt'>);

    return NextResponse.json(
      {
        success: true,
        data: tag,
        message: 'Tag created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API:CREATE_TAG] Error:', error);

    const errorMessage = error instanceof Error && error.message.includes('already exists')
      ? error.message
      : 'Failed to create tag';

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tags?id=xxx
 * Delete tag by ID
 *
 * @requires Authentication
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verify authentication
    try {
      await requireAuth(request);
    } catch {
      return unauthorizedResponse();
    }

    // Extract and validate query params
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const validation = deleteTagSchema.safeParse({ id });

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

    // Check if tag exists
    const tag = await tagRepo.findById(validation.data.id);
    if (!tag) {
      return NextResponse.json(
        { success: false, error: 'Tag not found' },
        { status: 404 }
      );
    }

    // Delete tag
    await tagRepo.delete(validation.data.id);

    return NextResponse.json({
      success: true,
      message: 'Tag deleted successfully',
    });
  } catch (error) {
    console.error('[API:DELETE_TAG] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete tag' },
      { status: 500 }
    );
  }
}
