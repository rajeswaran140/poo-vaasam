/**
 * API Route: Poetry Guide Chat with Claude AI
 * POST /api/ai/chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateChatResponse } from '@/services/ai/claude';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, poemId } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

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
