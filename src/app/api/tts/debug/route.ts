/**
 * TTS Debug Endpoint
 * GET /api/tts/debug
 *
 * Checks TTS configuration without actually generating audio
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const debug = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    credentials: {
      hasGoogleApplicationCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      hasGoogleTtsCredentialsBase64: !!process.env.GOOGLE_TTS_CREDENTIALS_BASE64,
      googleApplicationCredentialsValue: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'NOT SET',
      base64Length: process.env.GOOGLE_TTS_CREDENTIALS_BASE64?.length || 0,
      base64Preview: process.env.GOOGLE_TTS_CREDENTIALS_BASE64?.substring(0, 50) + '...' || 'NOT SET',
    },
    parsedCredentials: {
      canParse: false,
      error: null as string | null,
      projectId: null as string | null,
      clientEmail: null as string | null,
    },
  };

  // Try to parse base64 credentials
  if (process.env.GOOGLE_TTS_CREDENTIALS_BASE64) {
    try {
      const decoded = Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      debug.parsedCredentials.canParse = true;
      debug.parsedCredentials.projectId = parsed.project_id || null;
      debug.parsedCredentials.clientEmail = parsed.client_email || null;
    } catch (error) {
      debug.parsedCredentials.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  // Try to initialize TTS client
  const clientStatus = {
    canInitialize: false,
    error: null as string | null,
  };

  try {
    const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');

    if (process.env.GOOGLE_TTS_CREDENTIALS_BASE64) {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64, 'base64').toString('utf-8')
      );
      const client = new TextToSpeechClient({ credentials });

      // Try a simple test call
      try {
        await client.listVoices({ languageCode: 'ta-IN' });
        clientStatus.canInitialize = true;
        clientStatus.error = null;
      } catch (apiError) {
        clientStatus.error = apiError instanceof Error ? apiError.message : 'API call failed';
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const client = new TextToSpeechClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });

      try {
        await client.listVoices({ languageCode: 'ta-IN' });
        clientStatus.canInitialize = true;
        clientStatus.error = null;
      } catch (apiError) {
        clientStatus.error = apiError instanceof Error ? apiError.message : 'API call failed';
      }
    } else {
      clientStatus.error = 'No credentials configured';
    }
  } catch (error) {
    clientStatus.error = error instanceof Error ? error.message : 'Client initialization failed';
  }

  return NextResponse.json({
    status: clientStatus.canInitialize ? 'OK' : 'ERROR',
    debug,
    clientStatus,
  }, { status: clientStatus.canInitialize ? 200 : 503 });
}
