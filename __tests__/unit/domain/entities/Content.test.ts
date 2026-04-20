/**
 * Unit Tests for Content Domain Entity
 *
 * TDD approach for domain entities
 */

import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus, type CreateContentDTO } from '@/types/content';

describe('Content Entity', () => {
  const validContentDTO: CreateContentDTO = {
    type: ContentType.SONGS,
    title: 'பூ வாசம்',
    body: 'பூ வாசம் வந்து என்னை கவர்ந்ததடி...',
    description: 'ஒரு அழகான தமிழ் பாடல்',
    author: 'இளையராஜா',
  };

  describe('Creation', () => {
    it('should create a valid content entity', () => {
      const content = Content.create(validContentDTO);

      expect(content.id).toBeDefined();
      expect(content.type).toBe(ContentType.SONGS);
      expect(content.title).toBe('பூ வாசம்');
      expect(content.body).toBe('பூ வாசம் வந்து என்னை கவர்ந்ததடி...');
      expect(content.author).toBe('இளையராஜா');
      expect(content.status).toBe(ContentStatus.DRAFT);
      expect(content.viewCount).toBe(0);
    });

    it('should generate slug from Tamil title', () => {
      const content = Content.create(validContentDTO);
      expect(content.titleSlug).toBe('பூ-வாசம்');
    });

    it('should set createdAt and updatedAt', () => {
      const content = Content.create(validContentDTO);
      expect(content.createdAt).toBeInstanceOf(Date);
      expect(content.updatedAt).toBeInstanceOf(Date);
    });

    it('should not be published initially', () => {
      const content = Content.create(validContentDTO);
      expect(content.publishedAt).toBeUndefined();
      expect(content.isPublished()).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should throw error if title is empty', () => {
      const invalidDTO = { ...validContentDTO, title: '' };
      expect(() => Content.create(invalidDTO)).toThrow('Title is required');
    });

    it('should throw error if body is empty', () => {
      const invalidDTO = { ...validContentDTO, body: '' };
      expect(() => Content.create(invalidDTO)).toThrow('Body is required');
    });

    it('should throw error if author is empty', () => {
      const invalidDTO = { ...validContentDTO, author: '' };
      expect(() => Content.create(invalidDTO)).toThrow('Author is required');
    });

    it('should throw error if title is too long', () => {
      const longTitle = 'a'.repeat(201);
      const invalidDTO = { ...validContentDTO, title: longTitle };
      expect(() => Content.create(invalidDTO)).toThrow('Title must be less than 200 characters');
    });

    it('should throw error if body is too long', () => {
      const longBody = 'a'.repeat(50001);
      const invalidDTO = { ...validContentDTO, body: longBody };
      expect(() => Content.create(invalidDTO)).toThrow('Body must be less than 50,000 characters');
    });
  });

  describe('Publishing', () => {
    it('should publish content', () => {
      const content = Content.create(validContentDTO);
      content.publish();

      expect(content.status).toBe(ContentStatus.PUBLISHED);
      expect(content.publishedAt).toBeInstanceOf(Date);
      expect(content.isPublished()).toBe(true);
    });

    it('should throw error when publishing already published content', () => {
      const content = Content.create(validContentDTO);
      content.publish();

      expect(() => content.publish()).toThrow('Content is already published');
    });

    it('should check if content can be published', () => {
      const content = Content.create(validContentDTO);
      expect(content.canPublish()).toBe(true);

      content.publish();
      expect(content.canPublish()).toBe(false);
    });

    it('should unpublish content', () => {
      const content = Content.create(validContentDTO);
      content.publish();
      content.unpublish();

      expect(content.status).toBe(ContentStatus.DRAFT);
      expect(content.isPublished()).toBe(false);
    });

    it('should throw error when unpublishing non-published content', () => {
      const content = Content.create(validContentDTO);
      expect(() => content.unpublish()).toThrow('Content is not published');
    });
  });

  describe('Updating', () => {
    it('should update title and regenerate slug', () => {
      const content = Content.create(validContentDTO);
      content.update({ title: 'புதிய தலைப்பு' });

      expect(content.title).toBe('புதிய தலைப்பு');
      expect(content.titleSlug).toBe('புதிய-தலைப்பு');
    });

    it('should update body', () => {
      const content = Content.create(validContentDTO);
      content.update({ body: 'புதிய உள்ளடக்கம்' });

      expect(content.body).toBe('புதிய உள்ளடக்கம்');
    });

    it('should update author', () => {
      const content = Content.create(validContentDTO);
      content.update({ author: 'ஏ.ஆர்.ரஹ்மான்' });

      expect(content.author).toBe('ஏ.ஆர்.ரஹ்மான்');
    });

    it('should update audio properties', () => {
      const content = Content.create(validContentDTO);
      content.update({
        audioUrl: 'https://example.com/audio.mp3',
        audioDuration: 240,
      });

      expect(content.audioUrl).toBe('https://example.com/audio.mp3');
      expect(content.audioDuration).toBe(240);
      expect(content.hasAudio()).toBe(true);
    });

    it('should update timestamps on update', () => {
      const content = Content.create(validContentDTO);
      const originalUpdatedAt = content.updatedAt;

      // Wait a bit to ensure timestamp changes
      setTimeout(() => {
        content.update({ title: 'Updated Title' });
        expect(content.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      }, 10);
    });
  });

  describe('Categories and Tags', () => {
    it('should add a category', () => {
      const content = Content.create(validContentDTO);
      content.addCategory('cat_1');

      expect(content.categoryIds).toContain('cat_1');
    });

    it('should not add duplicate category', () => {
      const content = Content.create(validContentDTO);
      content.addCategory('cat_1');
      content.addCategory('cat_1');

      expect(content.categoryIds.filter((id) => id === 'cat_1')).toHaveLength(1);
    });

    it('should remove a category', () => {
      const content = Content.create(validContentDTO);
      content.addCategory('cat_1');
      content.removeCategory('cat_1');

      expect(content.categoryIds).not.toContain('cat_1');
    });

    it('should add a tag', () => {
      const content = Content.create(validContentDTO);
      content.addTag('tag_1');

      expect(content.tagIds).toContain('tag_1');
    });

    it('should remove a tag', () => {
      const content = Content.create(validContentDTO);
      content.addTag('tag_1');
      content.removeTag('tag_1');

      expect(content.tagIds).not.toContain('tag_1');
    });

    it('should return immutable copies of category and tag arrays', () => {
      const content = Content.create(validContentDTO);
      content.addCategory('cat_1');

      const categoryIds = content.categoryIds;
      categoryIds.push('cat_2');

      // Original should not be modified
      expect(content.categoryIds).toHaveLength(1);
      expect(content.categoryIds).not.toContain('cat_2');
    });
  });

  describe('View Count', () => {
    it('should increment view count', () => {
      const content = Content.create(validContentDTO);
      expect(content.viewCount).toBe(0);

      content.incrementViewCount();
      expect(content.viewCount).toBe(1);

      content.incrementViewCount();
      expect(content.viewCount).toBe(2);
    });
  });

  describe('Archiving', () => {
    it('should archive content', () => {
      const content = Content.create(validContentDTO);
      content.archive();

      expect(content.status).toBe(ContentStatus.ARCHIVED);
    });

    it('should archive published content', () => {
      const content = Content.create(validContentDTO);
      content.publish();
      content.archive();

      expect(content.status).toBe(ContentStatus.ARCHIVED);
    });
  });

  describe('Serialization', () => {
    it('should convert to plain object', () => {
      const content = Content.create(validContentDTO);
      const obj = content.toObject();

      expect(obj.id).toBeDefined();
      expect(obj.title).toBe('பூ வாசம்');
      expect(obj.type).toBe(ContentType.SONGS);
      expect(obj.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO string
    });

    it('should reconstruct from plain object', () => {
      const content = Content.create(validContentDTO);
      const obj = content.toObject();

      const reconstructed = Content.fromObject(obj);

      expect(reconstructed.id).toBe(content.id);
      expect(reconstructed.title).toBe(content.title);
      expect(reconstructed.type).toBe(content.type);
      expect(reconstructed.body).toBe(content.body);
    });

    it('should maintain entity integrity after serialization', () => {
      const content = Content.create({
        ...validContentDTO,
        audioUrl: 'https://example.com/audio.mp3',
        categoryIds: ['cat_1', 'cat_2'],
      });

      content.publish();
      content.incrementViewCount();

      const obj = content.toObject();
      const reconstructed = Content.fromObject(obj);

      expect(reconstructed.isPublished()).toBe(true);
      expect(reconstructed.hasAudio()).toBe(true);
      expect(reconstructed.viewCount).toBe(1);
      expect(reconstructed.categoryIds).toHaveLength(2);
    });
  });

  describe('Audio Content', () => {
    it('should handle content with audio', () => {
      const contentWithAudio = Content.create({
        ...validContentDTO,
        audioUrl: 'https://example.com/song.mp3',
        audioDuration: 180,
      });

      expect(contentWithAudio.hasAudio()).toBe(true);
      expect(contentWithAudio.audioUrl).toBe('https://example.com/song.mp3');
      expect(contentWithAudio.audioDuration).toBe(180);
    });

    it('should handle content without audio', () => {
      const content = Content.create(validContentDTO);
      expect(content.hasAudio()).toBe(false);
    });
  });
});
