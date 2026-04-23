/**
 * Content Type Definitions
 *
 * TypeScript types and interfaces for content management
 */

import type { Content as ContentEntity } from '@/domain/entities/Content';

/**
 * Content Types
 */
export enum ContentType {
  LYRICS = 'LYRICS',
  SONGS = 'SONGS',
  POEMS = 'POEMS',
  STORIES = 'STORIES',
  ESSAYS = 'ESSAYS',
}

/**
 * Content Status
 */
export enum ContentStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Base Content Properties
 */
export interface BaseContent {
  id: string;
  type: ContentType;
  status: ContentStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Content Metadata
 */
export interface ContentMetadata {
  title: string;
  titleSlug: string;
  description: string;
  author: string;
  featuredImage?: string;
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Audio Properties (for Songs and Poems)
 */
export interface AudioProperties {
  audioUrl?: string;
  audioDuration?: number; // in seconds
}

/**
 * Statistics
 */
export interface ContentStatistics {
  viewCount: number;
  averageRating?: number;
  totalRatings?: number;
  totalComments?: number;
}

/**
 * Complete Content Entity
 */
export interface Content
  extends BaseContent,
    ContentMetadata,
    AudioProperties,
    ContentStatistics {
  body: string; // Main content in Tamil
  publishedAt?: Date;
  categoryIds: string[];
  tagIds: string[];
}

/**
 * Content Creation DTO (Data Transfer Object)
 */
export interface CreateContentDTO {
  type: ContentType;
  title: string;
  body: string;
  description: string;
  author: string;
  featuredImage?: string;
  audioUrl?: string;
  audioDuration?: number;
  categoryIds?: string[];
  tagIds?: string[];
  status?: ContentStatus;
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Content Update DTO
 */
export interface UpdateContentDTO {
  title?: string;
  body?: string;
  description?: string;
  author?: string;
  featuredImage?: string | null;
  audioUrl?: string | null;
  audioDuration?: number | null;
  categoryIds?: string[];
  tagIds?: string[];
  status?: ContentStatus;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

/**
 * Content Query Options
 */
export interface ContentQueryOptions {
  type?: ContentType;
  status?: ContentStatus;
  categoryId?: string;
  tagId?: string;
  limit?: number;
  offset?: number; // Deprecated: Use lastEvaluatedKey for cursor-based pagination
  lastEvaluatedKey?: Record<string, any>; // DynamoDB cursor for pagination
  sortBy?: 'createdAt' | 'publishedAt' | 'viewCount' | 'averageRating';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated Content Response
 */
export interface PaginatedContent {
  items: ContentEntity[];
  total: number;
  limit: number;
  offset?: number; // Deprecated: for backward compatibility
  lastEvaluatedKey?: Record<string, any>; // DynamoDB cursor for next page
  hasMore: boolean;
}

/**
 * Content with Relations (includes category and tag details)
 */
export interface ContentWithRelations extends Content {
  categories: Category[];
  tags: Tag[];
}

/**
 * Category Type
 */
export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  contentCount: number;
  createdAt: Date;
}

/**
 * Tag Type
 */
export interface Tag {
  id: string;
  name: string;
  slug: string;
  contentCount: number;
  createdAt: Date;
}

/**
 * Comment Type
 */
export interface Comment {
  id: string;
  contentId: string;
  userId: string;
  userName: string;
  userEmail: string;
  body: string;
  status: CommentStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Comment Status
 */
export enum CommentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Rating Type
 */
export interface Rating {
  contentId: string;
  userId: string;
  rating: number; // 1-5
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Rating Summary
 */
export interface RatingSummary {
  contentId: string;
  averageRating: number;
  totalRatings: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

/**
 * User Type
 */
export interface User {
  id: string;
  cognitoId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  lastLoginAt?: Date;
}

/**
 * User Role
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

/**
 * Media Upload Response
 */
export interface MediaUploadResponse {
  url: string;
  key: string;
  bucket: string;
  size: number;
  mimeType: string;
}

/**
 * Search Query
 */
export interface SearchQuery {
  q: string; // Search query
  type?: ContentType;
  limit?: number;
  offset?: number;
}

/**
 * Search Result
 */
export interface SearchResult {
  content: Content;
  relevance: number; // 0-1
  highlights?: {
    title?: string;
    body?: string;
  };
}
