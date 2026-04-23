/**
 * API Route: Text-to-Speech Synthesis
 * POST /api/tts/synthesize
 */

import { NextRequest, NextResponse } from 'next/server';
import { generatePoemAudio, estimateAudioDuration } from '@/services/ai/google-tts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice = 'female' } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required and must be a string' },
        { status: 400 }
      );
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { error: 'Text too long. Maximum 5000 characters.' },
        { status: 400 }
      );
    }

    // Check if Google TTS is configured
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_TTS_CREDENTIALS_BASE64) {
      console.error('Google TTS credentials not found in environment variables');
      return NextResponse.json(
        { error: 'Google TTS not configured. Please set GOOGLE_TTS_CREDENTIALS_BASE64 environment variable.' },
        { status: 503 }
      );
    }

    // Generate audio
    const audioBuffer = await generatePoemAudio(text, voice);
    const duration = estimateAudioDuration(text, 0.85);

    // Return audio as MP3
    return new NextResponse(audioBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'X-Audio-Duration': duration.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate audio';
    return NextResponse.json(
      {
        error: 'Failed to generate audio',
        details: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
