import { missingSongVideos, songStubBody, ytThumbnailCandidates } from '@/lib/youtube-song-sync';

const v = (id: string, title: string, duration?: string) => ({
  id,
  title,
  description: '',
  publishedAt: '',
  thumbnail: '',
  watchUrl: `https://www.youtube.com/watch?v=${id}`,
  duration,
});

describe('missingSongVideos', () => {
  it('returns long-form songs without a page, excluding Shorts and existing ones', () => {
    const channel = [
      v('aaaaaaaaaaa', 'Song A', 'PT4M30S'), // long-form, no page → missing
      v('bbbbbbbbbbb', 'Song B', 'PT5M0S'), //  long-form, already has a page
      v('ccccccccccc', 'Short C', 'PT0M45S'), // Short → excluded
      v('ddddddddddd', 'Song D'), //             unknown duration → treated long-form
    ];
    const out = missingSongVideos(channel, ['bbbbbbbbbbb']);
    expect(out.map((m) => m.id)).toEqual(['aaaaaaaaaaa', 'ddddddddddd']);
    expect(out[0]).toEqual({
      id: 'aaaaaaaaaaa',
      title: 'Song A',
      watchUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    });
  });

  it('drops items with no id', () => {
    expect(missingSongVideos([v('', 'X', 'PT4M')], [])).toEqual([]);
  });
});

describe('songStubBody', () => {
  it('is the neutral, lyrics-free stub', () => {
    expect(songStubBody('தலைப்பு')).toBe('தலைப்பு — ஒலி வடிவப் பாடல். முழு வீடியோ YouTube-ல்.');
  });
});

describe('ytThumbnailCandidates', () => {
  it('returns direct i.ytimg URLs (maxres → hq), never S3', () => {
    const [maxres, hq] = ytThumbnailCandidates('zzzzzzzzzzz');
    expect(maxres).toBe('https://i.ytimg.com/vi/zzzzzzzzzzz/maxresdefault.jpg');
    expect(hq).toBe('https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg');
    expect(maxres).not.toMatch(/amazonaws|cloudfront/);
  });
});
