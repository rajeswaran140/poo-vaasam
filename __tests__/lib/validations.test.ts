/**
 * Validation Schema Tests
 *
 * Unit tests for Zod validation schemas
 */

import {
  contentSchema,
  categorySchema,
  tagSchema,
  validateData,
} from '@/lib/validations';
import { ContentType, ContentStatus } from '@/types/content';

describe('Content Validation Schema', () => {
  describe('Valid Content', () => {
    it('should validate a complete valid content object', () => {
      const validContent = {
        type: ContentType.SONGS,
        title: 'பூ வாசம்',
        body: 'This is a valid Tamil song content with sufficient length',
        description: 'A beautiful Tamil song',
        author: 'இளையராஜா',
        status: ContentStatus.PUBLISHED,
        categoryIds: ['cat1', 'cat2'],
        tagIds: ['tag1', 'tag2'],
        audioUrl: 'https://example.com/audio.mp3',
        audioDuration: 180,
        featuredImage: 'https://example.com/image.jpg',
        seoTitle: 'Beautiful Tamil Song',
        seoDescription: 'Listen to this beautiful Tamil song',
      };

      const result = contentSchema.safeParse(validContent);
      expect(result.success).toBe(true);
    });

    it('should validate minimal required fields', () => {
      const minimalContent = {
        type: ContentType.POEMS,
        title: 'Test Poem',
        body: 'This is a test poem with minimal required fields',
        author: 'Test Author',
        status: ContentStatus.DRAFT,
      };

      const result = contentSchema.safeParse(minimalContent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categoryIds).toEqual([]);
        expect(result.data.tagIds).toEqual([]);
      }
    });
  });

  describe('Invalid Content', () => {
    it('should fail validation for empty title', () => {
      const invalidContent = {
        type: ContentType.SONGS,
        title: '',
        body: 'Content body text',
        author: 'Author Name',
        status: ContentStatus.DRAFT,
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Title is required');
      }
    });

    it('should fail validation for title exceeding max length', () => {
      const longTitle = 'a'.repeat(201);
      const invalidContent = {
        type: ContentType.SONGS,
        title: longTitle,
        body: 'Content body text',
        author: 'Author',
        status: ContentStatus.DRAFT,
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
    });

    it('should fail validation for body less than 10 characters', () => {
      const invalidContent = {
        type: ContentType.LYRICS,
        title: 'Test Title',
        body: 'Short',
        author: 'Author',
        status: ContentStatus.DRAFT,
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('at least 10 characters');
      }
    });

    it('should fail validation for invalid audio URL', () => {
      const invalidContent = {
        type: ContentType.SONGS,
        title: 'Test Song',
        body: 'Song content text goes here',
        author: 'Artist Name',
        status: ContentStatus.PUBLISHED,
        audioUrl: 'not-a-valid-url',
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
    });

    it('should fail validation for negative audio duration', () => {
      const invalidContent = {
        type: ContentType.SONGS,
        title: 'Test Song',
        body: 'Song content text',
        author: 'Artist',
        status: ContentStatus.DRAFT,
        audioDuration: -10,
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
    });

    it('should fail validation for too many categories', () => {
      const invalidContent = {
        type: ContentType.SONGS,
        title: 'Test',
        body: 'Test content body',
        author: 'Author',
        status: ContentStatus.DRAFT,
        categoryIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], // 6 categories, max is 5
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
    });

    it('should fail validation for SEO title exceeding 60 characters', () => {
      const invalidContent = {
        type: ContentType.ESSAYS,
        title: 'Essay Title',
        body: 'Essay content goes here with sufficient length',
        author: 'Writer',
        status: ContentStatus.DRAFT,
        seoTitle: 'a'.repeat(61),
      };

      const result = contentSchema.safeParse(invalidContent);
      expect(result.success).toBe(false);
    });
  });
});

describe('Category Validation Schema', () => {
  it('should validate a valid category', () => {
    const validCategory = {
      name: 'பாடல்கள்',
      description: 'Tamil songs category',
    };

    const result = categorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
  });

  it('should validate category without description', () => {
    const validCategory = {
      name: 'Songs',
    };

    const result = categorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
  });

  it('should fail for empty category name', () => {
    const invalidCategory = {
      name: '',
      description: 'Description',
    };

    const result = categorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });

  it('should fail for category name exceeding max length', () => {
    const invalidCategory = {
      name: 'a'.repeat(51),
    };

    const result = categorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });

  it('should trim whitespace from category name', () => {
    const category = {
      name: '  Test Category  ',
    };

    const result = categorySchema.safeParse(category);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Category');
    }
  });
});

describe('Tag Validation Schema', () => {
  it('should validate a valid tag', () => {
    const validTag = {
      name: 'தமிழ்',
    };

    const result = tagSchema.safeParse(validTag);
    expect(result.success).toBe(true);
  });

  it('should fail for empty tag name', () => {
    const invalidTag = {
      name: '',
    };

    const result = tagSchema.safeParse(invalidTag);
    expect(result.success).toBe(false);
  });

  it('should fail for tag name exceeding max length', () => {
    const invalidTag = {
      name: 'a'.repeat(31),
    };

    const result = tagSchema.safeParse(invalidTag);
    expect(result.success).toBe(false);
  });

  it('should fail for tag name with spaces', () => {
    const invalidTag = {
      name: 'tag with spaces',
    };

    const result = tagSchema.safeParse(invalidTag);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('no spaces');
    }
  });

  it('should trim whitespace from tag name', () => {
    const tag = {
      name: '  Tamil  ',
    };

    const result = tagSchema.safeParse(tag);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Tamil');
    }
  });
});

describe('validateData helper function', () => {
  it('should return success with parsed data for valid input', () => {
    const validData = {
      name: 'Test Category',
      description: 'Test Description',
    };

    const result = validateData(categorySchema, validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Category');
    }
  });

  it('should return formatted errors for invalid input', () => {
    const invalidData = {
      name: '',
      description: 'Test',
    };

    const result = validateData(categorySchema, invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveProperty('name');
      expect(result.errors.name).toContain('required');
    }
  });

  it('should format multiple validation errors', () => {
    const invalidContent = {
      type: ContentType.SONGS,
      title: '',
      body: 'Short',
      author: '',
      status: ContentStatus.DRAFT,
    };

    const result = validateData(contentSchema, invalidContent);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.errors).length).toBeGreaterThan(1);
      expect(result.errors).toHaveProperty('title');
      expect(result.errors).toHaveProperty('body');
      expect(result.errors).toHaveProperty('author');
    }
  });
});
