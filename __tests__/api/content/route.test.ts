/**
 * Content API Route Integration Tests
 *
 * Integration tests for /api/content endpoints with authentication
 */

import { NextRequest } from 'next/server';
import { GET, POST, PUT, DELETE } from '@/app/api/content/route';

// Mock auth helper
jest.mock('@/lib/auth-helper', () => ({
  requireAuth: jest.fn(),
  validateAuth: jest.fn(),
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

import { requireAuth } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';

describe('Content API Routes - Authentication', () => {
  let mockContentRepo: jest.Mocked<ContentRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContentRepo = new ContentRepository() as jest.Mocked<ContentRepository>;
  });

  describe('GET /api/content', () => {
    it('should allow public access to GET requests', async () => {
      const mockContent = {
        id: '123',
        type: ContentType.SONGS,
        title: 'பூ வாசம்',
        body: 'பூ வாசம் வந்து என்னை கவர்ந்ததடி',
        author: 'இளையராஜா',
        status: ContentStatus.PUBLISHED,
        toObject: jest.fn().mockReturnValue({
          id: '123',
          type: ContentType.SONGS,
          title: 'பூ வாசம்',
        }),
      };

      mockContentRepo.findById = jest.fn().mockResolvedValue(mockContent);
      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=123')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      // GET should NOT require auth
      expect(requireAuth).not.toHaveBeenCalled();
    });

    it('should return 404 when content not found', async () => {
      mockContentRepo.findById = jest.fn().mockResolvedValue(null);
      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=999')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Content not found');
    });

    it('should return 400 when no id or slug provided', async () => {
      const request = new NextRequest(
        new Request('http://localhost:3000/api/content')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('DELETE /api/content - Protected', () => {
    it('should require authentication for DELETE requests', async () => {
      (requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=123', {
          method: 'DELETE',
        })
      );

      const response = await DELETE(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to delete content', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
        userId: 'admin123',
      });

      mockContentRepo.delete = jest.fn().mockResolvedValue(undefined);
      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=123', {
          method: 'DELETE',
        })
      );

      const response = await DELETE(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockContentRepo.delete).toHaveBeenCalledWith('123');
    });

    it('should return 400 when no id provided for delete', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content', {
          method: 'DELETE',
        })
      );

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Content ID is required');
    });
  });

  describe('PUT /api/content - Protected', () => {
    it('should require authentication for PUT requests', async () => {
      (requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=123', {
          method: 'PUT',
          body: JSON.stringify({ title: 'Updated title' }),
        })
      );

      const response = await PUT(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to update content', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
        userId: 'admin123',
      });

      const mockContent = {
        id: '123',
        type: ContentType.SONGS,
        title: 'Updated பூ வாசம்',
        body: 'Updated content',
        author: 'இளையராஜா',
        status: ContentStatus.PUBLISHED,
        toObject: jest.fn().mockReturnValue({
          id: '123',
          title: 'Updated பூ வாசம்',
        }),
      };

      mockContentRepo.update = jest.fn().mockResolvedValue(mockContent);
      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const updateData = {
        title: 'Updated பூ வாசம்',
        body: 'Updated content',
      };

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=123', {
          method: 'PUT',
          body: JSON.stringify(updateData),
        })
      );

      const response = await PUT(request);
      const data = await response.json();

      expect(requireAuth).toHaveBeenCalledWith(request);
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it('should return 400 when no id provided for update', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({
        isAuthenticated: true,
      });

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content', {
          method: 'PUT',
          body: JSON.stringify({ title: 'Updated' }),
        })
      );

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Content ID is required');
    });
  });

  describe('POST /api/content', () => {
    it('should allow public POST requests (no auth required)', async () => {
      const mockContent = {
        id: 'new123',
        type: ContentType.SONGS,
        title: 'புதிய பாடல்',
        body: 'புதிய பாடல் உள்ளடக்கம்',
        author: 'புதிய ஆசிரியர்',
        status: ContentStatus.DRAFT,
        toObject: jest.fn().mockReturnValue({
          id: 'new123',
          title: 'புதிய பாடல்',
        }),
      };

      mockContentRepo.create = jest.fn().mockResolvedValue(mockContent);
      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const newContent = {
        type: ContentType.SONGS,
        title: 'புதிய பாடல்',
        body: 'புதிய பாடல் உள்ளடக்கம்',
        author: 'புதிய ஆசிரியர்',
        status: ContentStatus.DRAFT,
      };

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content', {
          method: 'POST',
          body: JSON.stringify(newContent),
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      // POST should NOT require auth (public submissions)
      expect(requireAuth).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle repository errors gracefully', async () => {
      mockContentRepo.findById = jest.fn().mockRejectedValue(
        new Error('Database connection error')
      );
      (ContentRepository as jest.Mock).mockImplementation(() => mockContentRepo);

      const request = new NextRequest(
        new Request('http://localhost:3000/api/content?id=123')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Database connection error');
    });

    it('should handle malformed JSON in POST requests', async () => {
      const request = new NextRequest(
        new Request('http://localhost:3000/api/content', {
          method: 'POST',
          body: 'invalid json',
        })
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
