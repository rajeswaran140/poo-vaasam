import { collectionPageJsonLd, type CollectionItem } from '@/lib/collection-jsonld';
import { SITE_URL } from '@/lib/seo';

const poems: CollectionItem[] = [
  { id: 'cnt_a', title: 'கவிதை ஒன்று', featuredImage: 'https://cdn.example/a.png' },
  { id: 'cnt_b', title: 'கவிதை இரண்டு' }, // no image
];

const opts = { name: 'Tamil Poems — Tamilagaval', description: 'Free Tamil poems.', url: `${SITE_URL}/poems` };

describe('collectionPageJsonLd', () => {
  it('is a CollectionPage with the page name/url/inLanguage and a WebSite parent', () => {
    const ld = collectionPageJsonLd(poems, opts) as Record<string, unknown>;
    expect(ld['@type']).toBe('CollectionPage');
    expect(ld.name).toBe('Tamil Poems — Tamilagaval');
    expect(ld.url).toBe(`${SITE_URL}/poems`);
    expect(ld.inLanguage).toBe('ta');
    expect(ld.isPartOf).toMatchObject({ '@type': 'WebSite', url: SITE_URL });
  });

  it('lists every poem as a ListItem with absolute URL, name, and image when present', () => {
    const ld = collectionPageJsonLd(poems, opts) as {
      mainEntity: { '@type': string; numberOfItems: number; itemListElement: Record<string, unknown>[] };
    };
    expect(ld.mainEntity['@type']).toBe('ItemList');
    expect(ld.mainEntity.numberOfItems).toBe(2);

    expect(ld.mainEntity.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: `${SITE_URL}/content/cnt_a`,
      name: 'கவிதை ஒன்று',
      image: 'https://cdn.example/a.png',
    });
    // Second poem has no image → the key is omitted (no empty/undefined value).
    const second = ld.mainEntity.itemListElement[1];
    expect(second.position).toBe(2);
    expect(second.name).toBe('கவிதை இரண்டு');
    expect('image' in second).toBe(false);
  });

  it('handles an empty catalogue (numberOfItems 0, empty list)', () => {
    const ld = collectionPageJsonLd([], opts) as { mainEntity: { numberOfItems: number; itemListElement: unknown[] } };
    expect(ld.mainEntity.numberOfItems).toBe(0);
    expect(ld.mainEntity.itemListElement).toEqual([]);
  });

  it('uses an item’s vanity URL when it has one (canonical, no redirect hop)', () => {
    // cnt_1781049094952_wstyqacm4 → /thayagam in the vanity-path map.
    const ld = collectionPageJsonLd([{ id: 'cnt_1781049094952_wstyqacm4', title: 'எங்கள் தேசம்' }], opts) as {
      mainEntity: { itemListElement: Array<{ url: string }> };
    };
    expect(ld.mainEntity.itemListElement[0].url).toBe(`${SITE_URL}/thayagam`);
  });
});
