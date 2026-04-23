/**
 * Content Validation Tests
 *
 * Unit tests for Zod validation schemas
 */

import {
  createContentSchema,
  updateContentSchema,
  deleteContentSchema,
  validateRequestBody,
  formatZodErrors,
} from '@/lib/validations/content';
import { ContentType, ContentStatus } from '@/types/content';

describe('Content Validation Schemas', () => {
  describe('createContentSchema', () => {
    it('should validate valid content creation data', () => {
      const validData = {
        type: ContentType.POEMS,
        title: 'தமிழ் கவிதை',
        body: 'இது ஒரு அழகான தமிழ் கவிதை',
        description: 'இது விளக்கம்',
        author: 'கவிஞர்',
        status: ContentStatus.DRAFT,
      };

      const result = createContentSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(ContentType.POEMS);
        expect(result.data.categoryIds).toEqual([]);
        expect(result.data.tagIds).toEqual([]);
      }
    });

    it('should reject missing required fields', () => {
      const invalidData = {
        type: ContentType.LYRICS,
        // Missing title, body, description, author
      };

      const result = createContentSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject title longer than 200 characters', () => {
      const longTitle = 'அ'.repeat(201);
      const data = {
        type: ContentType.STORIES,
        title: longTitle,
        body: 'Content',
        description: 'Description',
        author: 'Author',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path.includes('title'))).toBe(true);
      }
    });

    it('should reject body longer than 50,000 characters', () => {
      const longBody = 'அ'.repeat(50001);
      const data = {
        type: ContentType.ESSAYS,
        title: 'Title',
        body: longBody,
        description: 'Description',
        author: 'Author',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should validate with optional fields', () => {
      const data = {
        type: ContentType.SONGS,
        title: 'பாடல்',
        body: 'பாடல் வரிகள்',
        description: 'பாடல் விளக்கம்',
        author: 'இசையமைப்பாளர்',
        audioUrl: 'https://example.com/audio.mp3',
        audioDuration: 180,
        featuredImage: 'https://example.com/image.jpg',
        categoryIds: ['cat1', 'cat2'],
        tagIds: ['tag1'],
        seoTitle: 'SEO Title',
        seoDescription: 'SEO Description',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid content type', () => {
      const data = {
        type: 'INVALID_TYPE',
        title: 'Title',
        body: 'Body',
        description: 'Description',
        author: 'Author',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject more than 10 categories', () => {
      const data = {
        type: ContentType.POEMS,
        title: 'Title',
        body: 'Body',
        description: 'Description',
        author: 'Author',
        categoryIds: Array(11).fill('cat'),
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject more than 20 tags', () => {
      const data = {
        type: ContentType.POEMS,
        title: 'Title',
        body: 'Body',
        description: 'Description',
        author: 'Author',
        tagIds: Array(21).fill('tag'),
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid URL for audioUrl', () => {
      const data = {
        type: ContentType.SONGS,
        title: 'Title',
        body: 'Body',
        description: 'Description',
        author: 'Author',
        audioUrl: 'not-a-valid-url',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should trim whitespace from strings', () => {
      const data = {
        type: ContentType.POEMS,
        title: '  Title with spaces  ',
        body: '  Body with spaces  ',
        description: '  Description  ',
        author: '  Author  ',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Title with spaces');
        expect(result.data.body).toBe('Body with spaces');
        expect(result.data.author).toBe('Author');
      }
    });
  });

  describe('updateContentSchema', () => {
    it('should validate valid update data', () => {
      const validData = {
        id: 'cnt_123',
        title: 'Updated Title',
        body: 'Updated Body',
      };

      const result = updateContentSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require content ID', () => {
      const data = {
        title: 'Updated Title',
      };

      const result = updateContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should allow partial updates', () => {
      const data = {
        id: 'cnt_123',
        title: 'Only update title',
      };

      const result = updateContentSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('cnt_123');
        expect(result.data.title).toBe('Only update title');
        expect(result.data.body).toBeUndefined();
      }
    });

    it('should allow null for optional fields', () => {
      const data = {
        id: 'cnt_123',
        audioUrl: null,
        featuredImage: null,
      };

      const result = updateContentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('deleteContentSchema', () => {
    it('should validate valid delete request', () => {
      const data = { id: 'cnt_123' };
      const result = deleteContentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing ID', () => {
      const data = {};
      const result = deleteContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty ID', () => {
      const data = { id: '' };
      const result = deleteContentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('validateRequestBody helper', () => {
    it('should return success for valid data', () => {
      const data = {
        type: ContentType.POEMS,
        title: 'Title',
        body: 'Body',
        description: 'Description',
        author: 'Author',
      };

      const result = validateRequestBody(createContentSchema, data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(ContentType.POEMS);
      }
    });

    it('should return errors for invalid data', () => {
      const data = {
        type: 'INVALID',
        title: '',
      };

      const result = validateRequestBody(createContentSchema, data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeDefined();
      }
    });
  });

  describe('formatZodErrors helper', () => {
    it('should format Zod errors into readable structure', () => {
      const data = {
        title: '',
        type: 'INVALID',
      };

      const result = createContentSchema.safeParse(data);
      expect(result.success).toBe(false);

      if (!result.success) {
        const formatted = formatZodErrors(result.error);
        expect(typeof formatted).toBe('object');
        expect(Object.keys(formatted).length).toBeGreaterThan(0);
      }
    });

    it('should group errors by field path', () => {
      const data = {
        type: ContentType.POEMS,
        title: 'a'.repeat(201), // Too long
        body: '', // Required
        description: '',
        author: '',
      };

      const result = createContentSchema.safeParse(data);
      if (!result.success) {
        const formatted = formatZodErrors(result.error);

        // Check that errors are grouped by field
        expect(formatted.title).toBeDefined();
        expect(Array.isArray(formatted.title)).toBe(true);
        expect(formatted.body).toBeDefined();
        expect(formatted.author).toBeDefined();
      }
    });
  });
});
