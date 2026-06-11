/** @jest-environment node */
/**
 * generateMetadata for /songs/[theme] — keyword-rich, localized, canonical per
 * theme; clean not-found metadata for an unknown theme. (Does not hit the DB.)
 */

import { generateMetadata } from '@/app/songs/[theme]/page';

const meta = (theme: string) => generateMetadata({ params: Promise.resolve({ theme }) } as never);

describe('song collection generateMetadata', () => {
  it('builds keyword-rich, bilingual metadata for a valid theme', async () => {
    const m = await meta('mother');
    expect(m.title).toMatch(/Tamil Mother Songs/);
    expect(m.title).toMatch(/அன்னை/);
    expect(String(m.description)).toMatch(/Tamil/);
    expect(m.openGraph?.url).toBe('/songs/mother');
    expect(m.alternates?.canonical).toBeDefined();
  });

  it('builds metadata for the love theme too', async () => {
    const m = await meta('love');
    expect(m.title).toMatch(/Tamil Love Songs/);
    expect(m.openGraph?.url).toBe('/songs/love');
  });

  it('returns clean not-found metadata for an unknown theme (no OG)', async () => {
    const m = await meta('nonsense');
    expect(m.title).toBe('பாடல்கள் கிடைக்கவில்லை');
    expect(m.openGraph).toBeUndefined();
  });
});
