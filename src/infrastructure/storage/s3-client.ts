/**
 * S3 Client
 *
 * Infrastructure layer - S3 file storage operations
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import { s3Config, mediaUrl } from '@/lib/aws-config';

/**
 * Create S3 Client
 */
const createS3Client = () => {
  return new S3Client({
    region: s3Config.region,
    credentials: s3Config.credentials,
  });
};

/**
 * S3 Client Instance (singleton)
 */
export const s3Client = createS3Client();

/**
 * Bucket name from configuration
 */
export const BUCKET_NAME = s3Config.bucket;

/**
 * S3 Operations Helper
 */
export class S3Operations {
  /**
   * Upload a file to S3
   */
  static async uploadFile(params: {
    key: string;
    file: Buffer | Uint8Array | Blob | string;
    contentType: string;
    metadata?: Record<string, string>;
    /** Optional Cache-Control stored on the object (and honored by CloudFront).
     *  Used e.g. for video thumbnails so a re-mirror propagates via the CDN
     *  within minutes instead of waiting out the default ~24h TTL. */
    cacheControl?: string;
  }) {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: params.key,
      Body: params.file,
      ContentType: params.contentType,
      Metadata: params.metadata,
      CacheControl: params.cacheControl,
    });

    await s3Client.send(command);

    return {
      // Serve via the media base (CDN) so the bucket can stay private.
      url: mediaUrl(params.key),
      key: params.key,
      bucket: BUCKET_NAME,
    };
  }

  /**
   * Get a file from S3
   */
  static async getFile(key: string) {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    return response.Body;
  }

  /**
   * Read the first `end + 1` bytes of an object (an HTTP Range request), so a
   * caller can inspect a file header (e.g. a WAV's fmt/data chunks for duration)
   * without downloading the whole file. Returns the bytes as a Uint8Array.
   */
  static async getRange(key: string, end: number): Promise<Uint8Array> {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Range: `bytes=0-${end}`,
    });
    const response = await s3Client.send(command);
    const body = response.Body as
      | { transformToByteArray?: () => Promise<Uint8Array> }
      | undefined;
    if (!body?.transformToByteArray) {
      throw new S3Error('S3 range response had no readable body', 'EmptyBody', 502);
    }
    return await body.transformToByteArray();
  }

  /**
   * Delete a file from S3
   */
  static async deleteFile(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    return await s3Client.send(command);
  }

  /**
   * List files in a folder
   */
  static async listFiles(prefix?: string, maxKeys?: number) {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys || 1000,
    });

    const response = await s3Client.send(command);
    return response.Contents || [];
  }

  /**
   * Check if file exists
   */
  static async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get a signed URL for temporary access
   */
  static async getSignedUrl(key: string, expiresIn: number = 3600) {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  }

  /**
   * Get a signed URL for uploading
   */
  static async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600
  ) {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  }

  /**
   * Presigned POST for a browser upload. Unlike a presigned PUT, a POST policy
   * can carry a `content-length-range` condition, so S3 itself *rejects* an
   * object larger than `maxSize` (a presigned PUT cannot enforce size — the cap
   * is only advisory there). The content type is pinned too. Returns the form
   * `url` + `fields` the browser must POST (the file part last).
   */
  static async getSignedUploadPost(
    key: string,
    contentType: string,
    maxSize: number,
    expiresIn: number = 3600
  ): Promise<PresignedPost> {
    return await createPresignedPost(s3Client, {
      Bucket: BUCKET_NAME,
      Key: key,
      Conditions: [
        ['content-length-range', 0, maxSize],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresIn,
    });
  }

  /**
   * Public HTTPS URL for an object, routed through the media base (CloudFront).
   * The S3 bucket itself is private (OAC) — only the CDN can read it — so this
   * must NOT return a direct S3 URL or the link would 403.
   */
  static getPublicUrl(key: string): string {
    return mediaUrl(key);
  }

  /**
   * Generate a unique key for file upload
   */
  static generateFileKey(params: {
    folder: 'audio' | 'images' | 'video' | 'temp';
    filename: string;
    userId?: string;
  }): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const sanitizedFilename = params.filename.replace(/[^a-zA-Z0-9.-]/g, '_');

    if (params.userId) {
      return `${params.folder}/${params.userId}/${timestamp}_${random}_${sanitizedFilename}`;
    }

    return `${params.folder}/${timestamp}_${random}_${sanitizedFilename}`;
  }
}

/**
 * Normalise a request/browser-supplied content type to the canonical one we
 * want stored on the S3 object. Browsers report `audio/mp3` for MP3 files,
 * which is a non-standard MIME type — the registered type is `audio/mpeg`.
 * Storing the canonical type keeps every song consistent (and avoids the
 * `audio/mp3` objects the early uploads produced). Unknown types pass through.
 */
const CONTENT_TYPE_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
};
export function normalizeContentType(contentType: string): string {
  return CONTENT_TYPE_ALIASES[contentType.trim().toLowerCase()] ?? contentType;
}

/**
 * File upload constraints
 */
export const FILE_CONSTRAINTS = {
  maxSize: {
    image: 10 * 1024 * 1024, // 10MB
    audio: 1000 * 1024 * 1024, // 1000MB — long-form audio / large MP3
    video: 50 * 1024 * 1024, // 50MB — short preview clips only (full videos live on YouTube)
  },
  allowedTypes: {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'],
    video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'],
  },
};

/**
 * Validate file for upload
 */
export function validateFile(params: {
  file: File;
  type: 'image' | 'audio' | 'video';
}): { valid: boolean; error?: string } {
  const { file, type } = params;

  // Check file size
  const maxSize = FILE_CONSTRAINTS.maxSize[type];
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size must be less than ${maxSize / (1024 * 1024)}MB`,
    };
  }

  // Check file type
  const allowedTypes = FILE_CONSTRAINTS.allowedTypes[type];
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type must be one of: ${allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Error handler for S3 operations
 */
export class S3Error extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'S3Error';
  }
}

/**
 * Handle S3 errors
 */
export function handleS3Error(error: any): never {
  console.error('S3 Error:', error);

  if (error.name === 'NoSuchBucket') {
    throw new S3Error(
      `Bucket ${BUCKET_NAME} not found. Please create the bucket first.`,
      error.name,
      404
    );
  }

  if (error.name === 'NoSuchKey') {
    throw new S3Error(
      'File not found',
      error.name,
      404
    );
  }

  if (error.name === 'AccessDenied') {
    throw new S3Error(
      'Access denied to S3 bucket',
      error.name,
      403
    );
  }

  throw new S3Error(
    error.message || 'Unknown S3 error',
    error.name,
    500
  );
}
