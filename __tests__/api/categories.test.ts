/**
 * Unit Tests for Categories API
 */

import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/categories/route';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import * as authHelper from '@/lib/auth-helper';

// Mock dependencies
jest.mock('@/infrastructure/database/CategoryRepository');
jest.mock('@/lib/auth-helper');

describe('Categories API', () => {
  let mockCategoryRepo: jest.Mocked<CategoryRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCategoryRepo = new CategoryRepository() as jest.Mocked<CategoryRepository>;

    // Mock successful authentication by default
    (authHelper.requireAuth as jest.Mock).mockResolvedValue({
      email: 'test@example.com',
      sub: 'test-user-id',
    });
  });

  describe('GET /api/categories', () => {
    it('should return all categories when authenticated', async () => {
      const mockCategories = [
        {
          id: '1',
          name: 'தமிழ் பாடல்கள்',
          slug: 'tamil-songs',
          description: 'Tamil songs collection',
          contentCount: 5,
          createdAt: new Date('2025-01-01'),
        },
        {
          id: '2',
          name: 'கவிதைகள்',
          slug: 'poems',
          description: 'Poems collection',
          contentCount: 3,
          createdAt: new Date('2025-01-02'),
        },
      ];

      mockCategoryRepo.findAll.mockResolvedValue(mockCategories);

      const request = new NextRequest('http://localhost:3000/api/categories');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockCategories);
      expect(data.message).toBe('Categories retrieved successfully');
      expect(mockCategoryRepo.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/categories');
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(mockCategoryRepo.findAll).not.toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      mockCategoryRepo.findAll.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/categories');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to fetch categories');
    });
  });

  describe('POST /api/categories', () => {
    it('should create category with valid data', async () => {
      const mockCategory = {
        id: '1',
        name: 'தமிழ் பாடல்கள்',
        slug: 'tamil-songs',
        description: 'Tamil songs',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockCategoryRepo.create.mockResolvedValue(mockCategory);

      const request = new NextRequest('http://localhost:3000/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: 'தமிழ் பாடல்கள்',
          description: 'Tamil songs',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockCategory);
      expect(data.message).toBe('Category created successfully');
    });

    it('should auto-generate slug if not provided', async () => {
      const mockCategory = {
        id: '1',
        name: 'கவிதைகள்',
        slug: 'kavidhaikal',
        description: '',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockCategoryRepo.create.mockResolvedValue(mockCategory);

      const request = new NextRequest('http://localhost:3000/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: 'கவிதைகள்',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should return 400 for invalid data', async () => {
      const request = new NextRequest('http://localhost:3000/api/categories', {
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
      expect(mockCategoryRepo.create).not.toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      (authHelper.requireAuth as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const request = new NextRequest('http://localhost:3000/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockCategoryRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/categories', () => {
    it('should delete category by ID', async () => {
      const mockCategory = {
        id: '1',
        name: 'தமிழ் பாடல்கள்',
        slug: 'tamil-songs',
        description: '',
        contentCount: 0,
        createdAt: new Date(),
      };

      mockCategoryRepo.findById.mockResolvedValue(mockCategory);
      mockCategoryRepo.delete.mockResolvedValue(undefined);

      const request = new NextRequest('http://localhost:3000/api/categories?id=1', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Category deleted successfully');
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith('1');
    });

    it('should return 404 if category not found', async () => {
      mockCategoryRepo.findById.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/categories?id=999', {
        method: 'DELETE',
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Category not found');
      expect(mockCategoryRepo.delete).not.toHaveBeenCalled();
    });

    it('should return 400 if ID not provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/categories', {
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

      const request = new NextRequest('http://localhost:3000/api/categories?id=1', {
        method: 'DELETE',
      });

      const response = await DELETE(request);

      expect(response.status).toBe(401);
      expect(mockCategoryRepo.delete).not.toHaveBeenCalled();
    });
  });
});
