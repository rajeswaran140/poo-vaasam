/**
 * Related Content API
 *
 * Fetches related content based on type
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as ContentType;
    const excludeId = searchParams.get('exclude');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!type || !Object.values(ContentType).includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid content type' },
        { status: 400 }
      );
    }

    const contentRepo = new ContentRepository();

    // Fetch content of the same type
    const result = await contentRepo.findByType(type, {
      status: ContentStatus.PUBLISHED,
      limit: limit + 1, // Fetch one extra to account for exclusion
    });

    // Filter out the current content and limit results
    const items = result.items
      .filter(item => item.id !== excludeId)
      .slice(0, limit)
      .map(item => ({
        id: item.id,
        title: item.title,
        type: item.type,
        author: item.author,
        viewCount: item.viewCount,
      }));

    return NextResponse.json({
      success: true,
      items,
      total: items.length,
    });
  } catch (error) {
    console.error('[API:RELATED_CONTENT] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch related content' },
      { status: 500 }
    );
  }
}