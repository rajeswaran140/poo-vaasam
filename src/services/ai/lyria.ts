/**
 * Lyria music generation via Google Vertex AI.
 *
 * NOTE: This calls the Vertex AI `predict` endpoint for the Lyria model. The
 * exact request/response shape should be verified against a live project once
 * Vertex AI + Lyria are enabled (see config/lyria.ts). Returns WAV audio.
 */

import { GoogleAuth } from 'google-auth-library';
import { LYRIA } from '@/config/lyria';

function getServiceAccountCredentials(): Record<string, unknown> | null {
  if (process.env.GOOGLE_TTS_CREDENTIALS_BASE64) {
    try {
      return JSON.parse(
        Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64, 'base64').toString('utf-8')
      );
    } catch {
      return null;
    }
  }
  return null;
}

export function isLyriaConfigured(): boolean {
  return Boolean(LYRIA.project) && getServiceAccountCredentials() !== null;
}

/**
 * Generate instrumental music from a text prompt. Returns a WAV audio Buffer.
 */
export async function generateMusic(prompt: string): Promise<Buffer> {
  const credentials = getServiceAccountCredentials();
  if (!credentials) throw new Error('Vertex AI credentials not configured');
  if (!LYRIA.project) throw new Error('GOOGLE_VERTEX_PROJECT is not set');

  const auth = new GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  if (!token) throw new Error('Failed to obtain Vertex AI access token');

  const url = `https://${LYRIA.location}-aiplatform.googleapis.com/v1/projects/${LYRIA.project}/locations/${LYRIA.location}/publishers/google/models/${LYRIA.model}:predict`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
  });

  if (!res.ok) {
    throw new Error(`Lyria request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Lyria returned no audio content');

  return Buffer.from(b64, 'base64');
}
