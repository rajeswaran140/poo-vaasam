/** @jest-environment node */
import { contentPath, VANITY_PATHS } from '@/config/vanity-paths';

describe('contentPath', () => {
  it('returns the vanity path for a content id that has one', () => {
    expect(contentPath('cnt_1781049094952_wstyqacm4')).toBe('/thayagam');
  });

  it('falls back to /content/<id> for ids without a vanity path', () => {
    expect(contentPath('cnt_other_song')).toBe('/content/cnt_other_song');
  });

  it('every vanity path is an absolute root path and maps a cnt_ id', () => {
    for (const [id, path] of Object.entries(VANITY_PATHS)) {
      expect(id).toMatch(/^cnt_/);
      expect(path).toMatch(/^\/[a-z0-9-]+$/);
    }
  });
});
