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
import { s3Config } from '@/lib/aws-config';

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
  }) {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: params.key,
      Body: params.file,
      ContentType: params.contentType,
      Metadata: params.metadata,
    });

    await s3Client.send(command);

    return {
      url: `https://${BUCKET_NAME}.s3.${s3Config.region}.amazonaws.com/${params.key}`,
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
   * Generate a unique key for file upload
   */
  static generateFileKey(params: {
    folder: 'audio' | 'images' | 'temp';
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
 * File upload constraints
 */
export const FILE_CONSTRAINTS = {
  maxSize: {
    image: 10 * 1024 * 1024, // 10MB
    audio: 50 * 1024 * 1024, // 50MB
  },
  allowedTypes: {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'],
  },
};

/**
 * Validate file for upload
 */
export function validateFile(params: {
  file: File;
  type: 'image' | 'audio';
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
