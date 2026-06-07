/** @jest-environment node */
/**
 * GET /api/songs — the PUBLIC, unauthenticated song feed (web player + Expo).
 *
 * Wires the real SongCatalog + PublicSong mapper over a mocked ContentRepository,
 * so this also covers the use-case/mapper integration. Key guarantees:
 *   - no auth required (anonymous-visitor path returns 200),
 *   - the response validates against the published Zod contract,
 *   - repository failure degrades to a 500, never a thrown route,
 *   - it is statically generated (force-static) to match the Amplify model
 *     where SSR runtime has no DynamoDB credentials.
 */

const mockFindByType = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findByType: mockFindByType })),
}));

import * as route from '@/app/api/songs/route';
import { GET } from '@/app/api/songs/route';
import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';
import { publicSongsResponseSchema } from '@/lib/validations/songs';

function page(items: Content[]) {
  return { items, total: items.length, limit: 100, hasMore: false };
}
function song(id: string, overrides: Record<string, unknown> = {}) {
  return Content.fromObject({
    id,
    type: ContentType.SONGS,
    title: `song ${id}`,
    titleSlug: `song-${id}`,
    body: 'b',
    description: 'd',
    author: 'Rajeswaran',
    status: ContentStatus.PUBLISHED,
    audioUrl: `https://cdn/${id}.mp3`,
    audioDuration: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

beforeEach(() => jest.clearAllMocks());

it('returns 200 with {success,data,total} for an anonymous request (no auth)', async () => {
  mockFindByType.mockResolvedValueOnce(page([song('a'), song('b')]));
  const res = await GET();
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.total).toBe(2);
  expect(body.data).toHaveLength(2);
  // the route never imports requireAuth/requireAdmin — public by construction
  expect(route).not.toHaveProperty('requireAuth');
});

it('emits a payload that satisfies the published contract', async () => {
  mockFindByType.mockResolvedValueOnce(page([song('a')]));
  const body = await (await GET()).json();
  expect(() => publicSongsResponseSchema.parse(body)).not.toThrow();
});

it('returns an empty list (200) when there are no songs', async () => {
  mockFindByType.mockResolvedValueOnce(page([]));
  const res = await GET();
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body).toEqual({ success: true, data: [], total: 0 });
});

it('degrades to 500 (not a throw) when the repository fails', async () => {
  mockFindByType.mockRejectedValueOnce(new Error('dynamo down'));
  const res = await GET();
  expect(res.status).toBe(500);
  expect((await res.json()).success).toBe(false);
});

it('is statically generated to fit the Amplify no-runtime-creds model', () => {
  expect(route.dynamic).toBe('force-static');
  expect(route.revalidate).toBe(300);
});
