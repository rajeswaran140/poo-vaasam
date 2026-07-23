/**
 * API Route: Poetry Guide Chat with Claude AI
 * POST /api/ai/chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateChatResponse } from '@/services/ai/claude';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';

// Unauthenticated + spends an Anthropic call per request — cap per IP.
const limiter = new SharedRateLimiter({ bucket: 'ai-chat', windowMs: 60_000, max: 20 });

// This route is PUBLIC and unauthenticated, so the request body is bounded
// before it reaches the LLM: a capped number of messages, each capped in size.
// Without this an attacker could send a multi-MB history to amplify token cost.
const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
  poemId: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    const body = await request.json().catch(() => null);
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid chat request' },
        { status: 400 }
      );
    }
    const { messages, poemId } = parsed.data;

    // Check if Anthropic API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Anthropic API key not configured' },
        { status: 503 }
      );
    }

    // Fetch poem context if poemId is provided
    let poemContext;
    if (poemId) {
      try {
        const repo = new ContentRepository();
        const content = await repo.findById(poemId);
        if (content) {
          const poem = content.toObject();
          poemContext = {
            title: poem.title,
            author: poem.author,
            body: poem.body,
            description: poem.description,
            tags: poem.tags,
            categories: poem.categories,
          };
        }
      } catch (error) {
        console.error('Error fetching poem context:', error);
        // Continue without context
      }
    }

    // Generate response
    const response = await generateChatResponse(messages, poemContext);

    return NextResponse.json({
      message: response,
      poemContext: poemContext ? { title: poemContext.title, author: poemContext.author } : null,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Failed to generate chat response' },
      { status: 500 }
    );
  }
}
