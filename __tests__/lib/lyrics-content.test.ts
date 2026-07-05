/** @jest-environment node */
import { LYRICS_VANITY } from '@/lib/lyrics-content';

const mockGet = jest.fn();
const mockQuery = jest.fn();

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    get: (...args: unknown[]) => mockGet(...args),
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

import { getRawSongBySlug, lyricsVisible } from '@/lib/lyrics-content';

describe('lyrics-content vanity resolution', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockQuery.mockReset();
  });

  it('resolves a vanity alias via get(id) and skips the GSI5 query', async () => {
    const id = LYRICS_VANITY['thayagam'];
    mockGet.mockResolvedValue({ id, title: 'எங்கள் தேசம்', titleSlug: 's', body: 'x', status: 'PUBLISHED', showLyrics: true });

    const song = await getRawSongBySlug('thayagam');

    expect(mockGet).toHaveBeenCalledWith({ PK: `CONTENT#${id}`, SK: 'METADATA' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(song?.id).toBe(id);
  });

  it('is case/space-insensitive for the alias', async () => {
    mockGet.mockResolvedValue(null);
    await getRawSongBySlug('  Thayagam ');
    expect(mockGet).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('falls back to the GSI5 slug query for a non-vanity slug', async () => {
    mockQuery.mockResolvedValue({ Items: [] });
    await getRawSongBySlug('எங்கள்-தேசம்');
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();
  });
});

describe('lyricsVisible guard', () => {
  const base = { id: 'x', title: 't', status: 'PUBLISHED', showLyrics: true, body: 'abc' };
  it('true only when PUBLISHED + showLyrics + non-empty body', () => {
    expect(lyricsVisible(base)).toBe(true);
    expect(lyricsVisible({ ...base, showLyrics: false })).toBe(false);
    expect(lyricsVisible({ ...base, status: 'DRAFT' })).toBe(false);
    expect(lyricsVisible({ ...base, body: '   ' })).toBe(false);
    expect(lyricsVisible(null)).toBe(false);
  });
});
