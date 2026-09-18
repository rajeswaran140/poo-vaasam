/** @jest-environment node */
import {
  newDeliveryToken, isDeliveryToken, deliveryStatusOf, createDeliverySchema,
  DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_DAYS, type Delivery,
  publicDelivery,
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
  it('rejects 43-char strings with forbidden characters (charset test)', () => {
    // Must be exactly 43 chars and differ only by the forbidden character
    const valid43 = 'a'.repeat(42) + 'b'; // valid base64url
    expect(valid43).toHaveLength(43);
    expect(isDeliveryToken(valid43)).toBe(true);
    // Replace the last char with forbidden ones
    expect(isDeliveryToken(valid43.slice(0, -1) + '/')).toBe(false); // slash forbidden
    expect(isDeliveryToken(valid43.slice(0, -1) + '.')).toBe(false); // dot forbidden
    expect(isDeliveryToken(valid43.slice(0, -1) + '+')).toBe(false); // plus forbidden
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
  it('reports expired ahead of exhausted when both apply', () => {
    // Expiration is checked before download cap.
    const d = base({ expiresAt: '2026-09-14T00:00:00.000Z', downloadCount: 3 });
    expect(deliveryStatusOf(d, NOW)).toBe('expired');
  });
  it('reports revoked ahead of exhausted when both apply', () => {
    // Revocation takes precedence over all other states.
    const d = base({ revokedAt: '2026-09-14T12:00:00.000Z', downloadCount: 3 });
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
    // 5, not 3: a commission is usually several files, and a buyer moving
    // between a phone and a laptop spends two before listening properly.
    expect(DEFAULT_MAX_DOWNLOADS).toBe(5);
    expect(DEFAULT_TTL_DAYS).toBe(7);
  });
});

/**
 * `s3Key` carried a comment saying it is NEVER sent to a client, while both
 * admin responses returned the whole row including it. Admin-only, and the
 * admin already has S3 access — but an invariant that is merely asserted is
 * worse than none, because the next reader builds on it.
 */
describe('publicDelivery', () => {
  const row: Delivery = {
    token: 'a'.repeat(43),
    s3Key: 'deliveries/anton/secret-path.mp3',
    filename: 'Song.mp3',
    label: 'Anton',
    contentLength: 123,
    createdAt: '2026-09-18T00:00:00.000Z',
    expiresAt: '2026-09-25T00:00:00.000Z',
    maxDownloads: 5,
    downloadCount: 0,
    downloads: [],
    revokedAt: null,
  };

  it('removes the one field that must not travel', () => {
    const out = publicDelivery(row);
    expect('s3Key' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-path');
  });

  it('keeps everything the buyer page and the admin list need', () => {
    const out = publicDelivery(row);
    for (const k of ['token', 'filename', 'label', 'contentLength', 'createdAt',
                     'expiresAt', 'maxDownloads', 'downloadCount', 'downloads', 'revokedAt'] as const) {
      expect(k in out).toBe(true);
    }
  });

  /**
   * Destructured rather than deleted, so a field added to Delivery later is
   * included by default and only a deliberate edit here can exclude it.
   */
  it('passes through a field added to Delivery without being updated', () => {
    const extended = { ...row, somethingNew: 'x' } as Delivery & { somethingNew: string };
    expect((publicDelivery(extended) as { somethingNew?: string }).somethingNew).toBe('x');
  });
});
