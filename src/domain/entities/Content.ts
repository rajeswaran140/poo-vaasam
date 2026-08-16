/**
 * Content Entity (Aggregate Root)
 *
 * Domain-Driven Design: This is an aggregate root that encapsulates
 * all business logic related to content management.
 */

import {
  ContentType,
  ContentStatus,
  WORKFLOW_STATES,
  type CreateContentDTO,
  type UpdateContentDTO,
  type WorkflowState,
  type EmotionAnalysis,
} from '@/types/content';
import { generateSlug } from '@/lib/utils/slug';
import { Lyrics } from '@/domain/songs/Lyrics';

/**
 * Content Domain Entity
 *
 * Represents a piece of Tamil content (lyrics, song, poem, story, or essay)
 */
export class Content {
  private constructor(
    public readonly id: string,
    public readonly type: ContentType,
    private _title: string,
    private _titleSlug: string,
    private _body: string,
    private _description: string,
    private _author: string,
    private _status: ContentStatus,
    private _featuredImage: string | undefined,
    private _audioUrl: string | undefined,
    private _audioDuration: number | undefined,
    private _categoryIds: string[],
    private _tagIds: string[],
    private _viewCount: number,
    private _seoTitle: string | undefined,
    private _seoDescription: string | undefined,
    public readonly createdAt: Date,
    private _updatedAt: Date,
    private _publishedAt: Date | undefined,
    private _videoUrl: string | undefined = undefined,
    private _previewVideoUrl: string | undefined = undefined,
    private _youtubeVideoId: string | undefined = undefined,
    private _wavUrl: string | undefined = undefined,
    private _stemsUrl: string | undefined = undefined,
    private _midiUrl: string | undefined = undefined,
    private _thumbnailUrl: string | undefined = undefined,
    private _workflowState: WorkflowState | undefined = undefined,
    // Per-song browse theme/category (love | mother | nature | tamil | homeland).
    // Set by /api/admin/songs/[id]/theme; read by /songs via themeForSongWithOverride.
    private _theme: string | undefined = undefined,
    // Precomputed poem emotion analysis (music/TTS params). Set at publish time
    // via the admin analyze endpoint; read by PoemReader so the LLM never runs
    // in the visitor path. Undefined on legacy/un-backfilled rows.
    private _emotionAnalysis: EmotionAnalysis | undefined = undefined,
    // Structured lyrics (sections → lines, optional romanisation + timestamps).
    // Feeds YouTube caption generation. Defaults to empty so legacy rows (lyrics
    // in the `body` blob, or none at all) reconstruct fine.
    //
    // ⚠️ STORED, NOT PUBLISHED. Raj's standing instruction is that lyrics are not
    // displayed on the site. This field exists so a caption track can be built
    // from them; nothing in the public projection reads it, and PublicSongDTO
    // carries no lyrics at all.
    //
    // NOT to be confused with the email-gated lyrics feature, which is a
    // SEPARATE mechanism: it serves the free-text `body` behind an admin
    // `showLyrics` flag plus a signed gate cookie (/api/lyrics/[id]). These
    // structured lyrics are never routed there.
    private _lyrics: Lyrics = Lyrics.empty()
  ) {}

  // Getters
  get theme(): string | undefined {
    return this._theme;
  }

  get emotionAnalysis(): EmotionAnalysis | undefined {
    return this._emotionAnalysis;
  }

  /** Attach a precomputed emotion analysis (idempotent overwrite). */
  setEmotionAnalysis(analysis: EmotionAnalysis): void {
    this._emotionAnalysis = analysis;
    this._updatedAt = new Date();
  }

  /** Structured lyrics value object (empty when the song has none yet). */
  get lyrics(): Lyrics {
    return this._lyrics;
  }

  get title(): string {
    return this._title;
  }

  get titleSlug(): string {
    return this._titleSlug;
  }

  get body(): string {
    return this._body;
  }

  get description(): string {
    return this._description;
  }

  get author(): string {
    return this._author;
  }

  get status(): ContentStatus {
    return this._status;
  }

  get featuredImage(): string | undefined {
    return this._featuredImage;
  }

  get audioUrl(): string | undefined {
    return this._audioUrl;
  }

  get audioDuration(): number | undefined {
    return this._audioDuration;
  }

  get videoUrl(): string | undefined {
    return this._videoUrl;
  }

  get previewVideoUrl(): string | undefined {
    return this._previewVideoUrl;
  }

  get youtubeVideoId(): string | undefined {
    return this._youtubeVideoId;
  }

  get wavUrl(): string | undefined { return this._wavUrl; }
  get stemsUrl(): string | undefined { return this._stemsUrl; }
  get midiUrl(): string | undefined { return this._midiUrl; }
  get thumbnailUrl(): string | undefined { return this._thumbnailUrl; }
  get workflowState(): WorkflowState | undefined { return this._workflowState; }

  get categoryIds(): string[] {
    return [...this._categoryIds]; // Return copy to prevent mutation
  }

  get tagIds(): string[] {
    return [...this._tagIds];
  }

  get viewCount(): number {
    return this._viewCount;
  }

  get seoTitle(): string | undefined {
    return this._seoTitle;
  }

  get seoDescription(): string | undefined {
    return this._seoDescription;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  // Business Logic Methods

  /**
   * Create a new Content entity
   */
  static create(dto: CreateContentDTO): Content {
    this.validateCreate(dto);

    const id = this.generateId();
    const now = new Date();
    // Prefer a caller-supplied unique slug (the use case ensures uniqueness
    // against existing content); fall back to deriving one from the title.
    const titleSlug = dto.slug ? generateSlug(dto.slug) : generateSlug(dto.title);
    const status = dto.status || ContentStatus.DRAFT;
    const isPublished = status === ContentStatus.PUBLISHED;

    return new Content(
      id,
      dto.type,
      dto.title,
      titleSlug,
      dto.body,
      dto.description,
      dto.author,
      status,
      dto.featuredImage,
      dto.audioUrl,
      dto.audioDuration,
      dto.categoryIds || [],
      dto.tagIds || [],
      0, // Initial view count
      dto.seoTitle,
      dto.seoDescription,
      now,
      now,
      isPublished ? now : undefined, // Set publishedAt if created as PUBLISHED
      dto.videoUrl,
      dto.previewVideoUrl,
      dto.youtubeVideoId,
      dto.wavUrl,
      dto.stemsUrl,
      dto.midiUrl,
      dto.thumbnailUrl,
      dto.workflowState,
      undefined, // theme — set later via /api/admin/songs/[id]/theme
      undefined, // emotionAnalysis — precomputed later by the analyze endpoint
      Lyrics.fromObject(dto.lyrics)
    );
  }

  /**
   * Update content properties
   */
  update(dto: UpdateContentDTO): void {
    if (dto.title !== undefined) {
      Content.validateTitle(dto.title);
      this._title = dto.title;
      this._titleSlug = generateSlug(dto.title);
    }

    if (dto.body !== undefined) {
      Content.validateBody(dto.body);
      this._body = dto.body;
    }

    if (dto.description !== undefined) {
      this._description = dto.description;
    }

    if (dto.author !== undefined) {
      Content.validateAuthor(dto.author);
      this._author = dto.author;
    }

    if (dto.featuredImage !== undefined) {
      this._featuredImage = dto.featuredImage || undefined;
    }

    if (dto.audioUrl !== undefined) {
      this._audioUrl = dto.audioUrl || undefined;
    }

    if (dto.audioDuration !== undefined) {
      this._audioDuration = dto.audioDuration || undefined;
    }

    if (dto.videoUrl !== undefined) {
      this._videoUrl = dto.videoUrl || undefined;
    }

    if (dto.previewVideoUrl !== undefined) {
      this._previewVideoUrl = dto.previewVideoUrl || undefined;
    }

    if (dto.youtubeVideoId !== undefined) {
      this._youtubeVideoId = dto.youtubeVideoId || undefined;
    }

    if (dto.wavUrl !== undefined) this._wavUrl = dto.wavUrl || undefined;
    if (dto.stemsUrl !== undefined) this._stemsUrl = dto.stemsUrl || undefined;
    if (dto.midiUrl !== undefined) this._midiUrl = dto.midiUrl || undefined;
    if (dto.thumbnailUrl !== undefined) this._thumbnailUrl = dto.thumbnailUrl || undefined;
    if (dto.workflowState !== undefined) {
      this._workflowState = dto.workflowState && (WORKFLOW_STATES as readonly string[]).includes(dto.workflowState)
        ? (dto.workflowState as WorkflowState)
        : undefined;
    }

    if (dto.categoryIds !== undefined) {
      this._categoryIds = dto.categoryIds;
    }

    if (dto.tagIds !== undefined) {
      this._tagIds = dto.tagIds;
    }

    if (dto.seoTitle !== undefined) {
      this._seoTitle = dto.seoTitle || undefined;
    }

    if (dto.seoDescription !== undefined) {
      this._seoDescription = dto.seoDescription || undefined;
    }

    if (dto.lyrics !== undefined) {
      // null/junk → empty (clears); a structured object → sanitised lyrics.
      this._lyrics = Lyrics.fromObject(dto.lyrics);
    }

    if (dto.status !== undefined) {
      this.changeStatus(dto.status);
    }

    this._updatedAt = new Date();
  }

  /**
   * Publish the content
   */
  publish(): void {
    if (this._status === ContentStatus.PUBLISHED) {
      throw new Error('Content is already published');
    }

    this.validateForPublish();

    this._status = ContentStatus.PUBLISHED;
    this._publishedAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Unpublish the content (move to draft)
   */
  unpublish(): void {
    if (this._status !== ContentStatus.PUBLISHED) {
      throw new Error('Content is not published');
    }

    this._status = ContentStatus.DRAFT;
    this._updatedAt = new Date();
  }

  /**
   * Archive the content
   */
  archive(): void {
    this._status = ContentStatus.ARCHIVED;
    this._updatedAt = new Date();
  }

  /**
   * Increment view count
   */
  incrementViewCount(): void {
    this._viewCount++;
    this._updatedAt = new Date();
  }

  /**
   * Add a category
   */
  addCategory(categoryId: string): void {
    if (this._categoryIds.includes(categoryId)) {
      return; // Already added
    }
    this._categoryIds.push(categoryId);
    this._updatedAt = new Date();
  }

  /**
   * Remove a category
   */
  removeCategory(categoryId: string): void {
    this._categoryIds = this._categoryIds.filter((id) => id !== categoryId);
    this._updatedAt = new Date();
  }

  /**
   * Add a tag
   */
  addTag(tagId: string): void {
    if (this._tagIds.includes(tagId)) {
      return; // Already added
    }
    this._tagIds.push(tagId);
    this._updatedAt = new Date();
  }

  /**
   * Remove a tag
   */
  removeTag(tagId: string): void {
    this._tagIds = this._tagIds.filter((id) => id !== tagId);
    this._updatedAt = new Date();
  }

  /**
   * Check if content can be published
   */
  canPublish(): boolean {
    return (
      this._title.trim().length > 0 &&
      this._body.trim().length > 0 &&
      this._author.trim().length > 0 &&
      this._status !== ContentStatus.PUBLISHED
    );
  }

  /**
   * Check if content has audio
   */
  hasAudio(): boolean {
    return !!this._audioUrl;
  }

  /**
   * Check if content is published
   */
  isPublished(): boolean {
    return this._status === ContentStatus.PUBLISHED;
  }

  /**
   * Convert to plain object for persistence
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      type: this.type,
      title: this._title,
      titleSlug: this._titleSlug,
      body: this._body,
      description: this._description,
      author: this._author,
      status: this._status,
      featuredImage: this._featuredImage,
      audioUrl: this._audioUrl,
      audioDuration: this._audioDuration,
      videoUrl: this._videoUrl,
      previewVideoUrl: this._previewVideoUrl,
      youtubeVideoId: this._youtubeVideoId,
      wavUrl: this._wavUrl,
      stemsUrl: this._stemsUrl,
      midiUrl: this._midiUrl,
      thumbnailUrl: this._thumbnailUrl,
      workflowState: this._workflowState,
      // Omit lyrics entirely when empty so songs without words don't carry an
      // empty `{sections:[]}` in DynamoDB (consistent with other optional fields).
      lyrics: this._lyrics.isEmpty() ? undefined : this._lyrics.toObject(),
      categoryIds: this._categoryIds,
      tagIds: this._tagIds,
      theme: this._theme,
      emotionAnalysis: this._emotionAnalysis,
      viewCount: this._viewCount,
      seoTitle: this._seoTitle,
      seoDescription: this._seoDescription,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      publishedAt: this._publishedAt?.toISOString(),
    };
  }

  /**
   * Reconstruct entity from database
   */
  static fromObject(data: any): Content {
    return new Content(
      data.id,
      data.type,
      data.title,
      data.titleSlug,
      data.body,
      data.description,
      data.author,
      data.status,
      data.featuredImage,
      data.audioUrl,
      data.audioDuration,
      data.categoryIds || [],
      data.tagIds || [],
      data.viewCount || 0,
      data.seoTitle,
      data.seoDescription,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.publishedAt ? new Date(data.publishedAt) : undefined,
      data.videoUrl,
      data.previewVideoUrl,
      data.youtubeVideoId,
      data.wavUrl,
      data.stemsUrl,
      data.midiUrl,
      data.thumbnailUrl,
      data.workflowState && (WORKFLOW_STATES as readonly string[]).includes(data.workflowState)
        ? (data.workflowState as WorkflowState)
        : undefined,
      typeof data.theme === 'string' ? data.theme : undefined,
      data.emotionAnalysis && typeof data.emotionAnalysis === 'object'
        ? (data.emotionAnalysis as EmotionAnalysis)
        : undefined,
      Lyrics.fromObject(data.lyrics)
    );
  }

  // Private Helper Methods

  private static validateCreate(dto: CreateContentDTO): void {
    this.validateTitle(dto.title);
    this.validateBody(dto.body);
    this.validateAuthor(dto.author);

    if (!Object.values(ContentType).includes(dto.type)) {
      throw new Error(`Invalid content type: ${dto.type}`);
    }
  }

  private static validateTitle(title: string): void {
    if (!title || title.trim().length === 0) {
      throw new Error('Title is required');
    }

    if (title.trim().length > 200) {
      throw new Error('Title must be less than 200 characters');
    }
  }

  private static validateBody(body: string): void {
    if (!body || body.trim().length === 0) {
      throw new Error('Body is required');
    }

    if (body.trim().length > 50000) {
      throw new Error('Body must be less than 50,000 characters');
    }
  }

  private static validateAuthor(author: string): void {
    if (!author || author.trim().length === 0) {
      throw new Error('Author is required');
    }
  }

  private validateForPublish(): void {
    if (!this.canPublish()) {
      throw new Error('Content cannot be published - missing required fields');
    }
  }

  private changeStatus(newStatus: ContentStatus): void {
    if (newStatus === ContentStatus.PUBLISHED && this._status !== ContentStatus.PUBLISHED) {
      this.publish();
    } else {
      this._status = newStatus;
    }
  }

  private static generateId(): string {
    // Generate a unique ID (UUID-like)
    return `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
