/**
 * Tests for the media-bucket CORS allow-list.
 * Guards against regressing to a wildcard (`*`) origin.
 */

import {
  ALLOWED_WEB_ORIGINS,
  mediaCorsRules,
  mediaBucketPolicy,
  PUBLIC_MEDIA_PREFIXES,
} from '@/config/cors';

describe('media CORS config', () => {
  it('never allows all origins (no wildcard "*")', () => {
    expect(ALLOWED_WEB_ORIGINS).not.toContain('*');
    expect(ALLOWED_WEB_ORIGINS.length).toBeGreaterThan(0);
  });

  it('allows the production domains and local dev', () => {
    expect(ALLOWED_WEB_ORIGINS).toEqual(
      expect.arrayContaining([
        'https://tamilagaval.com',
        'https://www.tamilagaval.com',
        'https://*.amplifyapp.com',
        'http://localhost:3000',
      ])
    );
  });

  it('produces a single rule that permits browser upload methods from the allow-list', () => {
    const rules = mediaCorsRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].AllowedMethods).toEqual(
      expect.arrayContaining(['GET', 'PUT', 'POST', 'DELETE', 'HEAD'])
    );
    expect(rules[0].AllowedOrigins).toBe(ALLOWED_WEB_ORIGINS);
    expect(rules[0].AllowedOrigins).not.toContain('*');
  });
});

describe('media bucket policy', () => {
  it('grants public read by PATH for the media prefixes, with no tag condition', () => {
    const policy = mediaBucketPolicy('my-bucket');
    const stmt = policy.Statement[0];

    expect(stmt.Effect).toBe('Allow');
    expect(stmt.Action).toBe('s3:GetObject');
    // Tag-based conditions broke uploads (presigned PUTs can't sign x-amz-tagging).
    expect(stmt).not.toHaveProperty('Condition');
    for (const prefix of PUBLIC_MEDIA_PREFIXES) {
      expect(stmt.Resource).toContain(`arn:aws:s3:::my-bucket/${prefix}/*`);
    }
  });
});
