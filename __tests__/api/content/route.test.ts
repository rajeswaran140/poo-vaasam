/** @jest-environment node */
/**
 * Content API Route Tests
 */

import { NextRequest } from 'next/server';
import { ContentType, ContentStatus } from '@/types/content';

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockReturnValue({
    findById: jest.fn(),
    findBySlug: jest.fn(),
    findAll: jest.fn(),
    findByType: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({
  CategoryRepository: jest.fn().mockReturnValue({}),
}));
jest.mock('@/infrastructure/database/TagRepository', () => ({
  TagRepository: jest.fn().mockReturnValue({}),
}));
jest.mock('@/application/use-cases/GetContentUseCase', () => ({
  GetContentUseCase: jest.fn().mockReturnValue({
    execute: jest.fn(),
  }),
}));
jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAuth: jest.fn(),
}));

import { GET, PUT, DELETE } from '@/app/api/content/route';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { GetContentUseCase } from '@/application/use-cases/GetContentUseCase';
import * as authHelper from '@/lib/auth-helper';

const MockContentRepo = ContentRepository as jest.MockedClass<typeof ContentRepository>;
const MockGetUseCase = GetContentUseCase as jest.MockedClass<typeof GetContentUseCase>;

function getRepo() {
  return MockContentRepo.mock.results[0]?.value as {
    findById: jest.Mock; findBySlug: jest.Mock; findAll: jest.Mock;
    findByType: jest.Mock; create: jest.Mock; update: jest.Mock; save: jest.Mock; delete: jest.Mock;
  };
}

function getGetUseCase() {
  return MockGetUseCase.mock.results[0]?.value as { execute: jest.Mock };
}

function makeContentMock(overrides: Record<string, unknown> = {}) {
  const data = {
    id: '123', type: ContentType.SONGS, title: 'பூ வாசம்', body: 'content',
    author: 'Test', status: ContentStatus.PUBLISHED,
    categoryIds: [], tagIds: [], viewCount: 0, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
  return { ...data, update: jest.fn(), toObject: () => data };
}

describe('Content API Routes - Authentication', () => {
  beforeEach(() => {
    const r = getRepo();
    if (r) Object.values(r).forEach(fn => fn.mockReset());
    const uc = getGetUseCase();
    if (uc) uc.execute.mockReset();
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({ email: 'test@example.com', sub: 'admin' });
  });

  describe('GET /api/content', () => {
    it('should require authentication for GET requests', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/content?id=123');
      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    it('should return content by ID when authenticated', async () => {
      getGetUseCase().execute.mockResolvedValue(makeContentMock());

      const request = new NextRequest('http://localhost:3000/api/content?id=123');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it('should return 404 when content not found', async () => {
      getGetUseCase().execute.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/content?id=999');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Content not found');
    });

    it('should return 400 when no id provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/content');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('DELETE /api/content - Protected', () => {
    it('should require authentication for DELETE requests', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/content?id=123', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('should allow authenticated users to delete content', async () => {
      getRepo().findById.mockResolvedValue({ id: '123', categoryIds: [], tagIds: [] });
      getRepo().delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/content?id=123', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(getRepo().delete).toHaveBeenCalledWith('123');
    });

    it('should return 400 when no id provided for delete', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('PUT /api/content - Protected', () => {
    it('should require authentication for PUT requests', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/content?id=123', {
        method: 'PUT',
        body: JSON.stringify({ title: 'Updated' }),
      });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('should allow authenticated users to update content', async () => {
      const existingMock = makeContentMock();
      getRepo().findById.mockResolvedValue(existingMock);
      getRepo().save.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/content?id=123', {
        method: 'PUT',
        body: JSON.stringify({ id: '123', title: 'Updated பூ வாசம்', body: 'Updated content' }),
      });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should return 400 when no id provided for update', async () => {
      const request = new NextRequest('http://localhost:3000/api/content', {
        method: 'PUT',
        body: JSON.stringify({ title: 'Updated' }),
      });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle repository errors gracefully in GET', async () => {
      getGetUseCase().execute.mockRejectedValue(new Error('Database connection error'));

      const request = new NextRequest('http://localhost:3000/api/content?id=123');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    it('should handle repository errors gracefully in DELETE', async () => {
      getRepo().findById.mockRejectedValue(new Error('Database connection error'));

      const request = new NextRequest('http://localhost:3000/api/content?id=123', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
