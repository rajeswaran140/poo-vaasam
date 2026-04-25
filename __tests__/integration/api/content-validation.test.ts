/** @jest-environment node */
/**
 * Content API Validation Integration Tests
 *
 * Tests for API request validation with Zod schemas
 */

import { NextRequest } from 'next/server';
import { DELETE, PUT } from '@/app/api/content/route';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { Content } from '@/domain/entities/Content';
import { ContentType } from '@/types/content';

// Mock dependencies
jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAuth: jest.fn().mockResolvedValue({ isAuthenticated: true }),
}));

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockReturnValue({
    findById: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({
  CategoryRepository: jest.fn().mockReturnValue({}),
}));
jest.mock('@/infrastructure/database/TagRepository', () => ({
  TagRepository: jest.fn().mockReturnValue({ decrementContentCount: jest.fn() }),
}));
jest.mock('@/application/use-cases/GetContentUseCase', () => ({
  GetContentUseCase: jest.fn().mockReturnValue({ execute: jest.fn() }),
}));

const MockContentRepo = ContentRepository as jest.MockedClass<typeof ContentRepository>;
function getRepo() {
  return MockContentRepo.mock.results[0]?.value as {
    findById: jest.Mock; save: jest.Mock; delete: jest.Mock; findAll: jest.Mock; create: jest.Mock;
  };
}

describe('Content API Validation', () => {
  beforeEach(() => {
    const r = getRepo();
    if (r) Object.values(r).forEach(fn => (fn as jest.Mock).mockReset());
  });

  describe('DELETE /api/content - Validation', () => {
    it('should reject request without content ID', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
      expect(data.errors).toBeDefined();
    });

    it('should reject request with empty ID', async () => {
      const request = new NextRequest('http://localhost:3000/api/content?id=', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('should return 404 for non-existent content', async () => {
      getRepo().findById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/content?id=nonexistent', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Content not found');
    });
  });

  describe('PUT /api/content - Validation', () => {
    it('should reject request without content ID', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          title: 'Updated Title',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
      expect(data.errors).toBeDefined();
    });

    it('should reject title longer than 200 characters', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'cnt_123',
          title: 'a'.repeat(201),
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.errors.title).toBeDefined();
    });

    it('should reject body longer than 50,000 characters', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'cnt_123',
          body: 'a'.repeat(50001),
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.errors.body).toBeDefined();
    });

    it('should reject invalid URL for audioUrl', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'cnt_123',
          audioUrl: 'not-a-valid-url',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.errors.audioUrl).toBeDefined();
    });

    it('should return 404 for non-existent content', async () => {
      getRepo().findById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'nonexistent',
          title: 'Updated Title',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Content not found');
    });

    it('should accept valid update request', async () => {
      const mockContent = Content.create({
        type: ContentType.POEMS,
        title: 'Original Title',
        body: 'Original Body',
        description: 'Description',
        author: 'Author',
      });

      getRepo().findById.mockResolvedValue(mockContent);
      getRepo().save.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: mockContent.id,
          title: 'Updated Title',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe('Updated Title');
    });

    it('should trim whitespace from string fields', async () => {
      const mockContent = Content.create({
        type: ContentType.POEMS,
        title: 'Original Title',
        body: 'Original Body',
        description: 'Description',
        author: 'Author',
      });

      getRepo().findById.mockResolvedValue(mockContent);
      getRepo().save.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: mockContent.id,
          title: '  Title with spaces  ',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.title).toBe('Title with spaces');
    });

    it('should reject more than 10 categories', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'cnt_123',
          categoryIds: Array(11).fill('cat'),
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.errors.categoryIds).toBeDefined();
    });

    it('should reject more than 20 tags', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'cnt_123',
          tagIds: Array(21).fill('tag'),
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.errors.tagIds).toBeDefined();
    });
  });
});
