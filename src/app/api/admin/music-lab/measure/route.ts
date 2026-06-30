/**
 * POST /api/admin/music-lab/measure — server-side loudness measurement.
 * Body: { s3Key, bucket?, target=-14 }. Admin-gated, Node runtime.
 *
 * Synchronously invokes the `measure-fn` Lambda (which has the ffmpeg layer +
 * S3 read) and returns its { metrics, badge, verdict } JSON. The browser never
 * fetches the audio → no CloudFront/CORS dependency. One EBU R128 pass is a few
 * seconds, safely under the 30s CloudFront/SSR ceiling. This route never spawns
 * ffmpeg itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEASURE_FUNCTION = process.env.MEASURE_FUNCTION || 'tamilagaval-measure-fn';

// Reject path traversal / absolute URLs — only plain S3 keys.
const validKey = (k: unknown): k is string =>
  typeof k === 'string' && k.length > 0 && k.length <= 1024 && !k.includes('..') && !/^https?:\/\//i.test(k);

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const s3Key = (body?.s3Key as string)?.replace(/^\/+/, '');
  if (!validKey(s3Key)) {
    return NextResponse.json({ success: false, error: 'A valid s3Key is required' }, { status: 400 });
  }
  const target = Number.isFinite(body?.target) ? Number(body.target) : -14;
  const bucket = typeof body?.bucket === 'string' ? body.bucket : undefined;

  try {
    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: MEASURE_FUNCTION,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ s3Key, ...(bucket ? { bucket } : {}), target })),
      })
    );
    const payload = res.Payload ? Buffer.from(res.Payload).toString() : '';
    const parsed = payload ? JSON.parse(payload) : null;
    if (res.FunctionError || !parsed || parsed.error) {
      console.error('[api/music-lab/measure] measure-fn error:', res.FunctionError || parsed?.error);
      return NextResponse.json({ success: false, error: 'Measurement failed' }, { status: 502 });
    }
    return NextResponse.json({ success: true, ...parsed });
  } catch (err) {
    console.error('[api/music-lab/measure] invoke failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Measurement service unavailable' }, { status: 502 });
  }
}
