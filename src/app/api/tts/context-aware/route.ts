/**
 * Context-Aware TTS API Route
 * Generates emotion-aware Tamil speech based on poem analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import { synthesizeTamilSpeech, TAMIL_VOICES } from '@/services/ai/google-tts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, emotion, mood, voice = 'female' } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { error: 'Text too long. Maximum 5000 characters.' },
        { status: 400 }
      );
    }

    // Emotion-based TTS parameters
    const emotionConfig = getEmotionBasedTTSConfig(emotion, mood);

    // Select voice
    const selectedVoice = voice === 'female'
      ? TAMIL_VOICES.FEMALE_A
      : TAMIL_VOICES.MALE_B;

    // Generate audio with emotion-aware parameters
    const audioBuffer = await synthesizeTamilSpeech(text, {
      voice: selectedVoice,
      speakingRate: emotionConfig.speakingRate,
      pitch: emotionConfig.pitch,
      volumeGainDb: emotionConfig.volumeGainDb,
    });

    return new NextResponse(audioBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'X-Emotion': emotion || 'neutral',
        'X-Mood': mood || 'neutral',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Context-aware TTS error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate audio';
    return NextResponse.json(
      {
        error: 'Failed to generate context-aware audio',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

/**
 * Get TTS parameters based on emotion and mood
 */
function getEmotionBasedTTSConfig(emotion?: string, mood?: string) {
  // Default configuration
  const defaultConfig = {
    speakingRate: 0.9,
    pitch: 0,
    volumeGainDb: 2.0,
  };

  // Adjust based on emotion
  switch (emotion) {
    case 'sad':
    case 'melancholic':
      return {
        speakingRate: 0.75,
        pitch: -2.0,
        volumeGainDb: 1.0,
      };

    case 'joyful':
    case 'hopeful':
      return {
        speakingRate: 1.0,
        pitch: 2.0,
        volumeGainDb: 3.0,
      };

    case 'reflective':
    case 'longing':
      return {
        speakingRate: 0.85,
        pitch: -1.0,
        volumeGainDb: 1.5,
      };

    case 'devotional':
      return {
        speakingRate: 0.8,
        pitch: 0,
        volumeGainDb: 2.5,
      };

    case 'patriotic':
    case 'powerful':
      return {
        speakingRate: 0.95,
        pitch: 1.0,
        volumeGainDb: 4.0,
      };

    case 'romantic':
      return {
        speakingRate: 0.85,
        pitch: 0.5,
        volumeGainDb: 2.0,
      };

    default:
      // Use mood if emotion is not specific
      if (mood === 'somber') {
        return { speakingRate: 0.75, pitch: -2.0, volumeGainDb: 1.0 };
      } else if (mood === 'uplifting') {
        return { speakingRate: 1.0, pitch: 2.0, volumeGainDb: 3.0 };
      } else if (mood === 'peaceful') {
        return { speakingRate: 0.85, pitch: 0, volumeGainDb: 2.0 };
      }
      return defaultConfig;
  }
}
