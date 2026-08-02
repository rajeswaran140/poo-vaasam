/** @jest-environment node */
/**
 * The music-composition service page is technically sound — Service +
 * AggregateOffer + FAQ schema, bilingual copy, a qualified-brief form wired to
 * /api/contact — and has produced ZERO commissions since launch, on 83
 * pageviews / 38 sessions across 90 days (audited 2026-08-02). Nobody reaches
 * it. The channel's descriptions are the only route to it at any scale, so the
 * checklist now tracks whether a song points there.
 *
 * These tests pin the two things that would quietly break that:
 *   - the CTA is advisory, never a defect (it is a per-song judgement call)
 *   - the detector matches the PATH, so a link with different UTM tags still
 *     counts as "this song routes people to the service"
 */
import { COMPOSITION_CTA, COMPOSITION_CTA_URL, hasCompositionCta } from '@/lib/commission';
import { checkRelease, type VideoSnapshot } from '@/lib/release-checklist';

const song = (description: string): VideoSnapshot => ({
  videoId: 'abc12345678',
  title: 'ஒரு பாடல் | Oru Paadal | Tamil Song',
  description,
  tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
  categoryId: '10',
  defaultLanguage: 'ta',
  defaultAudioLanguage: 'ta',
  hasCustomThumbnail: true,
  isShort: false,
  playlistIds: [
    'PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs',
    'PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU',
  ],
  captionTracks: [{ trackKind: 'standard', language: 'ta' }],
  isUpcoming: false,
});

describe('hasCompositionCta', () => {
  it('detects the canonical CTA', () => {
    expect(hasCompositionCta(COMPOSITION_CTA)).toBe(true);
  });

  it.each([
    ['https://tamilagaval.com/music-composition', true],
    ['https://tamilagaval.com/music-composition?utm_source=youtube&utm_medium=description', true],
    ['https://tamilagaval.com/music-composition?utm_source=whatsapp', true],
    ['HTTPS://TAMILAGAVAL.COM/MUSIC-COMPOSITION', true],
    // A bare site link is NOT the service link — the whole point is routing to
    // the page, and the homepage does not surface it.
    ['https://tamilagaval.com/?utm_source=youtube', false],
    ['https://tamilagaval.com/songs/love', false],
    ['', false],
  ])('%s -> %s', (desc, expected) => {
    expect(hasCompositionCta(desc)).toBe(expected);
  });

  it('tolerates a null-ish description without throwing', () => {
    expect(hasCompositionCta(undefined as unknown as string)).toBe(false);
  });

  it('carries a UTM so the funnel is attributable in GA4', () => {
    expect(COMPOSITION_CTA_URL).toContain('utm_source=youtube');
    expect(COMPOSITION_CTA_URL).toContain('utm_medium=description');
  });

  it('is bilingual and Tamil-led — the buyer reads the Tamil half', () => {
    expect(COMPOSITION_CTA).toMatch(/[஀-௿]/);
    expect(COMPOSITION_CTA).toMatch(/Need music for your lyrics/i);
    const firstLine = COMPOSITION_CTA.split('\n')[0];
    const tamilAt = firstLine.search(/[஀-௿]/);
    const englishAt = firstLine.search(/[A-Za-z]/);
    expect(tamilAt).toBeGreaterThanOrEqual(0);
    expect(tamilAt).toBeLessThan(englishAt);
  });
});

describe('release checklist — composition-cta finding', () => {
  const base =
    '✍️ Lyrics: Raj (original, all rights reserved)\n' +
    '🌐 https://tamilagaval.com/?utm_source=youtube&utm_medium=description\n' +
    'https://www.youtube.com/@Tamilagaval?sub_confirmation=1\n' +
    'https://www.youtube.com/playlist?list=PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs\n' +
    '#TamilSong #தமிழ்பாடல்';

  it('raises a NOTE when the service link is absent', () => {
    const finding = checkRelease(song(base)).find((x: { id: string }) => x.id === 'composition-cta');
    expect(finding).toBeDefined();
    // Advisory. A blocker or gap here would make every song in the catalogue
    // read as broken over an optional cross-sell.
    expect(finding!.severity).toBe('note');
    expect(finding!.fix).toBe(COMPOSITION_CTA);
  });

  it('is silent once the song links to the service', () => {
    const withCta = `${base}\n${COMPOSITION_CTA}`;
    expect(checkRelease(song(withCta)).find((x: { id: string }) => x.id === 'composition-cta')).toBeUndefined();
  });

  it('does not turn a compliant song into a failing one', () => {
    const findings = checkRelease(song(base));
    expect(findings.filter((x: { severity: string }) => x.severity === 'blocker')).toHaveLength(0);
    // The note must not be counted among real gaps.
    expect(findings.filter((x: { severity: string }) => x.severity === 'gap').map((x: { id: string }) => x.id)).not.toContain('composition-cta');
  });
});
