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
  let config = {
    speakingRate: 0.9,
    pitch: 0,
    volumeGainDb: 2.0,
  };

  // Adjust based on emotion
  switch (emotion) {
    case 'sad':
    case 'melancholic':
      config.speakingRate = 0.75; // Slower for sadness
      config.pitch = -2.0; // Lower pitch
      config.volumeGainDb = 1.0; // Softer
      break;

    case 'joyful':
    case 'hopeful':
      config.speakingRate = 1.0; // Normal to slightly faster
      config.pitch = 2.0; // Higher pitch
      config.volumeGainDb = 3.0; // Louder, more energetic
      break;

    case 'reflective':
    case 'longing':
      config.speakingRate = 0.85; // Slower, contemplative
      config.pitch = -1.0; // Slightly lower
      config.volumeGainDb = 1.5; // Moderate
      break;

    case 'devotional':
      config.speakingRate = 0.8; // Reverent pace
      config.pitch = 0; // Natural
      config.volumeGainDb = 2.5; // Clear and present
      break;

    case 'patriotic':
    case 'powerful':
      config.speakingRate = 0.95; // Confident pace
      config.pitch = 1.0; // Slightly elevated
      config.volumeGainDb = 4.0; // Strong and clear
      break;

    case 'romantic':
      config.speakingRate = 0.85; // Gentle, measured
      config.pitch = 0.5; // Slightly warm
      config.volumeGainDb = 2.0; // Intimate
      break;

    default:
      // Use mood if emotion is not specific
      if (mood === 'somber') {
        config.speakingRate = 0.75;
        config.pitch = -2.0;
      } else if (mood === 'uplifting') {
        config.speakingRate = 1.0;
        config.pitch = 2.0;
      } else if (mood === 'peaceful') {
        config.speakingRate = 0.85;
        config.pitch = 0;
      }
  }

  return config;
}
