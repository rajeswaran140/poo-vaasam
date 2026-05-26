/**
 * Tests for the media-bucket CORS allow-list.
 * Guards against regressing to a wildcard (`*`) origin.
 */

import { ALLOWED_WEB_ORIGINS, mediaCorsRules } from '@/config/cors';

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
