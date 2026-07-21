/**
 * KaraokeAsset — domain tests.
 *
 * Focus: the gating invariant (the crux of the Performers feature), that the
 * asset holds a private object key rather than a public URL, and the
 * construction rules that keep an invalid asset from ever existing.
 */

import { KaraokeAsset } from '@/domain/songs/KaraokeAsset';

const valid = {
  songId: 'sevvanthi-poove',
  instrumentalKey: 'performer-tracks/sevvanthi-poove-instrumental-123.mp3',
  durationSeconds: 214,
  separationModel: 'htdemucs',
  createdAt: '2026-07-21T12:00:00.000Z',
};

describe('KaraokeAsset', () => {
  describe('create', () => {
    it('builds a valid subscriber-gated asset from a private key', () => {
      const asset = KaraokeAsset.create(valid);
      expect(asset.songId).toBe('sevvanthi-poove');
      expect(asset.separationModel).toBe('htdemucs');
      expect(asset.visibility).toBe('subscribers');
      expect(asset.instrumentalKey).toBe(valid.instrumentalKey);
      expect(asset.durationSeconds).toBe(214);
    });

    it('trims songId, instrumentalKey, and separationModel', () => {
      const asset = KaraokeAsset.create({
        ...valid,
        songId: '  sevvanthi-poove  ',
        instrumentalKey: '  performer-tracks/x.mp3  ',
        separationModel: ' htdemucs ',
      });
      expect(asset.songId).toBe('sevvanthi-poove');
      expect(asset.instrumentalKey).toBe('performer-tracks/x.mp3');
      expect(asset.separationModel).toBe('htdemucs');
    });

    it('rejects a public URL where a private key belongs (anti-scraping guard)', () => {
      expect(() =>
        KaraokeAsset.create({ ...valid, instrumentalKey: 'https://cdn.example.com/x.mp3' })
      ).toThrow(/object key, not a URL/i);
    });

    it.each([
      ['empty songId', { ...valid, songId: '   ' }, /songId/],
      ['empty instrumentalKey', { ...valid, instrumentalKey: '  ' }, /instrumentalKey/],
      ['empty separationModel', { ...valid, separationModel: '' }, /separationModel/],
      ['non-ISO createdAt', { ...valid, createdAt: 'last tuesday' }, /createdAt/],
      ['empty createdAt', { ...valid, createdAt: '' }, /createdAt/],
    ])('rejects %s', (_label, params, message) => {
      expect(() => KaraokeAsset.create(params)).toThrow(message);
    });

    it('normalises a non-positive duration to undefined', () => {
      expect(KaraokeAsset.create({ ...valid, durationSeconds: 0 }).durationSeconds).toBeUndefined();
      expect(KaraokeAsset.create({ ...valid, durationSeconds: -5 }).durationSeconds).toBeUndefined();
      expect(KaraokeAsset.create({ ...valid, durationSeconds: 214.7 }).durationSeconds).toBe(215);
    });
  });

  describe('isAccessibleBy (the gate)', () => {
    const asset = KaraokeAsset.create(valid);

    it('grants access to a subscriber', () => {
      expect(asset.isAccessibleBy({ isSubscriber: true })).toBe(true);
    });

    it('denies a non-subscriber', () => {
      expect(asset.isAccessibleBy({ isSubscriber: false })).toBe(false);
    });

    it('denies a malformed viewer without throwing', () => {
      const bad = (v: unknown) => asset.isAccessibleBy(v as { isSubscriber: boolean });
      expect(bad(undefined)).toBe(false);
      expect(bad({})).toBe(false); // truthy-but-wrong shape must not leak access
    });
  });

  describe('equals & toJSON', () => {
    it('is value-equal for identical inputs and unequal on any change', () => {
      const a = KaraokeAsset.create(valid);
      const b = KaraokeAsset.create(valid);
      const c = KaraokeAsset.create({ ...valid, separationModel: 'htdemucs_6s' });
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });

    it('serialises the key (never a URL) and no mutable instance', () => {
      const json = KaraokeAsset.create(valid).toJSON();
      expect(json).toEqual({
        songId: 'sevvanthi-poove',
        instrumentalKey: valid.instrumentalKey,
        durationSeconds: 214,
        separationModel: 'htdemucs',
        createdAt: valid.createdAt,
        visibility: 'subscribers',
      });
    });
  });
});
