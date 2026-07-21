/**
 * karaokeInstrumentalKey — the gated S3 key convention.
 *
 * Locks the invariant that karaoke instrumentals live under the private
 * `performer-tracks/` prefix (NEVER the public `audio/` prefix) and that song
 * ids are sanitised into a safe, deterministic key segment.
 */

import {
  karaokeInstrumentalKey,
  resolvePerformerAssetsBucket,
} from '@/infrastructure/storage/KaraokeInstrumentalStorage';
import { s3Config } from '@/lib/aws-config';

describe('karaokeInstrumentalKey', () => {
  const at = new Date('2026-07-21T12:00:00.000Z');

  it('places the instrumental under the private performer-tracks/ prefix', () => {
    expect(karaokeInstrumentalKey('sevvanthi-poove', at)).toBe(
      `performer-tracks/sevvanthi-poove-instrumental-${at.getTime()}.mp3`
    );
  });

  it('never uses the public audio/ prefix', () => {
    expect(karaokeInstrumentalKey('sevvanthi-poove', at).startsWith('audio/')).toBe(false);
  });

  it('sanitises unsafe characters (incl. non-ASCII) into a portable segment', () => {
    const key = karaokeInstrumentalKey('செவ்வந்தி பூவே', at);
    expect(key.startsWith('performer-tracks/')).toBe(true);
    expect(key.endsWith(`-instrumental-${at.getTime()}.mp3`)).toBe(true);
    // Whole key is the private prefix + a safe segment: no spaces or
    // path-breaking characters beyond the fixed "performer-tracks/" slash.
    expect(key).toMatch(/^performer-tracks\/[A-Za-z0-9._-]+\.mp3$/);
  });

  it('is unique per timestamp for the same song (no overwrite of prior renders)', () => {
    const a = karaokeInstrumentalKey('s', new Date('2026-07-21T12:00:00.000Z'));
    const b = karaokeInstrumentalKey('s', new Date('2026-07-21T12:00:01.000Z'));
    expect(a).not.toBe(b);
  });

  it('rejects an empty songId', () => {
    expect(() => karaokeInstrumentalKey('   ', at)).toThrow(/songId/);
  });
});

describe('resolvePerformerAssetsBucket (fail closed)', () => {
  const prev = process.env.PERFORMER_ASSETS_BUCKET;
  afterEach(() => {
    if (prev === undefined) delete process.env.PERFORMER_ASSETS_BUCKET;
    else process.env.PERFORMER_ASSETS_BUCKET = prev;
  });

  it('throws when no gated bucket is configured', () => {
    delete process.env.PERFORMER_ASSETS_BUCKET;
    expect(() => resolvePerformerAssetsBucket()).toThrow(/PERFORMER_ASSETS_BUCKET/);
  });

  it('refuses the CDN-public media bucket even if explicitly passed', () => {
    expect(() => resolvePerformerAssetsBucket(s3Config.bucket)).toThrow(/public media CloudFront/i);
  });

  it('accepts a distinct private bucket (explicit or via env)', () => {
    expect(resolvePerformerAssetsBucket('tamil-web-media-gated')).toBe('tamil-web-media-gated');
    process.env.PERFORMER_ASSETS_BUCKET = 'tamil-web-media-gated';
    expect(resolvePerformerAssetsBucket()).toBe('tamil-web-media-gated');
  });
});
