/**
 * Google Cloud Text-to-Speech Service
 * Tamil Voice Synthesis for Poems
 */

import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { google } from '@google-cloud/text-to-speech/build/protos/protos';

// Tamil voices available in Google TTS
export const TAMIL_VOICES = {
  FEMALE_A: 'ta-IN-Wavenet-A',
  MALE_B: 'ta-IN-Wavenet-B',
  FEMALE_C: 'ta-IN-Wavenet-C',
  MALE_D: 'ta-IN-Wavenet-D',
} as const;

export type TamilVoice = typeof TAMIL_VOICES[keyof typeof TAMIL_VOICES];

interface TTSOptions {
  voice?: TamilVoice;
  speakingRate?: number; // 0.25 to 4.0, default 1.0
  pitch?: number; // -20.0 to 20.0, default 0.0
  volumeGainDb?: number; // -96.0 to 16.0, default 0.0
}

/**
 * Initialize Google Cloud TTS Client
 */
function getTTSClient() {
  // For Amplify deployment, use base64 encoded credentials (priority)
  if (process.env.GOOGLE_TTS_CREDENTIALS_BASE64) {
    try {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64, 'base64').toString('utf-8')
      );
      return new TextToSpeechClient({ credentials });
    } catch (error) {
      console.error('Failed to parse GOOGLE_TTS_CREDENTIALS_BASE64:', error);
      throw new Error('Invalid Google TTS credentials format');
    }
  }

  // For local development, use service account file
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new TextToSpeechClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }

  throw new Error('Google TTS credentials not configured');
}

/**
 * Convert Tamil text to speech
 * Returns audio content as Buffer
 */
export async function synthesizeTamilSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<Buffer> {
  const {
    voice = TAMIL_VOICES.FEMALE_A,
    speakingRate = 0.9, // Slightly slower for poetry
    pitch = 0,
    volumeGainDb = 0,
  } = options;

  try {
    const client = getTTSClient();

    const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
      input: { text },
      voice: {
        languageCode: 'ta-IN',
        name: voice,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate,
        pitch,
        volumeGainDb,
        effectsProfileId: ['headphone-class-device'], // Optimize for headphones
      },
    };

    const [response] = await client.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error('No audio content received from Google TTS');
    }

    return Buffer.from(response.audioContent as Uint8Array);
  } catch (error) {
    console.error('Error synthesizing Tamil speech:', error);
    throw new Error('Failed to generate audio');
  }
}

/**
 * Generate audio for a poem with optimal settings
 */
export async function generatePoemAudio(
  poemText: string,
  voicePreference: 'female' | 'male' = 'female'
): Promise<Buffer> {
  // Select appropriate voice
  const voice = voicePreference === 'female'
    ? TAMIL_VOICES.FEMALE_A
    : TAMIL_VOICES.MALE_B;

  // Optimize for poetry reading
  return synthesizeTamilSpeech(poemText, {
    voice,
    speakingRate: 0.85, // Slower for better comprehension
    pitch: 0,
    volumeGainDb: 2.0, // Slightly louder
  });
}

/**
 * Estimate audio duration (approximate)
 * Based on Tamil reading speed
 */
export function estimateAudioDuration(text: string, speakingRate: number = 0.9): number {
  // Average Tamil reading: ~150 characters per minute at normal speed
  const charsPerMinute = 150 * speakingRate;
  const minutes = text.length / charsPerMinute;
  return Math.ceil(minutes * 60); // Return seconds
}

/**
 * Split long text into chunks for TTS
 * Google TTS has a 5000 character limit
 */
export function splitTextForTTS(text: string, maxLength: number = 4500): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // If single paragraph is too long, split by sentences
      if (paragraph.length > maxLength) {
        const sentences = paragraph.split('.');
        for (const sentence of sentences) {
          if ((currentChunk + sentence).length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence + '.';
          } else {
            currentChunk += sentence + '.';
          }
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += '\n\n' + paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Get available Tamil voices with metadata
 */
export function getAvailableVoices() {
  return [
    {
      name: TAMIL_VOICES.FEMALE_A,
      displayName: 'பெண் குரல் A',
      gender: 'FEMALE',
      description: 'தெளிவான, தொழில்முறை குரல்',
    },
    {
      name: TAMIL_VOICES.MALE_B,
      displayName: 'ஆண் குரல் B',
      gender: 'MALE',
      description: 'ஆழமான, அதிகாரபூர்வமான குரல்',
    },
    {
      name: TAMIL_VOICES.FEMALE_C,
      displayName: 'பெண் குரல் C',
      gender: 'FEMALE',
      description: 'மென்மையான, இனிமையான குரல்',
    },
    {
      name: TAMIL_VOICES.MALE_D,
      displayName: 'ஆண் குரல் D',
      gender: 'MALE',
      description: 'இயல்பான, உரையாடல் குரல்',
    },
  ];
}
