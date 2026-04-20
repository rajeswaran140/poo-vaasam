/**
 * Unit Tests for Slug Generation Utility
 *
 * TDD Approach: Write tests first, then implement the function
 *
 * Requirements:
 * - Convert Tamil text to URL-friendly slugs
 * - Handle special characters and spaces
 * - Convert to lowercase
 * - Replace spaces with hyphens
 * - Remove consecutive hyphens
 */

import { generateSlug, isValidSlug } from '@/lib/utils/slug';

describe('generateSlug', () => {
  describe('Basic functionality', () => {
    it('should convert simple English text to slug', () => {
      expect(generateSlug('Hello World')).toBe('hello-world');
    });

    it('should handle multiple spaces', () => {
      expect(generateSlug('Hello   World')).toBe('hello-world');
    });

    it('should remove leading and trailing spaces', () => {
      expect(generateSlug('  Hello World  ')).toBe('hello-world');
    });

    it('should handle empty string', () => {
      expect(generateSlug('')).toBe('');
    });

    it('should handle string with only spaces', () => {
      expect(generateSlug('   ')).toBe('');
    });
  });

  describe('Tamil text handling', () => {
    it('should preserve Tamil characters', () => {
      const tamilText = 'பூ வாசம்';
      const slug = generateSlug(tamilText);
      expect(slug).toBe('பூ-வாசம்');
    });

    it('should handle mixed Tamil and English', () => {
      expect(generateSlug('Tamil பாடல் Song')).toBe('tamil-பாடல்-song');
    });

    it('should handle Tamil text with special characters', () => {
      expect(generateSlug('பூ வாசம் - தமிழ்')).toBe('பூ-வாசம்-தமிழ்');
    });
  });

  describe('Special character handling', () => {
    it('should remove special characters except hyphens', () => {
      expect(generateSlug('Hello@World!Test#')).toBe('helloworldtest');
    });

    it('should preserve hyphens', () => {
      expect(generateSlug('Hello-World-Test')).toBe('hello-world-test');
    });

    it('should convert underscores to hyphens', () => {
      expect(generateSlug('hello_world_test')).toBe('hello-world-test');
    });

    it('should remove consecutive hyphens', () => {
      expect(generateSlug('hello---world')).toBe('hello-world');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long strings', () => {
      const longText = 'a'.repeat(300);
      const slug = generateSlug(longText);
      expect(slug.length).toBeLessThanOrEqual(255);
    });

    it('should handle numbers', () => {
      expect(generateSlug('Song 123')).toBe('song-123');
    });

    it('should handle string with only special characters', () => {
      expect(generateSlug('!@#$%^&*()')).toBe('');
    });
  });
});

describe('isValidSlug', () => {
  it('should return true for valid slugs', () => {
    expect(isValidSlug('hello-world')).toBe(true);
    expect(isValidSlug('பூ-வாசம்')).toBe(true);
    expect(isValidSlug('song-123')).toBe(true);
  });

  it('should return false for invalid slugs', () => {
    expect(isValidSlug('Hello World')).toBe(false); // has space
    expect(isValidSlug('hello--world')).toBe(false); // consecutive hyphens
    expect(isValidSlug('-hello-world')).toBe(false); // starts with hyphen
    expect(isValidSlug('hello-world-')).toBe(false); // ends with hyphen
    expect(isValidSlug('')).toBe(false); // empty string
  });

  it('should return false for slugs with special characters', () => {
    expect(isValidSlug('hello@world')).toBe(false);
    expect(isValidSlug('hello!world')).toBe(false);
  });
});
