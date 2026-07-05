/** @jest-environment node */
/**
 * Tests for GET /api/lyrics/[id] — the server-side gate. No/invalid cookie →
 * 401 and the DB is never read; a valid cookie returns the lyrics only for a
 * PUBLISHED, showLyrics song with a body; showLyrics=false → 404. DB is mocked.
 */

const mockGet = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { get: (...a: unknown[]) => mockGet(...a) },
}));

import { GET } from '@/app/api/lyrics/[id]/route';
import { signGateToken, LYRICS_GATE_COOKIE } from '@/lib/lyrics-gate';
import { NextRequest } from 'next/server';

const validCookie = () => `${LYRICS_GATE_COOKIE}=${signGateToken({ v: 1, at: new Date().toISOString() })}`;

function get(id: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return GET(
    new NextRequest(new Request(`https://tamilagaval.com/api/lyrics/${id}`, { headers })),
    { params: Promise.resolve({ id }) }
  );
}

const shownSong = {
  id: 'cnt_1_a',
  title: 'எங்கள் தேசம்',
  titleSlug: 'engal-thesam',
  body: 'வரி ஒன்று\nவரி இரண்டு',
  featuredImage: 'https://cdn/x.jpg',
  status: 'PUBLISHED',
  type: 'SONGS',
  showLyrics: true,
};

beforeEach(() => {
  mockGet.mockReset();
  process.env.LYRICS_GATE_SECRET = 'unit-test-secret-1';
});

it('401s with no gate cookie and never reads the DB', async () => {
  const res = await get('cnt_1_a');
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe('locked');
  expect(mockGet).not.toHaveBeenCalled();
});

it('401s with a tampered gate cookie and never reads the DB', async () => {
  const res = await get('cnt_1_a', `${LYRICS_GATE_COOKIE}=abc.def`);
  expect(res.status).toBe(401);
  expect(mockGet).not.toHaveBeenCalled();
});

it('returns the lyrics for a valid cookie + published showLyrics song', async () => {
  mockGet.mockResolvedValueOnce(shownSong);
  const res = await get('cnt_1_a', validCookie());
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
  expect(json.lyrics).toEqual({
    id: 'cnt_1_a',
    title: 'எங்கள் தேசம்',
    body: 'வரி ஒன்று\nவரி இரண்டு',
    titleSlug: 'engal-thesam',
    featuredImage: 'https://cdn/x.jpg',
  });
});

it('404s when showLyrics is false even with a valid cookie', async () => {
  mockGet.mockResolvedValueOnce({ ...shownSong, showLyrics: false });
  const res = await get('cnt_1_a', validCookie());
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe('not found');
});

it('404s when the song is not published', async () => {
  mockGet.mockResolvedValueOnce({ ...shownSong, status: 'DRAFT' });
  const res = await get('cnt_1_a', validCookie());
  expect(res.status).toBe(404);
});

it('404s when the song has no body', async () => {
  mockGet.mockResolvedValueOnce({ ...shownSong, body: '   ' });
  const res = await get('cnt_1_a', validCookie());
  expect(res.status).toBe(404);
});
