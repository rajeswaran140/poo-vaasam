/**
 * Unit Tests for Tags API
 */

import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/tags/route';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import * as authHelper from '@/lib/auth-helper';

// Mock dependencies
jest.mock('@/infrastructure/database/TagRepository');
jest.mock('@/lib/auth-helper');

describe('Tags API', () => {
  let mockTagRepo: jest.Mocked<TagRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTagRepo = new TagRepository() as jest.Mocked<TagRepository>;

    // Mock successful authentication by default
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({
      email: 'test@example.com',
      sub: 'test-user-id',
    });
  });

  describe('GET /api/tags', () => {
    it('should return all tags when authenticated', async () => {
      const mockTags = [
        {
          id: '1',
          name: 'காதல்',
          slug: 'love',
          contentCount: 10,
          createdAt: new Date('2025-01-01'),
        },
        {
          id: '2',
          name: 'இயற்கை',
          slug: 'nature',
          contentCount: 5,
          createdAt: new Date('2025-01-02'),
        },
      ];

      mockTagRepo.findAll.mockResolvedValue(mockTags);

      const request = new NextRequest('http://localhost:3000/api/tags');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockTags);
      expect(data.message).toBe('Tags retrieved successfully');
      expect(mockTagRepo.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/tags');
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(mockTagRepo.findAll).not.toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      mockTagRepo.findAll.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/tags');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to fetch tags');
    });
  });

  describe('POST /api/tags', () => {
    it('should create tag with valid data', async () => {
      const mockTag = {
        id: '1',
        name: 'காதல்',
        slug: 'love',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockTagRepo.create.mockResolvedValue(mockTag);

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({
          name: 'காதல்',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockTag);
      expect(data.message).toBe('Tag created successfully');
    });

    it('should auto-generate slug if not provided', async () => {
      const mockTag = {
        id: '1',
        name: 'இயற்கை',
        slug: 'iyarkai',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockTagRepo.create.mockResolvedValue(mockTag);

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({
          name: 'இயற்கை',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should accept custom slug', async () => {
      const mockTag = {
        id: '1',
        name: 'Love',
        slug: 'custom-love',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockTagRepo.create.mockResolvedValue(mockTag);

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Love',
          slug: 'custom-love',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should return 400 for invalid data', async () => {
      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({
          name: '', // Empty name
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
      expect(mockTagRepo.create).not.toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockTagRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/tags', () => {
    it('should delete tag by ID', async () => {
      const mockTag = {
        id: '1',
        name: 'காதல்',
        slug: 'love',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockTagRepo.findById.mockResolvedValue(mockTag);
      mockTagRepo.delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/tags?id=1', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Tag deleted successfully');
      expect(mockTagRepo.delete).toHaveBeenCalledWith('1');
    });

    it('should return 404 if tag not found', async () => {
      mockTagRepo.findById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/tags?id=999', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Tag not found');
      expect(mockTagRepo.delete).not.toHaveBeenCalled();
    });

    it('should return 400 if ID not provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/tags?id=1', {
        method: 'DELETE',
      });

      const response = await DELETE(request);

      expect(response.status).toBe(401);
      expect(mockTagRepo.delete).not.toHaveBeenCalled();
    });
  });
});
