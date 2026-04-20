/**
 * Content API Routes
 *
 * CRUD operations for content management
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';

const contentRepo = new ContentRepository();
const categoryRepo = new CategoryRepository();
const tagRepo = new TagRepository();

/**
 * DELETE /api/content?id=xxx
 * Delete content by ID
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Content ID is required' },
        { status: 400 }
      );
    }

    // Get content to update category/tag counts
    const content = await contentRepo.findById(id);
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      );
    }

    // Delete content
    await contentRepo.delete(id);

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
  } catch (error: any) {
    console.error('Delete error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete content' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/content
 * Update existing content
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Content ID is required' },
        { status: 400 }
      );
    }

    // Get existing content
    const existingContent = await contentRepo.findById(id);
    if (!existingContent) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      );
    }

    // Update content
    existingContent.update(updateData);
    await contentRepo.save(existingContent);

    return NextResponse.json({
      success: true,
      data: existingContent.toObject(),
      message: 'Content updated successfully',
    });
  } catch (error: any) {
    console.error('Update error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update content' },
      { status: 500 }
    );
  }
}
