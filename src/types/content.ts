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
  /**
   * Per-song browse theme/category (love | mother | nature | tamil | homeland).
   * Set via /api/admin/songs/[id]/theme; consumed by /songs through
   * themeForSongWithOverride(). Falls back to the SONG_THEME_BY_ID map.
   */
  theme?: string;
}

/**
 * Audio Properties (for Songs and Poems)
 */
export interface AudioProperties {
  audioUrl?: string;
  audioDuration?: number; // in seconds
}

/**
 * Video Properties (for Songs) — typically a YouTube link
 */
export interface VideoProperties {
  videoUrl?: string; // YouTube watch/share/embed URL (full video — viewers are sent here)
  previewVideoUrl?: string; // Short preview clip uploaded to S3 and played on-site
  /**
   * Canonical 11-char YouTube video ID. Optional — when set it's the
   * source of truth for "is this YouTube upload on the site?" matching.
   * When unset, callers can derive it from videoUrl via getYouTubeId().
   */
  youtubeVideoId?: string;
}

/**
 * Studio asset library (Phase 1 of the AI Studio roadmap) — production
 * artefacts beyond the playable MP3. Each is an optional S3 URL; expand
 * to typed arrays later if a song ever needs multiple files of one kind.
 */
export interface StudioAssets {
  wavUrl?: string;       // Master WAV
  stemsUrl?: string;     // Stems bundle (zip of vocals/drums/bass/etc.)
  midiUrl?: string;      // MIDI source
  thumbnailUrl?: string; // YouTube-style 1280x720 still (distinct from featuredImage)
}

/**
 * Production lifecycle — 9 sequential states. Stored on Content as a string
 * so we can extend without a migration; the union below is the source of
 * truth for valid values and ordering.
 */
export const WORKFLOW_STATES = [
  'draft',
  'lyrics_complete',
  'ai_reviewed',
  'music_generated',
  'midi_reviewed',
  'stems_uploaded',
  'video_created',
  'published_youtube',
  'published_site',
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/** Human-readable column headers for the /admin/workflow kanban. */
export const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  draft: 'Draft',
  lyrics_complete: 'Lyrics',
  ai_reviewed: 'AI Review',
  music_generated: 'Music',
  midi_reviewed: 'MIDI',
  stems_uploaded: 'Stems',
  video_created: 'Video',
  published_youtube: 'YouTube',
  published_site: 'Live',
};

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
    VideoProperties,
    StudioAssets,
    ContentStatistics {
  body: string; // Main content in Tamil
  publishedAt?: Date;
  categoryIds: string[];
  tagIds: string[];
  /** Studio production-pipeline state; undefined on legacy rows. */
  workflowState?: WorkflowState;
}

/**
 * Content Creation DTO (Data Transfer Object)
 */
export interface CreateContentDTO {
  type: ContentType;
  title: string;
  /** Pre-computed unique slug. When omitted, the entity derives one from the title. */
  slug?: string;
  body: string;
  description: string;
  author: string;
  featuredImage?: string;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  previewVideoUrl?: string;
  youtubeVideoId?: string;
  wavUrl?: string;
  stemsUrl?: string;
  midiUrl?: string;
  thumbnailUrl?: string;
  workflowState?: WorkflowState;
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
  videoUrl?: string | null;
  previewVideoUrl?: string | null;
  youtubeVideoId?: string | null;
  wavUrl?: string | null;
  stemsUrl?: string | null;
  midiUrl?: string | null;
  thumbnailUrl?: string | null;
  workflowState?: WorkflowState | null;
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
