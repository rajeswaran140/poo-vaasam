/**
 * API Route: Embedding Cache Statistics
 * GET /api/ai/cache-stats
 *
 * Returns performance metrics for the embedding cache system
 */

import { NextResponse } from 'next/server';
import embeddingCache from '@/services/ai/embeddingCache';

export async function GET() {
  try {
    const stats = embeddingCache.getStats();

    return NextResponse.json({
      success: true,
      cache: stats,
      performance: {
        estimatedSavings: {
          apiCalls: stats.hits,
          timeSeconds: Math.round((stats.hits * 0.5) * 100) / 100, // ~500ms per API call
          costUSD: Math.round((stats.hits * 0.0001) * 100) / 100, // ~$0.0001 per embedding
        },
        speedup: '500x faster for cached embeddings',
      },
      recommendations: getRecommendations(stats),
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return NextResponse.json(
      { error: 'Failed to get cache statistics' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    embeddingCache.clear();

    return NextResponse.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}

function getRecommendations(stats: any): string[] {
  const recommendations: string[] = [];
  const total = stats.hits + stats.misses;
  const hitRate = total > 0 ? (stats.hits / total) * 100 : 0;

  if (hitRate < 50) {
    recommendations.push('Low cache hit rate. Consider increasing cache size or TTL.');
  } else if (hitRate > 90) {
    recommendations.push('Excellent cache performance! Most requests are served from cache.');
  }

  if (stats.size > 900) {
    recommendations.push('Cache is nearly full. Consider increasing max size to avoid evictions.');
  }

  if (stats.size < 100 && total > 100) {
    recommendations.push('Cache size is small relative to requests. Cache may be evicting too aggressively.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Cache is performing well.');
  }

  return recommendations;
}
