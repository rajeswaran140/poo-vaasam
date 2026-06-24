/** @jest-environment node */
/**
 * The /clips static assets are served straight from Amplify's CDN/S3 origin, so
 * next.config headers() never reaches them — the immutable cache MUST be set via
 * amplify.yml customHeaders or it silently reverts to the platform default
 * (max-age=5). This guards that the CDN rule stays in place.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

it('amplify.yml caches /clips/** immutably at the CDN', () => {
  const yml = readFileSync(join(process.cwd(), 'amplify.yml'), 'utf8');
  expect(yml).toMatch(/customHeaders:/);
  expect(yml).toMatch(/pattern:\s*'\/clips\/\*\*'/);
  expect(yml).toMatch(/max-age=31536000/);
  expect(yml).toMatch(/immutable/);
});
