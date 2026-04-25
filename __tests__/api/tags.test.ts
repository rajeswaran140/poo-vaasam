/** @jest-environment node */
/**
 * Unit Tests for Tags API
 */

import { NextRequest } from 'next/server';

jest.mock('@/infrastructure/database/TagRepository', () => ({
  TagRepository: jest.fn().mockReturnValue({
    findAll: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findById: jest.fn(),
  }),
}));

// Partial mock: keep unauthorizedResponse real, only mock requireAuth
jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAuth: jest.fn(),
}));

import { GET, POST, DELETE } from '@/app/api/tags/route';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import * as authHelper from '@/lib/auth-helper';

const MockTagRepo = TagRepository as jest.MockedClass<typeof TagRepository>;

function getRepo() {
  return MockTagRepo.mock.results[0]?.value as {
    findAll: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    findById: jest.Mock;
  };
}

describe('Tags API', () => {
  beforeEach(() => {
    const r = getRepo();
    if (r) Object.values(r).forEach(fn => fn.mockReset());
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({ email: 'test@example.com', sub: 'test-user-id' });
  });

  describe('GET /api/tags', () => {
    it('should return all tags when authenticated', async () => {
      const mockTags = [
        { id: '1', name: 'காதல்', slug: 'love', contentCount: 10, createdAt: new Date('2025-01-01') },
        { id: '2', name: 'இயற்கை', slug: 'nature', contentCount: 5, createdAt: new Date('2025-01-02') },
      ];

      getRepo().findAll.mockResolvedValue(mockTags);

      const request = new NextRequest('http://localhost:3000/api/tags');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Dates serialize to strings through JSON, compare without createdAt
      expect(data.data).toHaveLength(2);
      expect(data.data[0].id).toBe('1');
      expect(data.data[1].id).toBe('2');
      expect(data.message).toBe('Tags retrieved successfully');
      expect(getRepo().findAll).toHaveBeenCalledTimes(1);
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/tags');
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(getRepo().findAll).not.toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      getRepo().findAll.mockRejectedValue(new Error('Database error'));

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
      const mockTag = { id: '1', name: 'காதல்', slug: 'love', contentCount: 0, createdAt: new Date() };
      getRepo().create.mockResolvedValue(mockTag);

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: 'காதல்' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('1');
      expect(data.data.name).toBe('காதல்');
      expect(data.data.slug).toBe('love');
      expect(data.message).toBe('Tag created successfully');
    });

    it('should auto-generate slug if not provided', async () => {
      getRepo().create.mockResolvedValue({ id: '1', name: 'இயற்கை', slug: 'iyarkai', contentCount: 0, createdAt: new Date() });

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: 'இயற்கை' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should accept custom slug', async () => {
      getRepo().create.mockResolvedValue({ id: '1', name: 'Love', slug: 'custom-love', contentCount: 0, createdAt: new Date() });

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: 'Love', slug: 'custom-love' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should return 400 for invalid data', async () => {
      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
      expect(getRepo().create).not.toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(getRepo().create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/tags', () => {
    it('should delete tag by ID', async () => {
      const mockTag = { id: '1', name: 'காதல்', slug: 'love', contentCount: 0, createdAt: new Date() };
      getRepo().findById.mockResolvedValue(mockTag);
      getRepo().delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/tags?id=1', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Tag deleted successfully');
      expect(getRepo().delete).toHaveBeenCalledWith('1');
    });

    it('should return 404 if tag not found', async () => {
      getRepo().findById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/tags?id=999', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Tag not found');
      expect(getRepo().delete).not.toHaveBeenCalled();
    });

    it('should return 400 if ID not provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/tags', { method: 'DELETE' });
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/tags?id=1', { method: 'DELETE' });
      const response = await DELETE(request);

      expect(response.status).toBe(401);
      expect(getRepo().delete).not.toHaveBeenCalled();
    });
  });
});
