/** @jest-environment node */
/**
 * POST /api/admin/content/sync-youtube-songs — reads the channel and creates
 * YouTube-only song pages for the approved subset. All I/O is mocked; the tests
 * assert the read-only + no-S3 contract and the dry-run gate.
 */
import { NextRequest } from 'next/server';

const requireAdmin = jest.fn();
const requireBearer = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
  requireBearer: (...a: unknown[]) => requireBearer(...a),
  authErrorResponse: () => new Response('unauthorized', { status: 401 }),
}));

const isConfigured = jest.fn(() => true);
jest.mock('@/config/site', () => ({
  SITE: { youtube: { channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } },
  isYouTubeVideosConfigured: () => isConfigured(),
}));

const fetchChannelVideos = jest.fn();
jest.mock('@/lib/youtube-feed', () => ({ fetchChannelVideos: (...a: unknown[]) => fetchChannelVideos(...a) }));

const findByType = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findByType })),
}));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({ CategoryRepository: jest.fn() }));
jest.mock('@/infrastructure/database/TagRepository', () => ({ TagRepository: jest.fn() }));

const execute = jest.fn();
jest.mock('@/application/use-cases/CreateContentUseCase', () => ({
  CreateContentUseCase: jest.fn().mockImplementation(() => ({ execute })),
}));

import { POST } from '@/app/api/admin/content/sync-youtube-songs/route';

const v = (id: string, title: string, duration?: string) => ({
  id,
  title,
  description: '',
  publishedAt: '',
  thumbnail: '',
  watchUrl: `https://www.youtube.com/watch?v=${id}`,
  duration,
});

const post = (body: unknown) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/admin/content/sync-youtube-songs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ email: 'a' });
  requireBearer.mockReturnValue(undefined);
  isConfigured.mockReturnValue(true);
  // One existing page for Song B; the loop ends when lastEvaluatedKey is undefined.
  findByType.mockResolvedValue({
    items: [{ youtubeVideoId: 'bbbbbbbbbbb', videoUrl: null }],
    hasMore: false,
    lastEvaluatedKey: undefined,
  });
  fetchChannelVideos.mockResolvedValue([
    v('aaaaaaaaaaa', 'Song A', 'PT4M0S'),
    v('bbbbbbbbbbb', 'Song B', 'PT5M0S'),
    v('ccccccccccc', 'Short', 'PT0M40S'),
  ]);
  execute.mockImplementation(async (dto: { youtubeVideoId: string }) => ({ id: `cnt_new_${dto.youtubeVideoId}` }));
  global.fetch = jest.fn().mockResolvedValue({ ok: true }); // maxres HEAD ok
});

it('401s when not an admin', async () => {
  requireAdmin.mockRejectedValueOnce(new Error('no'));
  expect((await post({})).status).toBe(401);
});

it('503s when the channel is not configured', async () => {
  isConfigured.mockReturnValueOnce(false);
  expect((await post({ dryRun: true })).status).toBe(503);
});

it('dry-run lists missing long-form songs and writes nothing', async () => {
  const json = await (await post({ dryRun: true })).json();
  expect(json.dryRun).toBe(true);
  expect(json.missing.map((m: { id: string }) => m.id)).toEqual(['aaaaaaaaaaa']); // B exists, C is a Short
  expect(execute).not.toHaveBeenCalled();
});

it('creates YouTube-only pages for the approved subset (no S3, no YouTube writes)', async () => {
  const json = await (await post({ dryRun: false, videoIds: ['aaaaaaaaaaa'] })).json();

  expect(execute).toHaveBeenCalledTimes(1);
  const dto = execute.mock.calls[0][0];
  expect(dto).toMatchObject({
    type: 'SONGS',
    status: 'PUBLISHED',
    youtubeVideoId: 'aaaaaaaaaaa',
    videoUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    featuredImage: 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg',
  });
  expect(dto.body).toContain('ஒலி வடிவப் பாடல்'); // neutral stub, no lyrics
  expect(dto.audioUrl).toBeUndefined(); // NO S3 audio
  expect(json.created).toEqual([{ id: 'cnt_new_aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', title: 'Song A' }]);
  expect(json.needsRedeploy).toBe(true);
});

it('ignores approved ids that are not actually missing (Shorts / already-published)', async () => {
  const json = await (await post({ dryRun: false, videoIds: ['ccccccccccc', 'bbbbbbbbbbb'] })).json();
  expect(execute).not.toHaveBeenCalled();
  expect(json.created).toEqual([]);
});

it('falls back to hqdefault when maxres 404s', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
  await post({ dryRun: false, videoIds: ['aaaaaaaaaaa'] });
  expect(execute.mock.calls[0][0].featuredImage).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
});
