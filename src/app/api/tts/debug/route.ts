/**
 * TTS Debug Endpoint
 * GET /api/tts/debug
 *
 * Reports whether Google TTS credentials are configured and usable. This is an
 * admin-only diagnostic and is disabled entirely in production:
 *  - It must never echo credential material (paths, base64, project/client ids).
 *  - It performs a live Google API call (listVoices), so leaving it open to
 *    anonymous callers is both an info-disclosure and a billable-abuse vector.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';

export async function GET(request: NextRequest) {
  // Neutralised in production, consistent with the other debug routes.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Admin-only even in dev — this triggers a real (billable) Google call.
  try {
    await requireAdmin(request);
  } catch (e) {
    return authErrorResponse(e);
  }

  const hasBase64 = !!process.env.GOOGLE_TTS_CREDENTIALS_BASE64;
  const hasKeyFile = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const debug = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    credentials: {
      // Booleans only — never echo the credential values themselves.
      hasGoogleApplicationCredentials: hasKeyFile,
      hasGoogleTtsCredentialsBase64: hasBase64,
    },
    parsedCredentials: {
      // Confirms the base64 decodes to valid JSON without revealing its contents.
      canParse: false,
      error: null as string | null,
    },
  };

  if (hasBase64) {
    try {
      JSON.parse(
        Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64!, 'base64').toString('utf-8')
      );
      debug.parsedCredentials.canParse = true;
    } catch (error) {
      debug.parsedCredentials.error =
        error instanceof Error ? error.message : 'Unknown error';
    }
  }

  // Try to initialize the TTS client and make one minimal call.
  const clientStatus = {
    canInitialize: false,
    error: null as string | null,
  };

  try {
    const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');

    if (hasBase64) {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64!, 'base64').toString('utf-8')
      );
      const client = new TextToSpeechClient({ credentials });
      await client.listVoices({ languageCode: 'ta-IN' });
      clientStatus.canInitialize = true;
    } else if (hasKeyFile) {
      const client = new TextToSpeechClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
      await client.listVoices({ languageCode: 'ta-IN' });
      clientStatus.canInitialize = true;
    } else {
      clientStatus.error = 'No credentials configured';
    }
  } catch (error) {
    clientStatus.error =
      error instanceof Error ? error.message : 'Client initialization failed';
  }

  return NextResponse.json(
    {
      status: clientStatus.canInitialize ? 'OK' : 'ERROR',
      debug,
      clientStatus,
    },
    { status: clientStatus.canInitialize ? 200 : 503 }
  );
}
