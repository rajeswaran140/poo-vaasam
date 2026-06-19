import {
  getYouTubeId,
  getYouTubeEmbedUrl,
  isYouTubeUrl,
  getYouTubeWatchUrl,
  resolveWatchUrl,
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
      `https://www.youtube.com/embed/${ID}`
    );
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

describe('resolveWatchUrl', () => {
  it('prefers an explicit YouTube videoUrl', () => {
    expect(resolveWatchUrl(`https://youtu.be/${ID}`, 'someOtherId1')).toBe(
      `https://youtu.be/${ID}`
    );
  });

  it('falls back to youtubeVideoId when videoUrl is absent (the bug fix)', () => {
    // Auto-published songs carry only the ID — the embed must still resolve.
    expect(resolveWatchUrl(undefined, ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(resolveWatchUrl('', ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('falls back to the ID when videoUrl is not a YouTube link', () => {
    expect(resolveWatchUrl('https://example.com/clip.mp4', ID)).toBe(
      `https://www.youtube.com/watch?v=${ID}`
    );
  });

  it('returns undefined when neither yields a valid YouTube link', () => {
    expect(resolveWatchUrl(undefined, undefined)).toBeUndefined();
    expect(resolveWatchUrl('https://example.com', '')).toBeUndefined();
    // A malformed id (not 11 chars) does not produce a playable embed.
    expect(resolveWatchUrl(undefined, 'too-short')).toBeUndefined();
  });
});
