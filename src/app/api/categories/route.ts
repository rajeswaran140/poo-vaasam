/**
 * Categories API Routes
 *
 * CRUD operations for category management
 */

import { NextRequest, NextResponse } from 'next/server';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { requireAuth, unauthorizedResponse } from '@/lib/auth-helper';
import { z } from 'zod';

const categoryRepo = new CategoryRepository();

// Validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1).max(100).trim(),
  slug: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
});

const deleteCategorySchema = z.object({
  id: z.string().min(1),
});

/**
 * GET /api/categories
 * List all categories
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

    const categories = await categoryRepo.findAll();

    return NextResponse.json({
      success: true,
      data: categories,
      message: 'Categories retrieved successfully',
    });
  } catch (error) {
    console.error('[API:GET_CATEGORIES] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/categories
 * Create new category
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
    const validation = createCategorySchema.safeParse(body);

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

    // Create category (slug will be auto-generated if not provided)
    const category = await categoryRepo.create({
      name: validation.data.name,
      ...(validation.data.slug && { slug: validation.data.slug }),
      description: validation.data.description || '',
    } as Omit<import('@/types/content').Category, 'id' | 'contentCount' | 'createdAt'>);

    return NextResponse.json(
      {
        success: true,
        data: category,
        message: 'Category created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API:CREATE_CATEGORY] Error:', error);

    const errorMessage = error instanceof Error && error.message.includes('already exists')
      ? error.message
      : 'Failed to create category';

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/categories?id=xxx
 * Delete category by ID
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

    const validation = deleteCategorySchema.safeParse({ id });

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

    // Check if category exists
    const category = await categoryRepo.findById(validation.data.id);
    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Category not found' },
        { status: 404 }
      );
    }

    // Delete category
    await categoryRepo.delete(validation.data.id);

    return NextResponse.json({
      success: true,
      message: 'Category deleted successfully',
    });
  } catch (error) {
    console.error('[API:DELETE_CATEGORY] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete category' },
      { status: 500 }
    );
  }
}
