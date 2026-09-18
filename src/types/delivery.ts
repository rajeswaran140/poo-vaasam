/**
 * Expiring delivery links — the shared contract.
 *
 * CLIENT-SAFE: imports no AWS SDK, so the public page, the API routes and the
 * admin panel share one source of truth. `node:crypto` is a built-in and is
 * only reached by `newDeliveryToken`, which the client never calls.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * 5, not 3. A commission is usually several files, and a buyer moving between
 * a phone and a laptop spends two before listening properly. Three sends them
 * back to ask, which costs more than a spare download.
 */
export const DEFAULT_MAX_DOWNLOADS = 5;
export const DEFAULT_TTL_DAYS = 7;
/** Long enough to start a download, too short to be worth passing on. */
export const PRESIGN_TTL_SECONDS = 60;
/** The only prefix a delivery may serve from. See the CloudFront Deny. */
export const DELIVERY_PREFIX = 'deliveries/';

export type DeliveryStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export interface DeliveryHit { at: string; ip: string }

export interface Delivery {
  token: string;
  /**
   * The object served.
   *
   * ⚠️ NEVER SENT TO A CLIENT — see `publicDelivery`, which is what the routes
   * return. This was stated here long before it was true: both admin responses
   * carried the whole row, including this. The admin already has S3 access so
   * nothing leaked that mattered, but an invariant that is merely asserted is
   * worse than none, because the next reader builds on it.
   */
  s3Key: string;
  filename: string;
  label: string;
  contentLength: number;
  createdAt: string;
  expiresAt: string;
  maxDownloads: number;
  downloadCount: number;
  downloads: DeliveryHit[];
  revokedAt: string | null;
}

/**
 * 256 bits, base64url, 43 chars. Not a UUID — v4 gives 122 bits and reads as
 * guessable to anyone auditing this later. The token IS the credential.
 */
export function newDeliveryToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Validated before it is ever used to build a DynamoDB key. */
export function isDeliveryToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(t);
}

/**
 * Revoked is reported ahead of expired: the operator killing a link is the
 * more informative fact, and the message the buyer gets should say so.
 */
export function deliveryStatusOf(d: Delivery, now: Date = new Date()): DeliveryStatus {
  if (d.revokedAt) return 'revoked';
  if (Date.parse(d.expiresAt) <= now.getTime()) return 'expired';
  if (d.downloadCount >= d.maxDownloads) return 'exhausted';
  return 'active';
}

/** A delivery as it may leave the server: everything except where the file lives. */
export type PublicDelivery = Omit<Delivery, 's3Key'>;

/** Strip the one field that must not travel. Use this on EVERY response. */
export function publicDelivery(d: Delivery): PublicDelivery {
  // Destructured rather than deleted so a field added to Delivery later is
  // included by default, and only a deliberate edit here can exclude it.
  const { s3Key: _s3Key, ...rest } = d;
  return rest;
}

export const createDeliverySchema = z.object({
  s3Key: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((k) => k.startsWith(DELIVERY_PREFIX), 'Key must be under deliveries/')
    .refine((k) => !k.includes('..'), 'Key must not traverse'),
  filename: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  maxDownloads: z.number().int().min(1).max(20).optional(),
  ttlDays: z.number().int().min(1).max(90).optional(),
});
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
