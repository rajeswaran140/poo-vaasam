/** @jest-environment node */
/**
 * AdSense gating.
 *
 * A TRIAL (Raj, 2026-08-18): 501 pageviews / 28 days would earn cents at Indian
 * RPM, but the strategy targets Tamil communities in Europe, Canada and the USA
 * where RPM is ~10x. The trial measures whether that audience arrives.
 *
 * ⚠️ These tests exist because the two ways this feature can go wrong are both
 * silent: shipping ad scripts on pages that must never carry them, and shipping
 * them at all on a deploy where no publisher id is configured.
 */

const ENV = process.env;
const reload = async (client?: string) => {
  jest.resetModules();
  process.env = { ...ENV };
  if (client) process.env.NEXT_PUBLIC_ADSENSE_CLIENT = client;
  else delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  return import('@/lib/adsense');
};
afterAll(() => { process.env = ENV; });

describe('inert until configured', () => {
  it('is not configured with no publisher id', async () => {
    const m = await reload();
    expect(m.isAdSenseConfigured()).toBe(false);
  });

  /** The whole point: an unconfigured deploy must ship no ad requests. */
  it('permits ads NOWHERE when unconfigured, even on a normal page', async () => {
    const m = await reload();
    expect(m.adsAllowedOn('/songs')).toBe(false);
    expect(m.adsAllowedOn('/')).toBe(false);
  });

  it('rejects a malformed publisher id rather than shipping a broken script', async () => {
    for (const bad of ['pub-123', 'ca-pub-abc', 'ca-pub-123', '']) {
      const m = await reload(bad);
      expect(m.isAdSenseConfigured()).toBe(false);
    }
  });

  it('accepts a well-formed publisher id', async () => {
    const m = await reload('ca-pub-1234567890123456');
    expect(m.isAdSenseConfigured()).toBe(true);
  });
});

describe('pages that must never carry ads', () => {
  const CLIENT = 'ca-pub-1234567890123456';

  it.each([
    ['/admin', 'Raj’s workspace — ads there would also pollute the trial with his own pageviews'],
    ['/admin/songs', 'nested admin'],
    ['/privacy', 'legal'],
    ['/contact', 'transactional'],
    ['/music-composition', 'a PAID service — an ad beside it undercuts the offer'],
  ])('excludes %s (%s)', async (path) => {
    const m = await reload(CLIENT);
    expect(m.adsAllowedOn(path)).toBe(false);
  });

  it('allows ads on ordinary audience pages', async () => {
    const m = await reload(CLIENT);
    for (const p of ['/', '/songs', '/content/cnt_123', '/thayagam', '/all']) {
      expect(m.adsAllowedOn(p)).toBe(true);
    }
  });

  /** `/music-composition-guide` is NOT the paid page — prefix care. */
  it('excludes a sub-path but not a merely similar name', async () => {
    const m = await reload(CLIENT);
    expect(m.adsAllowedOn('/music-composition/checkout')).toBe(false);
    expect(m.adsAllowedOn('/music-composition-guide')).toBe(true);
    expect(m.adsAllowedOn('/administrator')).toBe(true);
  });
});
