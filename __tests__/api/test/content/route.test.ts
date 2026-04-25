/** @jest-environment node */
/**
 * Test Content API Route Integration Tests
 *
 * Integration tests for /api/test/content endpoints with authentication
 */

import { NextRequest } from 'next/server';
import { ContentType, ContentStatus } from '@/types/content';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAuth: jest.fn(),
}));

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockReturnValue({
    findAll: jest.fn(),
    findByType: jest.fn(),
    countByType: jest.fn(),
    countByStatus: jest.fn(),
    getMostViewed: jest.fn(),
    getRecentlyPublished: jest.fn(),
    create: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({
  CategoryRepository: jest.fn().mockReturnValue({
    findAll: jest.fn(),
    create: jest.fn(),
  }),
}));
jest.mock('@/infrastructure/database/TagRepository', () => ({
  TagRepository: jest.fn().mockReturnValue({
    findAll: jest.fn(),
    create: jest.fn(),
  }),
}));
jest.mock('@/application/use-cases/CreateContentUseCase', () => ({
  CreateContentUseCase: jest.fn().mockReturnValue({ execute: jest.fn() }),
}));
jest.mock('@/application/use-cases/GetContentUseCase', () => ({
  GetContentUseCase: jest.fn().mockReturnValue({ execute: jest.fn() }),
}));

import { GET, POST } from '@/app/api/test/content/route';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import * as authHelper from '@/lib/auth-helper';

const MockContentRepo = ContentRepository as jest.MockedClass<typeof ContentRepository>;
const MockCategoryRepo = CategoryRepository as jest.MockedClass<typeof CategoryRepository>;
const MockTagRepo = TagRepository as jest.MockedClass<typeof TagRepository>;
const MockCreateUseCase = CreateContentUseCase as jest.MockedClass<typeof CreateContentUseCase>;

function getContentRepo() {
  return MockContentRepo.mock.results[0]?.value as {
    findAll: jest.Mock; findByType: jest.Mock; countByType: jest.Mock;
    countByStatus: jest.Mock; getMostViewed: jest.Mock; getRecentlyPublished: jest.Mock; create: jest.Mock;
  };
}
function getCategoryRepo() {
  return MockCategoryRepo.mock.results[0]?.value as { findAll: jest.Mock; create: jest.Mock };
}
function getTagRepo() {
  return MockTagRepo.mock.results[0]?.value as { findAll: jest.Mock; create: jest.Mock };
}
function getCreateUseCase() {
  return MockCreateUseCase.mock.results[0]?.value as { execute: jest.Mock };
}

describe('Test Content API Routes - Authentication', () => {
  beforeEach(() => {
    const cr = getContentRepo();
    if (cr) Object.values(cr).forEach(fn => fn.mockReset());
    const catr = getCategoryRepo();
    if (catr) Object.values(catr).forEach(fn => fn.mockReset());
    const tr = getTagRepo();
    if (tr) Object.values(tr).forEach(fn => fn.mockReset());
    const uc = getCreateUseCase();
    if (uc) uc.execute.mockReset();
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({ isAuthenticated: true, userId: 'admin123' });
  });

  describe('GET /api/test/content - Protected', () => {
    it('should require authentication for all GET requests', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=list')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(authHelper.requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to list content', async () => {
      const mockItem = { id: '1', type: ContentType.SONGS, title: 'பூ வாசம்', status: ContentStatus.PUBLISHED };
      getContentRepo().findAll.mockResolvedValue({ items: [mockItem], total: 1, limit: 50, offset: 0, hasMore: false });

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=list')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(authHelper.requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(1);
      expect(data.message).toBe('Successfully retrieved content list');
    });

    it('should allow authenticated users to get content by type', async () => {
      getContentRepo().findByType.mockResolvedValue([
        { id: '1', type: ContentType.SONGS, title: 'பூ வாசம்' },
      ]);

      const request = new NextRequest(
        new Request(`http://localhost:3000/api/test/content?action=by-type&type=${ContentType.SONGS}`)
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(getContentRepo().findByType).toHaveBeenCalledWith(ContentType.SONGS, { limit: 10 });
    });

    it('should allow authenticated users to get stats', async () => {
      getContentRepo().countByType.mockResolvedValue(5);
      getContentRepo().countByStatus.mockResolvedValue(10);
      getContentRepo().getMostViewed.mockResolvedValue([]);
      getContentRepo().getRecentlyPublished.mockResolvedValue([]);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=stats')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('songs');
      expect(data.data).toHaveProperty('published');
      expect(data.data).toHaveProperty('mostViewed');
    });

    it('should allow authenticated users to get categories', async () => {
      getCategoryRepo().findAll.mockResolvedValue([
        { id: '1', name: 'தமிழ் பாடல்கள்' },
      ]);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=categories')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully retrieved categories');
    });

    it('should allow authenticated users to get tags', async () => {
      getTagRepo().findAll.mockResolvedValue([{ id: '1', name: 'காதல்' }]);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=tags')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully retrieved tags');
    });

    it('should return 400 for missing parameters', async () => {
      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Please provide id, slug, or action parameter');
    });
  });

  describe('POST /api/test/content - Protected', () => {
    it('should require authentication for all POST requests', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({ action: 'create-content' }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(authHelper.requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to create content', async () => {
      const mockContent = {
        id: 'new123',
        type: ContentType.SONGS,
        title: 'பூ வாசம்',
        toObject: jest.fn().mockReturnValue({ id: 'new123', title: 'பூ வாசம்' }),
      };

      getCreateUseCase().execute.mockResolvedValue(mockContent);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create-content',
            type: ContentType.SONGS,
            title: 'பூ வாசம்',
            body: 'பூ வாசம் வந்து என்னை கவர்ந்ததடி',
            author: 'இளையராஜா',
            status: ContentStatus.PUBLISHED,
          }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(authHelper.requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully created content');
    });

    it('should allow authenticated users to create category', async () => {
      const mockCategory = { id: 'cat123', name: 'தமிழ் பாடல்கள்', slug: 'tamil-songs' };
      getCategoryRepo().create.mockResolvedValue(mockCategory);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({ action: 'create-category', name: 'தமிழ் பாடல்கள்' }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully created category');
    });

    it('should allow authenticated users to create tag', async () => {
      const mockTag = { id: 'tag123', name: 'காதல்', slug: 'love' };
      getTagRepo().create.mockResolvedValue(mockTag);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({ action: 'create-tag', name: 'காதல்' }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully created tag');
    });

    it('should return 400 for invalid action', async () => {
      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({ action: 'invalid-action' }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid action');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in GET requests', async () => {
      getContentRepo().findAll.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=list')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Database error');
    });

    it('should handle errors in POST requests', async () => {
      getCategoryRepo().create.mockRejectedValue(new Error('Creation failed'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({ action: 'create-category', name: 'Test' }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Creation failed');
    });
  });
});
