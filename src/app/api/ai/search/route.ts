/**
 * API Route: Semantic Search
 * POST /api/ai/search
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { generateEmbedding, cosineSimilarity } from '@/services/ai/openai';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, type, limit = 10 } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 503 }
      );
    }

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Fetch content from database
    const repo = new ContentRepository();
    const result = type
      ? await repo.findByType(type, { status: ContentStatus.PUBLISHED, limit: 100 })
      : await repo.findAll({ status: ContentStatus.PUBLISHED, limit: 100 });

    const contentItems = result.items.map(item => item.toObject());

    // Calculate similarities
    // Note: In production, embeddings should be pre-computed and stored
    // This is a simplified version for demonstration
    const results = await Promise.all(
      contentItems.map(async (item: any) => {
        try {
          // In production, get embedding from database
          // For now, generate on-the-fly (slower)
          const text = `${item.title}\n${item.description || ''}\n${item.body.substring(0, 500)}`;
          const embedding = await generateEmbedding(text);
          const similarity = cosineSimilarity(queryEmbedding, embedding);

          return {
            id: item.id,
            title: item.title,
            author: item.author,
            description: item.description,
            type: item.type,
            similarity,
            excerpt: item.body.substring(0, 200) + '...',
          };
        } catch (error) {
          console.error(`Error processing item ${item.id}:`, error);
          return null;
        }
      })
    );

    // Filter out nulls and sort by similarity
    const validResults = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return NextResponse.json({
      query,
      results: validResults,
      count: validResults.length,
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Failed to perform semantic search' },
      { status: 500 }
    );
  }
}
