/**
 * Tests for Music Library
 */

import {
  selectMusicForPoem,
  getAllMusicSources,
  getMusicDescription
} from '@/utils/musicLibrary';

describe('Music Library', () => {
  describe('selectMusicForPoem', () => {
    it('should select sad music for sad emotion', () => {
      const track = selectMusicForPoem('sad', 'somber');
      expect(track.emotion).toBe('sad');
      expect(track.url).toContain('incompetech');
    });

    it('should select joyful music for joyful emotion', () => {
      const track = selectMusicForPoem('joyful', 'uplifting');
      expect(track.emotion).toBe('joyful');
    });

    it('should select devotional music for devotional emotion', () => {
      const track = selectMusicForPoem('devotional', 'peaceful');
      expect(track.emotion).toBe('devotional');
    });

    it('should default to sad music if emotion not found', () => {
      const track = selectMusicForPoem('unknown', 'test');
      expect(track.emotion).toBe('sad');
    });

    it('should match by mood if emotion not specified', () => {
      const track = selectMusicForPoem(undefined, 'somber');
      expect(track.mood).toBe('somber');
    });
  });

  describe('getAllMusicSources', () => {
    it('should return array of music URLs', () => {
      const sources = getAllMusicSources('sad', 'somber');
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]).toContain('http');
    });

    it('should include fallback sources', () => {
      const sources = getAllMusicSources('joyful', 'uplifting');
      expect(sources.length).toBeGreaterThan(1);
    });

    it('should always include sad music as final fallback', () => {
      const sources = getAllMusicSources('patriotic', 'powerful');
      const hasSadFallback = sources.some(url =>
        url.includes('Heartbreaking') || url.includes('Gymnopedie')
      );
      expect(hasSadFallback).toBe(true);
    });
  });

  describe('getMusicDescription', () => {
    it('should return description for emotion', () => {
      const desc = getMusicDescription('sad', 'somber');
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    });

    it('should return description for default emotion', () => {
      const desc = getMusicDescription();
      expect(typeof desc).toBe('string');
    });
  });
});
