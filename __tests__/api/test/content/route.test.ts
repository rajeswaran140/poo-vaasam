/**
 * Test Content API Route Integration Tests
 *
 * Integration tests for /api/test/content endpoints with authentication
 */

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/test/content/route';
import { ContentType, ContentStatus } from '@/types/content';

// Mock auth helper
jest.mock('@/lib/auth-helper', () => ({
  requireAuth: jest.fn(),
  unauthorizedResponse: jest.fn(() =>
    new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

// Mock repositories
jest.mock('@/infrastructure/database/ContentRepository');
jest.mock('@/infrastructure/database/CategoryRepository');
jest.mock('@/infrastructure/database/TagRepository');

// Mock use cases
jest.mock('@/application/use-cases/CreateContentUseCase');
jest.mock('@/application/use-cases/GetContentUseCase');

import { requireAuth } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';

describe('Test Content API Routes - Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/test/content - Protected', () => {
    it('should require authentication for all GET requests', async () => {
      (requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=list')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to list content', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
        userId: 'admin123',
      });

      const mockContentRepo = {
        findAll: jest.fn().mockResolvedValue([
          {
            id: '1',
            type: ContentType.SONGS,
            title: 'பூ வாசம்',
            status: ContentStatus.PUBLISHED,
          },
        ]),
      };

      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content?action=list')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.message).toBe('Successfully retrieved content list');
    });

    it('should allow authenticated users to get content by type', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockContentRepo = {
        findByType: jest.fn().mockResolvedValue([
          {
            id: '1',
            type: ContentType.SONGS,
            title: 'பூ வாசம்',
          },
        ]),
      };

      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const request = new NextRequest(
        new Request(
          `http://localhost:3000/api/test/content?action=by-type&type=${ContentType.SONGS}`
        )
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockContentRepo.findByType).toHaveBeenCalledWith(
        ContentType.SONGS,
        { limit: 10 }
      );
    });

    it('should allow authenticated users to get stats', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockContentRepo = {
        countByType: jest.fn().mockResolvedValue(5),
        countByStatus: jest.fn().mockResolvedValue(10),
        getMostViewed: jest.fn().mockResolvedValue([]),
        getRecentlyPublished: jest.fn().mockResolvedValue([]),
      };

      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

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
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockCategoryRepo = {
        findAll: jest.fn().mockResolvedValue([
          { id: '1', name: 'தமிழ் பாடல்கள்' },
        ]),
      };

      (CategoryRepository as jest.Mock).mockImplementation(
        () => mockCategoryRepo
      );

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
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockTagRepo = {
        findAll: jest.fn().mockResolvedValue([{ id: '1', name: 'காதல்' }]),
      };

      (TagRepository as jest.Mock).mockImplementation(() => mockTagRepo);

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
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

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
      (requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({ action: 'create-content' }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to create content', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
        userId: 'admin123',
      });

      const mockContent = {
        id: 'new123',
        type: ContentType.SONGS,
        title: 'பூ வாசம்',
        toObject: jest.fn().mockReturnValue({
          id: 'new123',
          title: 'பூ வாசம்',
        }),
      };

      const mockCreateUseCase = {
        execute: jest.fn().mockResolvedValue(mockContent),
      };

      // Mock the use case constructor
      const CreateContentUseCase = require('@/application/use-cases/CreateContentUseCase').CreateContentUseCase;
      CreateContentUseCase.mockImplementation(() => mockCreateUseCase);

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

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully created content');
    });

    it('should allow authenticated users to create category', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockCategory = {
        id: 'cat123',
        name: 'தமிழ் பாடல்கள்',
        slug: 'tamil-songs',
      };

      const mockCategoryRepo = {
        create: jest.fn().mockResolvedValue(mockCategory),
      };

      (CategoryRepository as jest.Mock).mockImplementation(
        () => mockCategoryRepo
      );

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create-category',
            name: 'தமிழ் பாடல்கள்',
          }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully created category');
    });

    it('should allow authenticated users to create tag', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockTag = {
        id: 'tag123',
        name: 'காதல்',
        slug: 'love',
      };

      const mockTagRepo = {
        create: jest.fn().mockResolvedValue(mockTag),
      };

      (TagRepository as jest.Mock).mockImplementation(() => mockTagRepo);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create-tag',
            name: 'காதல்',
          }),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Successfully created tag');
    });

    it('should return 400 for invalid action', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({
            action: 'invalid-action',
          }),
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
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockContentRepo = {
        findAll: jest.fn().mockRejectedValue(new Error('Database error')),
      };

      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

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
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const mockCategoryRepo = {
        create: jest.fn().mockRejectedValue(new Error('Creation failed')),
      };

      (CategoryRepository as jest.Mock).mockImplementation(
        () => mockCategoryRepo
      );

      const request = new NextRequest(
        new Request('http://localhost:3000/api/test/content', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create-category',
            name: 'Test',
          }),
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
