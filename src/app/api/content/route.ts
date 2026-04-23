/**
 * Content API Routes
 *
 * CRUD operations for content management
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { requireAuth, unauthorizedResponse } from '@/lib/auth-helper';
import {
  updateContentSchema,
  deleteContentSchema,
  validateRequestBody,
  formatZodErrors,
} from '@/lib/validations/content';

const contentRepo = new ContentRepository();
const categoryRepo = new CategoryRepository();
const tagRepo = new TagRepository();

/**
 * DELETE /api/content?id=xxx
 * Delete content by ID
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

    const validation = validateRequestBody(deleteContentSchema, { id });

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          errors: formatZodErrors(validation.errors),
        },
        { status: 400 }
      );
    }

    // Get content to update category/tag counts
    const content = await contentRepo.findById(validation.data.id);
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      );
    }

    // Delete content (this also deletes relationships now)
    await contentRepo.delete(validation.data.id);

    // Decrement category counts
    for (const categoryId of content.categoryIds) {
      await categoryRepo.decrementContentCount(categoryId);
    }

    // Decrement tag counts
    for (const tagId of content.tagIds) {
      await tagRepo.decrementContentCount(tagId);
    }

    return NextResponse.json({
      success: true,
      message: 'Content deleted successfully',
    });
  } catch (error) {
    console.error('[API:DELETE_CONTENT] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete content' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/content
 * Update existing content
 *
 * @requires Authentication
 */
export async function PUT(request: NextRequest) {
  try {
    // Verify authentication
    try {
      await requireAuth(request);
    } catch {
      return unauthorizedResponse();
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = validateRequestBody(updateContentSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          errors: formatZodErrors(validation.errors),
        },
        { status: 400 }
      );
    }

    const { id, ...updateData } = validation.data;

    // Get existing content
    const existingContent = await contentRepo.findById(id);
    if (!existingContent) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      );
    }

    // Update content using domain entity method
    existingContent.update(updateData);
    await contentRepo.save(existingContent);

    return NextResponse.json({
      success: true,
      data: existingContent.toObject(),
      message: 'Content updated successfully',
    });
  } catch (error) {
    console.error('[API:UPDATE_CONTENT] Error:', error);

    // Don't expose internal error details to client
    const errorMessage = error instanceof Error && error.message.includes('required')
      ? error.message
      : 'Failed to update content';

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
