/**
 * Unit Tests for Admin Content API
 */

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/content/route';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';
import { ContentEntity } from '@/domain/entities/Content';
import * as authHelper from '@/lib/auth-helper';

// Mock dependencies
jest.mock('@/infrastructure/database/ContentRepository');
jest.mock('@/infrastructure/database/CategoryRepository');
jest.mock('@/infrastructure/database/TagRepository');
jest.mock('@/application/use-cases/CreateContentUseCase');
jest.mock('@/lib/auth-helper');

describe('Admin Content API', () => {
  let mockContentRepo: jest.Mocked<ContentRepository>;
  let mockCreateContentUseCase: jest.Mocked<CreateContentUseCase>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContentRepo = new ContentRepository() as jest.Mocked<ContentRepository>;
    mockCreateContentUseCase = new CreateContentUseCase(
      mockContentRepo,
      {} as CategoryRepository,
      {} as TagRepository
    ) as jest.Mocked<CreateContentUseCase>;

    // Mock successful authentication by default
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({
      email: 'test@example.com',
      sub: 'test-user-id',
    });
  });

  describe('GET /api/admin/content', () => {
    it('should return all content without filters', async () => {
      const mockPublished = {
        items: [
          new ContentEntity({
            id: '1',
            type: ContentType.SONGS,
            title: 'பூ வாசம்',
            body: 'Content...',
            description: 'A song',
            author: 'Test Author',
            status: ContentStatus.PUBLISHED,
            categoryIds: [],
            tagIds: [],
            viewCount: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ],
        total: 1,
        limit: 25,
        hasMore: false,
      };

      const mockDraft = {
        items: [
          new ContentEntity({
            id: '2',
            type: ContentType.POEMS,
            title: 'கவிதை',
            body: 'Content...',
            description: 'A poem',
            author: 'Test Author',
            status: ContentStatus.DRAFT,
            categoryIds: [],
            tagIds: [],
            viewCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ],
        total: 1,
        limit: 25,
        hasMore: false,
      };

      mockContentRepo.findAll
        .mockResolvedValueOnce(mockPublished)
        .mockResolvedValueOnce(mockDraft);

      const request = new NextRequest('http://localhost:3000/api/admin/content');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(2);
      expect(data.message).toBe('Content retrieved successfully');
    });

    it('should filter by content type', async () => {
      const mockResult = {
        items: [
          new ContentEntity({
            id: '1',
            type: ContentType.SONGS,
            title: 'பூ வாசம்',
            body: 'Content...',
            description: 'A song',
            author: 'Test',
            status: ContentStatus.PUBLISHED,
            categoryIds: [],
            tagIds: [],
            viewCount: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ],
        total: 1,
        limit: 50,
        hasMore: false,
      };

      mockContentRepo.findByType.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/admin/content?type=SONGS');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockContentRepo.findByType).toHaveBeenCalledWith(
        ContentType.SONGS,
        expect.objectContaining({ limit: 50 })
      );
    });

    it('should filter by status', async () => {
      const mockResult = {
        items: [],
        total: 0,
        limit: 50,
        hasMore: false,
      };

      mockContentRepo.findAll.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/admin/content?status=PUBLISHED');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockContentRepo.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ContentStatus.PUBLISHED,
        })
      );
    });

    it('should support custom limit', async () => {
      const mockResult = {
        items: [],
        total: 0,
        limit: 10,
        hasMore: false,
      };

      mockContentRepo.findAll
        .mockResolvedValueOnce(mockResult)
        .mockResolvedValueOnce(mockResult);

      const request = new NextRequest('http://localhost:3000/api/admin/content?limit=10');
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/admin/content');
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(mockContentRepo.findAll).not.toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      mockContentRepo.findAll.mockRejectedValue(new Error('Database error'));

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
      const mockContent = new ContentEntity({
        id: '1',
        type: ContentType.SONGS,
        title: 'பூ வாசம்',
        body: 'Full content body...',
        description: 'A beautiful song',
        author: 'Test Author',
        status: ContentStatus.DRAFT,
        categoryIds: ['cat1'],
        tagIds: ['tag1'],
        viewCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockCreateContentUseCase.execute.mockResolvedValue(mockContent);

      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({
          type: 'SONGS',
          title: 'பூ வாசம்',
          body: 'Full content body...',
          description: 'A beautiful song',
          author: 'Test Author',
          status: 'DRAFT',
          categoryIds: ['cat1'],
          tagIds: ['tag1'],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Content created successfully');
      expect(mockCreateContentUseCase.execute).toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({
          type: 'SONGS',
          // Missing title, body, author
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
      expect(mockCreateContentUseCase.execute).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid content type', async () => {
      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({
          type: 'INVALID_TYPE',
          title: 'Test',
          body: 'Test',
          author: 'Test',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should default status to DRAFT if not provided', async () => {
      const mockContent = new ContentEntity({
        id: '1',
        type: ContentType.SONGS,
        title: 'Test',
        body: 'Test body',
        description: '',
        author: 'Test',
        status: ContentStatus.DRAFT,
        categoryIds: [],
        tagIds: [],
        viewCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockCreateContentUseCase.execute.mockResolvedValue(mockContent);

      const request = new NextRequest('http://localhost:3000/api/admin/content', {
        method: 'POST',
        body: JSON.stringify({
          type: 'SONGS',
          title: 'Test',
          body: 'Test body',
          author: 'Test',
          // No status provided
        }),
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
        body: JSON.stringify({
          type: 'SONGS',
          title: 'Test',
          body: 'Test',
          author: 'Test',
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockCreateContentUseCase.execute).not.toHaveBeenCalled();
    });
  });
});
