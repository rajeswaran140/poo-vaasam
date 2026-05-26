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
