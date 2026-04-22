/**
 * Test API Route for Content
 *
 * API Layer - Test endpoint to verify repositories and use cases
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { GetContentUseCase } from '@/application/use-cases/GetContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';
import { requireAuth, unauthorizedResponse } from '@/lib/auth-helper';

// Initialize repositories
const contentRepo = new ContentRepository();
const categoryRepo = new CategoryRepository();
const tagRepo = new TagRepository();

// Initialize use cases
const createContentUseCase = new CreateContentUseCase(
  contentRepo,
  categoryRepo,
  tagRepo
);

const getContentUseCase = new GetContentUseCase(
  contentRepo,
  categoryRepo,
  tagRepo
);

/**
 * GET /api/test/content
 *
 * Test retrieving content
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
    const id = searchParams.get('id');
    const slug = searchParams.get('slug');
    const action = searchParams.get('action');

    // Test different actions
    switch (action) {
      case 'list':
        // List all published content
        const allContent = await contentRepo.findAll({ limit: 10 });
        return NextResponse.json({
          success: true,
          data: allContent,
          message: 'Successfully retrieved content list',
        });

      case 'by-type':
        // List content by type
        const type = searchParams.get('type') as ContentType;
        const byType = await contentRepo.findByType(type, { limit: 10 });
        return NextResponse.json({
          success: true,
          data: byType,
          message: `Successfully retrieved ${type} content`,
        });

      case 'stats':
        // Get repository stats
        const stats = {
          songs: await contentRepo.countByType(ContentType.SONGS),
          poems: await contentRepo.countByType(ContentType.POEMS),
          lyrics: await contentRepo.countByType(ContentType.LYRICS),
          stories: await contentRepo.countByType(ContentType.STORIES),
          essays: await contentRepo.countByType(ContentType.ESSAYS),
          published: await contentRepo.countByStatus(ContentStatus.PUBLISHED),
          draft: await contentRepo.countByStatus(ContentStatus.DRAFT),
          mostViewed: await contentRepo.getMostViewed(5),
          recentlyPublished: await contentRepo.getRecentlyPublished(5),
        };
        return NextResponse.json({
          success: true,
          data: stats,
          message: 'Successfully retrieved stats',
        });

      case 'categories':
        // List all categories
        const categories = await categoryRepo.findAll();
        return NextResponse.json({
          success: true,
          data: categories,
          message: 'Successfully retrieved categories',
        });

      case 'tags':
        // List all tags
        const tags = await tagRepo.findAll();
        return NextResponse.json({
          success: true,
          data: tags,
          message: 'Successfully retrieved tags',
        });

      default:
        // Get single content by ID or slug
        if (id) {
          const content = await getContentUseCase.execute(id, false);
          if (!content) {
            return NextResponse.json(
              { success: false, error: 'Content not found' },
              { status: 404 }
            );
          }
          return NextResponse.json({
            success: true,
            data: content,
            message: 'Successfully retrieved content',
          });
        }

        if (slug) {
          const content = await getContentUseCase.executeBySlug(slug, false);
          if (!content) {
            return NextResponse.json(
              { success: false, error: 'Content not found' },
              { status: 404 }
            );
          }
          return NextResponse.json({
            success: true,
            data: content,
            message: 'Successfully retrieved content by slug',
          });
        }

        return NextResponse.json({
          success: false,
          error: 'Please provide id, slug, or action parameter',
        }, { status: 400 });
    }
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/test/content
 *
 * Test creating content
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

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'create-content':
        // Create test content
        const content = await createContentUseCase.execute({
          type: body.type || ContentType.SONGS,
          title: body.title || 'பூ வாசம்',
          body: body.body || 'பூ வாசம் வந்து என்னை கவர்ந்ததடி...',
          description: body.description || 'ஒரு அழகான தமிழ் பாடல்',
          author: body.author || 'இளையராஜா',
          status: body.status || ContentStatus.PUBLISHED,
          categoryIds: body.categoryIds || [],
          tagIds: body.tagIds || [],
          audioUrl: body.audioUrl,
          audioDuration: body.audioDuration,
          featuredImage: body.featuredImage,
        });

        return NextResponse.json({
          success: true,
          data: content.toObject(),
          message: 'Successfully created content',
        }, { status: 201 });

      case 'create-category':
        // Create test category
        const category = await categoryRepo.create({
          name: body.name || 'தமிழ் பாடல்கள்',
          slug: body.slug,
          description: body.description || 'தமிழ் பாடல்களின் தொகுப்பு',
        });

        return NextResponse.json({
          success: true,
          data: category,
          message: 'Successfully created category',
        }, { status: 201 });

      case 'create-tag':
        // Create test tag
        const tag = await tagRepo.create({
          name: body.name || 'காதல்',
          slug: body.slug,
        });

        return NextResponse.json({
          success: true,
          data: tag,
          message: 'Successfully created tag',
        }, { status: 201 });

      case 'seed':
        // Seed database with test data
        const seedResults = await seedDatabase();
        return NextResponse.json({
          success: true,
          data: seedResults,
          message: 'Successfully seeded database',
        }, { status: 201 });

      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action. Use: create-content, create-category, create-tag, or seed',
        }, { status: 400 });
    }
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * Helper: Seed database with test data
 */
async function seedDatabase() {
  // Create categories
  const categories = await Promise.all([
    categoryRepo.create({
      name: 'தமிழ் பாடல்கள்',
      slug: 'tamil-songs',
      description: 'தமிழ் திரைப்பட பாடல்கள்',
    }),
    categoryRepo.create({
      name: 'கவிதைகள்',
      slug: 'poems',
      description: 'தமிழ் கவிதைகள்',
    }),
    categoryRepo.create({
      name: 'கதைகள்',
      slug: 'stories',
      description: 'தமிழ் சிறுகதைகள்',
    }),
  ]);

  // Create tags
  const tags = await Promise.all([
    tagRepo.create({ name: 'காதல்', slug: 'love' }),
    tagRepo.create({ name: 'இயற்கை', slug: 'nature' }),
    tagRepo.create({ name: 'வாழ்க்கை', slug: 'life' }),
  ]);

  // Create sample content
  const sampleContent = await createContentUseCase.execute({
    type: ContentType.SONGS,
    title: 'பூ வாசம்',
    body: `பூ வாசம் வந்து என்னை கவர்ந்ததடி
காற்றில் மிதந்து வந்த மலரே
உன் வாசம் என்னை தொடர்ந்ததடி
கண்கள் தொடர்ந்து நடக்கும் வழியே`,
    description: 'ஒரு அழகான தமிழ் காதல் பாடல்',
    author: 'இளையராஜா',
    status: ContentStatus.PUBLISHED,
    categoryIds: [categories[0].id],
    tagIds: [tags[0].id, tags[1].id],
  });

  return {
    categories: categories.length,
    tags: tags.length,
    content: 1,
    sampleContentId: sampleContent.id,
  };
}
