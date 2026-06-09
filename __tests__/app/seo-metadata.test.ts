/** @jest-environment node */
/**
 * SEO metadata guarantees for the global-Tamil-audience work:
 *  - empty section pages (lyrics/stories/essays) are noindex (avoid soft-404s)
 *  - every audited page emits self-referencing ta + x-default hreflang
 *  - /all uses romanised, shareable metadata with an OG block
 *
 * The section/listing pages import ContentRepository at module scope, so we mock
 * it — we only read the static `metadata` exports here, never render.
 */

jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({
    findByType: jest.fn().mockResolvedValue({ items: [] }),
    findAll: jest.fn().mockResolvedValue({ items: [] }),
  })),
}));

import { SITE_URL } from '@/lib/seo';
import { metadata as lyricsMeta } from '@/app/lyrics/page';
import { metadata as storiesMeta } from '@/app/stories/page';
import { metadata as essaysMeta } from '@/app/essays/page';
import { metadata as allMeta } from '@/app/all/page';

describe('empty section pages are noindex until they have content', () => {
  it.each([
    ['lyrics', lyricsMeta, '/lyrics'],
    ['stories', storiesMeta, '/stories'],
    ['essays', essaysMeta, '/essays'],
  ])('%s is noindex, follow', (_name, meta, path) => {
    expect(meta.robots).toEqual({ index: false, follow: true });
    // …but still emits hreflang so the canonical signal is correct.
    expect(meta.alternates?.canonical).toBe(path);
    expect(meta.alternates?.languages).toEqual({
      ta: `${SITE_URL}${path}`,
      'x-default': `${SITE_URL}${path}`,
    });
  });
});

describe('/all is indexable, romanised and shareable', () => {
  it('does not set noindex', () => {
    expect(allMeta.robots).toBeUndefined();
  });

  it('uses a romanised, query-friendly title (not Tamil script)', () => {
    expect(typeof allMeta.title).toBe('string');
    expect(allMeta.title as string).toMatch(/Tamil/i);
  });

  it('emits hreflang and an Open Graph block for WhatsApp/FB sharing', () => {
    expect(allMeta.alternates?.languages).toHaveProperty('x-default');
    expect(allMeta.openGraph).toBeDefined();
    expect(allMeta.openGraph?.url).toBe(`${SITE_URL}/all`);
    expect((allMeta.twitter as { card?: string })?.card).toBe('summary_large_image');
  });
});
