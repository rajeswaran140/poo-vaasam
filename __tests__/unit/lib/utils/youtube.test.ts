import {
  getYouTubeId,
  getYouTubeEmbedUrl,
  isYouTubeUrl,
  getYouTubeWatchUrl,
} from '@/lib/utils/youtube';

const ID = 'dQw4w9WgXcQ';

describe('getYouTubeId', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}&t=30s`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}&feature=share`, ID],
  ])('extracts the id from %s', (url, expected) => {
    expect(getYouTubeId(url)).toBe(expected);
  });

  it.each([
    ['https://example.com/song.mp4'],
    ['https://vimeo.com/12345'],
    ['not a url'],
    [''],
    [null],
    [undefined],
  ])('returns null for non-YouTube input %s', (url) => {
    expect(getYouTubeId(url as string)).toBeNull();
  });
});

describe('getYouTubeEmbedUrl', () => {
  it('converts a watch URL into an embed URL', () => {
    expect(getYouTubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(
      `https://www.youtube.com/embed/${ID}?rel=0&playsinline=1`
    );
  });

  it('sets rel=0 so end-screen suggestions stay on our channel (never third-party)', () => {
    expect(getYouTubeEmbedUrl(`https://youtu.be/${ID}`)).toContain('rel=0');
  });

  it('plays within a playlist so the song continues to the next one', () => {
    expect(getYouTubeEmbedUrl(`https://youtu.be/${ID}`, { playlist: 'PLabc123' })).toBe(
      `https://www.youtube.com/embed/${ID}?rel=0&playsinline=1&list=PLabc123`
    );
  });

  it('omits the list param when no playlist is given', () => {
    expect(getYouTubeEmbedUrl(`https://youtu.be/${ID}`)).not.toContain('list=');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(getYouTubeEmbedUrl('https://example.com/x.mp3')).toBeNull();
  });
});

describe('isYouTubeUrl', () => {
  it('is true for YouTube links and false otherwise', () => {
    expect(isYouTubeUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isYouTubeUrl('https://example.com')).toBe(false);
    expect(isYouTubeUrl('')).toBe(false);
  });
});

describe('getYouTubeWatchUrl', () => {
  it('normalizes any YouTube form to a canonical watch URL', () => {
    expect(getYouTubeWatchUrl(`https://youtu.be/${ID}`)).toBe(
      `https://www.youtube.com/watch?v=${ID}`
    );
  });

  it('returns null for a non-YouTube URL', () => {
    expect(getYouTubeWatchUrl('https://example.com')).toBeNull();
  });
});
