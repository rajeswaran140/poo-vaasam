/**
 * CORS configuration for the media (S3) bucket.
 *
 * Single source of truth for which web origins may make browser requests to
 * `tamil-web-media` (presigned uploads + media reads). Keep this list explicit —
 * never fall back to `*`, which would let any site issue cross-origin
 * PUT/DELETE preflights against the bucket.
 */

export const ALLOWED_WEB_ORIGINS: string[] = [
  'http://localhost:3000',
  'http://localhost:3002',
  'https://*.amplifyapp.com',
  'https://tamilagaval.com',
  'https://www.tamilagaval.com',
];

/**
 * Object-key prefixes that are served publicly. Public read is granted by PATH
 * (below) rather than per-object tags: presigned PUTs can't reliably sign an
 * `x-amz-tagging` header, so tag-based public-read made every upload fail.
 */
export const PUBLIC_MEDIA_PREFIXES = ['audio', 'images', 'video'] as const;

/** Public-read bucket policy: anyone can GET objects under the media prefixes. */
export function mediaBucketPolicy(bucket: string) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadMedia',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: PUBLIC_MEDIA_PREFIXES.map(
          (prefix) => `arn:aws:s3:::${bucket}/${prefix}/*`
        ),
      },
    ],
  };
}

/** S3 CORS rules permitting browser uploads/reads of media from known origins. */
export function mediaCorsRules() {
  return [
    {
      AllowedHeaders: ['*'],
      AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
      AllowedOrigins: ALLOWED_WEB_ORIGINS,
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3000,
    },
  ];
}
