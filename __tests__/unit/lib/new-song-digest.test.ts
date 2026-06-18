/**
 * New-song email digest content builder — provider-agnostic subject/HTML/text
 * for the diaspora mailing list (the send adapter is the only blocked piece).
 */

import { buildNewSongDigest } from '@/lib/email/new-song-digest';
import type { PublicSongDTO } from '@/domain/songs/PublicSong';

const song = (over: Partial<PublicSongDTO> = {}): PublicSongDTO => ({
  id: 'cnt_1',
  slug: 'engal-thesam',
  title: 'எங்கள் தேசம்',
  artist: 'இராஜ்',
  audio: { url: 'https://cdn/x.mp3', mimeType: 'audio/mpeg' },
  coverUrl: 'https://cdn/cover.png',
  theme: 'homeland',
  hasLyrics: true,
  publishedAt: '2026-06-10T00:00:00.000Z',
  ...over,
});

describe('buildNewSongDigest', () => {
  it('returns null when there are no songs', () => {
    expect(buildNewSongDigest([])).toBeNull();
  });

  it('names the song in the subject for a single release', () => {
    const d = buildNewSongDigest([song()])!;
    expect(d.subject).toBe('புதிய பாடல்: எங்கள் தேசம்');
  });

  it('counts songs in the subject for multiple releases', () => {
    const d = buildNewSongDigest([song(), song({ id: 'cnt_2', title: 'B' })])!;
    expect(d.subject).toBe('2 புதிய பாடல்கள் — Tamilagaval');
  });

  it('builds absolute song links in both html and text', () => {
    const d = buildNewSongDigest([song({ id: 'cnt_x' })], { siteUrl: 'https://tamilagaval.com' })!;
    expect(d.text).toContain('https://tamilagaval.com/content/cnt_x');
    expect(d.html).toContain('https://tamilagaval.com/content/cnt_x');
  });

  it('renders a cover image when present, omits it otherwise', () => {
    expect(buildNewSongDigest([song()])!.html).toContain('<img src="https://cdn/cover.png"');
    expect(buildNewSongDigest([song({ coverUrl: undefined })])!.html).not.toContain('<img');
  });

  it('includes an unsubscribe link only when provided', () => {
    const without = buildNewSongDigest([song()])!;
    expect(without.html).not.toMatch(/unsubscribe/i);

    const withUnsub = buildNewSongDigest([song()], { unsubscribeUrl: 'https://x/unsub?t=1' })!;
    expect(withUnsub.html).toContain('https://x/unsub?t=1');
    expect(withUnsub.text).toContain('Unsubscribe: https://x/unsub?t=1');
  });

  it('HTML-escapes song text to prevent broken/injected markup', () => {
    const d = buildNewSongDigest([song({ title: 'A & B <script>' })])!;
    expect(d.html).toContain('A &amp; B &lt;script&gt;');
    expect(d.html).not.toContain('<script>');
  });
});
