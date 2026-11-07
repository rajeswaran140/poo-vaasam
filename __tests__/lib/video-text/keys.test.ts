import {
  VIDEO_TEXT_PREFIX, MAX_VIDEO_TEXT_BYTES, RETENTION_DAYS, sourceKey, overlayKey, segmentKey,
  chunkOutKey, outputKey, renderPrefix, isVideoTextKeyFor, isValidProjectId, expiresAtFrom,
} from '@/lib/video-text/keys';

const P = 'p1';
const R = 'r1';

describe('video-text keys', () => {
  it('has the agreed constants', () => {
    expect(VIDEO_TEXT_PREFIX).toBe('audio/mastering/video-text/');
    expect(MAX_VIDEO_TEXT_BYTES).toBe(1024 ** 3);
    expect(RETENTION_DAYS).toBe(30);
  });

  it('puts every key under the project folder and recognises it', () => {
    const keys = [
      sourceKey(P, 'My Song.mov', 'video/quicktime', 1000, 'abc'),
      overlayKey(P, R, 'lyric-1'),
      segmentKey(P, R, 3),
      chunkOutKey(P, R, 3),
      outputKey(P, R),
      renderPrefix(P, R),
    ];
    for (const k of keys) {
      expect(k.startsWith(`${VIDEO_TEXT_PREFIX}${P}/`)).toBe(true);
      expect(isVideoTextKeyFor(P, k)).toBe(true);
    }
    expect(overlayKey(P, R, 'lyric-1').endsWith('.png')).toBe(true);
  });

  it('sanitises the source filename and picks the extension from the content type', () => {
    const k = sourceKey(P, '../../x y.MP4', 'video/mp4', 5, 'n1');
    expect(k).toBe(`${VIDEO_TEXT_PREFIX}${P}/source/5_n1_x_y.mp4`);
    expect(k).not.toContain('..');
    expect(sourceKey(P, 'a.mp4', 'video/quicktime', 5, 'n1').endsWith('.mov')).toBe(true);
    expect(sourceKey(P, '', 'video/mp4', 5, 'n1')).toContain('_source.mp4');
  });

  it('rejects other projects, traversal and the bare prefix', () => {
    expect(isVideoTextKeyFor('p1', 'audio/mastering/video-text/p2/x.mp4')).toBe(false);
    expect(isVideoTextKeyFor('p1', 'audio/mastering/video-text/p1/../p2/x.mp4')).toBe(false);
    expect(isVideoTextKeyFor('p1', 'audio/mastering/video-text/p1/')).toBe(false);
    expect(isVideoTextKeyFor('../x', 'audio/mastering/video-text/../x/a')).toBe(false);
  });

  it('validates project ids', () => {
    expect(isValidProjectId('../x')).toBe(false);
    expect(isValidProjectId('')).toBe(false);
    expect(isValidProjectId('a'.repeat(65))).toBe(false);
    expect(isValidProjectId('a'.repeat(64))).toBe(true);
    expect(isValidProjectId(crypto.randomUUID())).toBe(true);
  });

  it('refuses to build keys from an unsafe project id', () => {
    expect(() => outputKey('../x', R)).toThrow();
  });

  it('computes the expiry 30 days on', () => {
    expect(expiresAtFrom('2026-11-07T00:00:00.000Z')).toBe('2026-12-07T00:00:00.000Z');
  });
});
