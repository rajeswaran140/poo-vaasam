/** @jest-environment node */
import {
  newDeliveryToken, isDeliveryToken, deliveryStatusOf, createDeliverySchema,
  DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_DAYS, type Delivery,
} from '@/types/delivery';

const base = (over: Partial<Delivery> = {}): Delivery => ({
  token: newDeliveryToken(),
  s3Key: 'deliveries/x.mp3',
  filename: 'Song - Karaoke.mp3',
  label: 'Buyer — karaoke',
  contentLength: 12151796,
  createdAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2026-09-21T00:00:00.000Z',
  maxDownloads: 3,
  downloadCount: 0,
  downloads: [],
  revokedAt: null,
  ...over,
});

describe('tokens', () => {
  it('mints 43-char base64url tokens that validate', () => {
    const t = newDeliveryToken();
    expect(t).toHaveLength(43);
    expect(isDeliveryToken(t)).toBe(true);
  });
  it('does not repeat', () => {
    const many = new Set(Array.from({ length: 200 }, newDeliveryToken));
    expect(many.size).toBe(200);
  });
  it('rejects anything that is not a token — keys are built from this', () => {
    for (const bad of ['', 'short', 'a'.repeat(43) + '=', '../../etc/passwd', 'a/b', 'a+b'.padEnd(43, 'x')]) {
      expect(isDeliveryToken(bad)).toBe(false);
    }
  });
});

describe('deliveryStatusOf', () => {
  const NOW = new Date('2026-09-15T00:00:00.000Z');
  it('is active inside the window and under the cap', () => {
    expect(deliveryStatusOf(base(), NOW)).toBe('active');
  });
  it('is expired past expiresAt', () => {
    expect(deliveryStatusOf(base({ expiresAt: '2026-09-14T00:00:00.000Z' }), NOW)).toBe('expired');
  });
  it('is exhausted at the cap', () => {
    expect(deliveryStatusOf(base({ downloadCount: 3 }), NOW)).toBe('exhausted');
  });
  it('is revoked even when otherwise fine', () => {
    expect(deliveryStatusOf(base({ revokedAt: '2026-09-14T12:00:00.000Z' }), NOW)).toBe('revoked');
  });
  it('reports revoked ahead of expired when both apply', () => {
    // The operator killing a link is the more informative fact.
    const d = base({ revokedAt: '2026-09-13T00:00:00.000Z', expiresAt: '2026-09-14T00:00:00.000Z' });
    expect(deliveryStatusOf(d, NOW)).toBe('revoked');
  });
});

describe('createDeliverySchema', () => {
  it('accepts a well-formed create', () => {
    expect(createDeliverySchema.safeParse({
      s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'Buyer',
    }).success).toBe(true);
  });
  it('refuses an s3Key outside the deliveries prefix', () => {
    // Otherwise a link could be minted for any object in the bucket.
    expect(createDeliverySchema.safeParse({
      s3Key: 'audio/poem-music/song.mp3', filename: 'a.mp3', label: 'B',
    }).success).toBe(false);
  });
  it('refuses path traversal in the key', () => {
    expect(createDeliverySchema.safeParse({
      s3Key: 'deliveries/../audio/x.mp3', filename: 'a.mp3', label: 'B',
    }).success).toBe(false);
  });
});

describe('defaults', () => {
  it('are the locked values', () => {
    expect(DEFAULT_MAX_DOWNLOADS).toBe(3);
    expect(DEFAULT_TTL_DAYS).toBe(7);
  });
});
