/** @jest-environment node */
/**
 * Unit Tests for Admin Content API
 */

import { NextRequest } from 'next/server';
import { ContentType, ContentStatus } from '@/types/content';

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockReturnValue({
    findAll: jest.fn(),
    findByType: jest.fn(),
    create: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({
  CategoryRepository: jest.fn().mockReturnValue({}),
}));
jest.mock('@/infrastructure/database/TagRepository', () => ({
  TagRepository: jest.fn().mockReturnValue({}),
}));
jest.mock('@/application/use-cases/CreateContentUseCase', () => ({
  CreateContentUseCase: jest.fn().mockReturnValue({
    execute: jest.fn(),
  }),
}));
jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAuth: jest.fn(),
}));

import { GET, POST } from '@/app/api/admin/content/route';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import * as authHelper from '@/lib/auth-helper';

const MockContentRepo = ContentRepository as jest.MockedClass<typeof ContentRepository>;
const MockUseCase = CreateContentUseCase as jest.MockedClass<typeof CreateContentUseCase>;

function getRepo() {
  return MockContentRepo.mock.results[0]?.value as {
    findAll: jest.Mock;
    findByType: jest.Mock;
    create: jest.Mock;
  };
}

function getUseCase() {
  return MockUseCase.mock.results[0]?.value as { execute: jest.Mock };
}

function makeContentMock(overrides: Record<string, unknown> = {}) {
  const data = {
    id: '1', type: ContentType.SONGS, title: 'பூ வாசம்', body: 'Content body',
    description: 'A song', author: 'Test Author', status: ContentStatus.PUBLISHED,
    categoryIds: [], tagIds: [], viewCount: 0, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
  return { toObject: () => data };
}

describe('Admin Content API', () => {
  beforeEach(() => {
    const r = getRepo();
    if (r) Object.values(r).forEach(fn => fn.mockReset());
    const u = getUseCase();
    if (u) u.execute.mockReset();
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({ email: 'test@example.com', sub: 'test-user-id' });
  });

  describe('GET /api/admin/content', () => {
    it('should return all content without filters', async () => {
      getRepo().findAll
        .mockResolvedValueOnce({ items: [makeContentMock()], total: 1, limit: 25, hasMore: false })
        .mockResolvedValueOnce({ items: [makeContentMock({ id: '2', status: ContentStatus.DRAFT })], total: 1, limit: 25, hasMore: false });

      const request = new NextRequest('http://localhost:3000/api/admin/content');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(2);
      expect(data.message).toBe('Content retrieved successfully');
    });

    it('should filter by content type', async () => {
      getRepo().findByType.mockResolvedValue({ items: [makeContentMock()], total: 1, limit: 50, hasMore: false });

      const request = new NextRequest('http://localhost:3000/api/admin/content?type=SONGS');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(getRepo().findByType).toHaveBeenCalledWith(ContentType.SONGS, expect.objectContaining({ limit: 50 }));
    });

    it('should filter by status', async () => {
      getRepo().findAll.mockResolvedValue({ items: [], total: 0, limit: 50, hasMore: false });

      const request = new NextRequest('http://localhost:3000/api/admin/content?status=PUBLISHED');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(getRepo().findAll).toHaveBeenCalledWith(expect.objectContaining({ status: ContentStatus.PUBLISHED }));
    });

    it('should support custom limit', async () => {
      const emptyResult = { items: [], total: 0, limit: 10, hasMore: false };
      getRepo().findAll.mockResolvedValueOnce(emptyResult).mockResolvedValueOnce(emptyResult);

      const request = new NextRequest('http://localhost:3000/api/admin/content?limit=10');
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/admin/content');
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(getRepo().findAll).not.toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      getRepo().findAll.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/admin/content');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to fetch content');
    });
  });

  describe('POST /api/admin/content', () => {
    it('should create content with valid data', async () => {
      getUseCase().execute.mockResolvedValue(makeContentMock({ status: ContentStatus.DRAFT }));

      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({
          type: 'SONGS', title: 'பூ வாசம்', body: 'Full content body...',
          description: 'A beautiful song', author: 'Test Author', status: 'DRAFT',
          categoryIds: ['cat1'], tagIds: ['tag1'],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Content created successfully');
      expect(getUseCase().execute).toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({ type: 'SONGS' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
      expect(getUseCase().execute).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid content type', async () => {
      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({ type: 'INVALID_TYPE', title: 'Test', body: 'Test', author: 'Test' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should default status to DRAFT if not provided', async () => {
      getUseCase().execute.mockResolvedValue(makeContentMock({ status: ContentStatus.DRAFT }));

      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({ type: 'SONGS', title: 'Test', body: 'Test body', author: 'Test' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({ type: 'SONGS', title: 'Test', body: 'Test', author: 'Test' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(getUseCase().execute).not.toHaveBeenCalled();
    });
  });
});
