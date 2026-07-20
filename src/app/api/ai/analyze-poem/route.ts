import { NextRequest, NextResponse } from 'next/server';
import { RateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  analyzePoemEmotion,
  isPoemAnalysisConfigured,
  DEFAULT_POEM_ANALYSIS,
} from '@/services/ai/poem-emotion';

// Unauthenticated + spends an LLM call per request — cap per IP. This route is
// now a FALLBACK: published poems carry a precomputed `emotionAnalysis`, so this
// only fires for un-backfilled or just-edited poems (see the admin analyze
// endpoint + PoemReader).
const limiter = new RateLimiter({ windowMs: 60_000, max: 20 });

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    const { title, body, author } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: 'Title and body are required' },
        { status: 400 }
      );
    }

    // No key configured → serve a usable default (NOT flagged degraded: this is
    // a config state, not a runtime failure).
    if (!isPoemAnalysisConfigured()) {
      console.warn('OpenAI API key not configured, using default analysis');
      return NextResponse.json({ success: true, analysis: DEFAULT_POEM_ANALYSIS });
    }

    try {
      const analysis = await analyzePoemEmotion({ title, body, author });
      return NextResponse.json({ success: true, analysis });
    } catch (error) {
      // Graceful UX fallback: still return a usable analysis, but flag it as
      // `degraded` so callers (and the admin) can tell the AI path actually
      // failed rather than genuinely classifying the poem as "sad".
      logger.error('Poem analysis failed; serving default analysis', error);
      return NextResponse.json({
        success: true,
        degraded: true,
        analysis: DEFAULT_POEM_ANALYSIS,
      });
    }
  } catch (error) {
    logger.error('Poem analysis request failed', error);
    return NextResponse.json({
      success: true,
      degraded: true,
      analysis: DEFAULT_POEM_ANALYSIS,
    });
  }
}
