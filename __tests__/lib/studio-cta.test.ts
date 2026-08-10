/** @jest-environment node */
/**
 * UNIT TESTS — the Studio CTA link contract.
 *
 * The single most important assertion here is that the query parameter is
 * `cta_source` and NOT `source`. `source` is a GA4 RESERVED campaign field: an
 * event parameter of that name silently rewrites the session's traffic source,
 * which once credited 50 sessions to `songs_list_row` instead of youtube.com.
 * The repo already renamed three helpers for this reason. A well-meaning
 * "simplification" back to `source` would reintroduce a bug that is invisible
 * until the attribution data is already wrong.
 */
import {
  STUDIO_URL,
  STUDIO_PLACEMENTS,
  STUDIO_IMPRESSION,
  STUDIO_CLICK,
  STUDIO_EVENT_ENDPOINT,
  STUDIO_PRICE_CAD,
  STUDIO_PILOT_TRACKS,
  studioUrl,
  placementFromUrl,
} from '@/lib/studio-cta';

describe('studioUrl', () => {
  it('uses cta_source, NEVER the reserved GA4 `source`', () => {
    const u = new URL(studioUrl('site_nav'));
    expect(u.searchParams.get('cta_source')).toBe('site_nav');
    expect(u.searchParams.has('source')).toBe(false);
  });

  it('points at the live pilot page', () => {
    expect(studioUrl('site_nav').startsWith(STUDIO_URL)).toBe(true);
  });

  it('tags every declared placement distinctly', () => {
    // Without per-placement tagging, the aggregate click count hides which
    // surface works — the reason this exists BEFORE a second surface, not after.
    const seen = STUDIO_PLACEMENTS.map((p) => studioUrl(p));
    expect(new Set(seen).size).toBe(STUDIO_PLACEMENTS.length);
  });

  it('produces a valid absolute URL for each placement', () => {
    for (const p of STUDIO_PLACEMENTS) {
      expect(() => new URL(studioUrl(p))).not.toThrow();
    }
  });
});

describe('placementFromUrl', () => {
  it('round-trips every placement', () => {
    for (const p of STUDIO_PLACEMENTS) {
      expect(placementFromUrl(studioUrl(p))).toBe(p);
    }
  });

  it('rejects an unknown placement rather than inventing one', () => {
    // A typo must not silently create a placement that then appears to convert
    // at 0%.
    expect(placementFromUrl(`${STUDIO_URL}?cta_source=whatever`)).toBeNull();
    expect(placementFromUrl(STUDIO_URL)).toBeNull();
  });

  it('is safe on a malformed URL', () => {
    expect(placementFromUrl('not a url')).toBeNull();
    expect(placementFromUrl('')).toBeNull();
  });
});

describe('funnel contract with the pilot page', () => {
  it('owns exactly the two steps the site can observe', () => {
    // The remaining five (mastering_page_view → demo_play → pricing_view →
    // signup_start → signup_complete) belong to the pilot page.
    expect(STUDIO_IMPRESSION).toBe('studio_impression');
    expect(STUDIO_CLICK).toBe('studio_click');
  });

  it('posts to the pilot backend, not to this site', () => {
    // The counters live with the experiment so the funnel is readable in one
    // place; /admin on the pilot shows all seven steps together.
    expect(STUDIO_EVENT_ENDPOINT).toMatch(/execute-api\..*\.amazonaws\.com\/event$/);
  });
});

describe('terms stay in one place', () => {
  it('keeps the price and cohort size as constants the page can render', () => {
    // If the site says $25 and the pilot page says something else, the visitor
    // arrives to a different offer than the one they clicked.
    expect(STUDIO_PRICE_CAD).toBe(25);
    expect(STUDIO_PILOT_TRACKS).toBe(5);
  });
});
