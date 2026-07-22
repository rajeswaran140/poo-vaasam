/**
 * API Route: Semantic Search
 * POST /api/ai/search
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus, ContentType } from '@/types/content';
import { generateEmbedding, cosineSimilarity } from '@/services/ai/openai';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

// Unauthenticated + generates an OpenAI embedding for the query (and up to 100
// items) per request — an amplification vector, so cap per IP.
const limiter = new SharedRateLimiter({ bucket: 'ai-search', windowMs: 60_000, max: 30 });

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const startTime = Date.now();

  try {
    const body = await request.json();
    const { query, type } = body;
    // Clamp the client-supplied limit to a sane range (cost/abuse guard).
    const limitRaw = Number(body.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 10;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate the optional content-type filter against the known enum.
    if (type !== undefined && !Object.values(ContentType).includes(type)) {
      return NextResponse.json(
        { error: 'Invalid content type' },
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

    // Generate query embedding (with caching)
    const queryEmbeddingStart = Date.now();
    const queryEmbedding = await generateEmbedding(query);
    const queryEmbeddingTime = Date.now() - queryEmbeddingStart;

    // Fetch content from database
    const dbStart = Date.now();
    const repo = new ContentRepository();
    const result = type
      ? await repo.findByType(type, { status: ContentStatus.PUBLISHED, limit: 100 })
      : await repo.findAll({ status: ContentStatus.PUBLISHED, limit: 100 });

    const contentItems = result.items.map(item => item.toObject());
    const dbTime = Date.now() - dbStart;

    // Calculate similarities (with caching)
    const embeddingStart = Date.now();
    const results = await Promise.all(
      contentItems.map(async (item: any) => {
        try {
          // Generate embedding with caching for performance
          const text = `${item.title}\n${item.description || ''}\n${item.body.substring(0, 500)}`;
          const embedding = await generateEmbedding(text); // Uses cache automatically
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
          logger.warn('Search: failed to embed an item; skipping it', { itemId: item.id, error: String(error) });
          return null;
        }
      })
    );
    const embeddingTime = Date.now() - embeddingStart;

    // Filter out nulls and sort by similarity
    const validResults = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    const totalTime = Date.now() - startTime;

    logger.debug('Semantic search timings', {
      type: type || 'all',
      queryEmbeddingMs: queryEmbeddingTime,
      databaseMs: dbTime,
      contentEmbeddingsMs: embeddingTime,
      totalMs: totalTime,
      results: validResults.length,
      itemsProcessed: contentItems.length,
    });

    return NextResponse.json({
      query,
      results: validResults,
      count: validResults.length,
      performance: {
        totalMs: totalTime,
        queryEmbeddingMs: queryEmbeddingTime,
        databaseMs: dbTime,
        contentEmbeddingsMs: embeddingTime,
        itemsProcessed: contentItems.length,
      },
    });
  } catch (error) {
    logger.error('Semantic search failed', error);
    return NextResponse.json(
      { error: 'Failed to perform semantic search' },
      { status: 500 }
    );
  }
}
