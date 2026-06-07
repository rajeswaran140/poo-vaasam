/**
 * SongCatalog use case — the read-side application service. Depends only on
 * the IContentRepository abstraction (dependency inversion), so it's tested
 * with an in-memory fake repository, no DynamoDB.
 */

import { SongCatalog } from '@/application/use-cases/SongCatalog';
import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';
import type { IContentRepository } from '@/domain/repositories/IContentRepository';
import type { ContentQueryOptions, PaginatedContent } from '@/types/content';

function song(id: string, overrides: Record<string, unknown> = {}): Content {
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

/** Records the args it was called with, returns a canned page. */
function fakeRepo(items: Content[]): { repo: IContentRepository; calls: ContentQueryOptions[]; types: ContentType[] } {
  const calls: ContentQueryOptions[] = [];
  const types: ContentType[] = [];
  const page: PaginatedContent = { items, total: items.length, limit: 100, hasMore: false };
  const repo = {
    findByType: jest.fn(async (type: ContentType, options?: ContentQueryOptions) => {
      types.push(type);
      if (options) calls.push(options);
      return page;
    }),
  } as unknown as IContentRepository;
  return { repo, calls, types };
}

describe('SongCatalog.listPublished', () => {
  it('queries SONGS filtered to PUBLISHED', async () => {
    const { repo, calls, types } = fakeRepo([song('a')]);
    await new SongCatalog(repo).listPublished();
    expect(types[0]).toBe(ContentType.SONGS);
    expect(calls[0].status).toBe(ContentStatus.PUBLISHED);
  });

  it('maps each song to the public DTO', async () => {
    const { repo } = fakeRepo([song('a'), song('b')]);
    const out = await new SongCatalog(repo).listPublished();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'a', slug: 'song-a', audio: { url: 'https://cdn/a.mp3' } });
    // plain JSON, no domain methods leaking out
    expect(typeof (out[0] as { toJSON?: unknown }).toJSON).toBe('undefined');
  });

  it('drops songs without audio (unplayable never reaches a client)', async () => {
    const { repo } = fakeRepo([song('a'), song('b', { audioUrl: undefined })]);
    const out = await new SongCatalog(repo).listPublished();
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('returns an empty array when the catalog is empty', async () => {
    const { repo } = fakeRepo([]);
    expect(await new SongCatalog(repo).listPublished()).toEqual([]);
  });

  it('passes a custom limit through to the repository', async () => {
    const { repo, calls } = fakeRepo([song('a')]);
    await new SongCatalog(repo).listPublished(25);
    expect(calls[0].limit).toBe(25);
  });
});
