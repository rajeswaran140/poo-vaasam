/**
 * GET /api/d/[token] — claim one download and redirect to the file.
 *
 * This is the ONLY route that counts. `/d/[token]` renders a page and counts
 * nothing, because email link-scanners prefetch URLs and would otherwise burn
 * a buyer's downloads before he clicked. Do not "simplify" the page away.
 *
 * The cap is enforced by the repository's ConditionExpression, not by the
 * status read above it — that read is a courtesy that avoids a pointless write,
 * and the database is what actually decides.
 */
import { NextRequest, NextResponse } from 'next/server';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { isDeliveryToken, deliveryStatusOf, PRESIGN_TTL_SECONDS } from '@/types/delivery';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stops the token space being swept. Generous for a real buyer retrying. */
const limiter = new SharedRateLimiter({ bucket: 'delivery', windowMs: 60_000, max: 20 });

const back = (request: NextRequest, token: string, reason: string) =>
  NextResponse.redirect(new URL(`/d/${encodeURIComponent(token)}?e=${reason}`, request.nextUrl.origin), 302);

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const { token } = await params;
  // Validated before it is used to build a DynamoDB key.
  if (!isDeliveryToken(token)) return back(request, 'invalid', 'invalid');

  const repo = new DeliveryRepository();
  const delivery = await repo.findByToken(token);
  if (!delivery) return back(request, token, 'invalid');

  const status = deliveryStatusOf(delivery);
  if (status !== 'active') return back(request, token, status);

  // The cap comes from the row we just read — consume() cannot compare an
  // attribute against another attribute of the same item, so it arrives as an
  // argument rather than being re-read inside the repository.
  const claimed = await repo.consume(token, clientIp(request), delivery.maxDownloads);
  // The database's reason, not a guess. Telling a buyer "already used" when the
  // link was revoked between the read above and this write is a wrong answer to
  // a question they will ask about.
  if (!claimed.ok) return back(request, token, claimed.reason);

  const url = await S3Operations.getSignedUrl(
    delivery.s3Key, PRESIGN_TTL_SECONDS, delivery.filename
  );
  return NextResponse.redirect(url, 302);
}
