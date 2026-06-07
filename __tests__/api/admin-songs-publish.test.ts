/** @jest-environment node */
/**
 * POST /api/admin/songs/publish — one-call publish (Phase 1: create + auto-link
 * + auto-duration). Mocks the boundaries (auth, repo, use case, uploads, derive);
 * keeps the pure matchers (matchVideoByTitle/isShort) real.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindByType = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findByType: mockFindByType })),
}));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({ CategoryRepository: jest.fn() }));
jest.mock('@/infrastructure/database/TagRepository', () => ({ TagRepository: jest.fn() }));

const mockExecute = jest.fn();
jest.mock('@/application/use-cases/CreateContentUseCase', () => ({
  CreateContentUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

const mockFetchUploads = jest.fn();
jest.mock('@/lib/youtube-uploads', () => ({
  fetchChannelUploadsWithDurations: (...a: unknown[]) => mockFetchUploads(...a),
}));
const mockDerive = jest.fn();
jest.mock('@/lib/derive-song-duration', () => ({
  deriveDurationSeconds: (...a: unknown[]) => mockDerive(...a),
}));
jest.mock('@/infrastructure/storage/s3-client', () => ({ S3Operations: { getRange: jest.fn() } }));
const mockSetTheme = jest.fn();
jest.mock('@/lib/song-theme-write', () => ({ setSongTheme: (...a: unknown[]) => mockSetTheme(...a) }));
const mockGenCover = jest.fn();
jest.mock('@/application/use-cases/GenerateSongCover', () => ({
  generateSongCover: (...a: unknown[]) => mockGenCover(...a),
}));
const mockTrigger = jest.fn();
jest.mock('@/lib/amplify-deploy', () => ({ triggerRelease: (...a: unknown[]) => mockTrigger(...a) }));

import { POST } from '@/app/api/admin/songs/publish/route';
import * as auth from '@/lib/auth-helper';

const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/songs/publish', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const S3 = 'https://tamil-web-media.s3.us-east-1.amazonaws.com';

beforeEach(() => {
  jest.clearAllMocks();
  (auth.requireAdmin as jest.Mock).mockResolvedValue({ isAuthenticated: true });
  mockFindByType.mockResolvedValue({ items: [] });
  mockFetchUploads.mockResolvedValue([]);
  mockDerive.mockResolvedValue(undefined);
  mockSetTheme.mockResolvedValue(undefined);
  mockGenCover.mockResolvedValue({ ok: true, featuredImage: `${S3}/images/song-covers/cnt_new-1.png` });
  mockTrigger.mockResolvedValue({ ok: true, jobId: '181' });
  process.env.AMPLIFY_APP_ID = 'd3rkmepk4popv0';
  mockExecute.mockImplementation(async (dto: Record<string, unknown>) => ({
    toObject: () => ({
      id: 'cnt_new',
      title: dto.title,
      audioDuration: dto.audioDuration ?? null,
      youtubeVideoId: dto.youtubeVideoId ?? null,
    }),
  }));
});
afterEach(() => {
  delete process.env.AMPLIFY_APP_ID;
});

it('403s for a non-admin (no create)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  (auth.requireAdmin as jest.Mock).mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await POST(req({ title: 'X', audioUrl: `${S3}/a.wav` }));
  expect(res.status).toBe(403);
  expect(mockExecute).not.toHaveBeenCalled();
});

it('400s when audioUrl is missing', async () => {
  const res = await POST(req({ title: 'No Audio' }));
  expect(res.status).toBe(400);
  expect(mockExecute).not.toHaveBeenCalled();
});

it('409s when the title is already a published song', async () => {
  mockFindByType.mockResolvedValueOnce({ items: [{ title: 'Existing Song' }] });
  const res = await POST(req({ title: 'Existing Song', audioUrl: `${S3}/a.wav` }));
  expect(res.status).toBe(409);
  expect(mockExecute).not.toHaveBeenCalled();
});

it('creates a PUBLISHED song with the WAV-derived duration', async () => {
  mockDerive.mockResolvedValueOnce(254);
  const res = await POST(req({ title: 'Brand New Song', audioUrl: `${S3}/audio/poem-music/x.wav` }));
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(mockExecute).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'SONGS', status: 'PUBLISHED', audioDuration: 254, audioUrl: expect.stringContaining('x.wav') })
  );
  expect(body.data.audioDuration).toBe(254);
});

it('auto-links to the matching long-form YouTube upload', async () => {
  mockFetchUploads.mockResolvedValueOnce([
    { id: 'aaaaaaaaaaa', title: 'Kaadhal Paadal', duration: 'PT4M14S' },
    { id: 'sssssssssss', title: 'Kaadhal Paadal Short', duration: 'PT45S' }, // a Short
  ]);
  mockDerive.mockResolvedValueOnce(254);
  const res = await POST(req({ title: 'Kaadhal Paadal', audioUrl: `${S3}/a.wav` }));
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ youtubeVideoId: 'aaaaaaaaaaa' }));
  expect(body.data.youtubeVideoId).toBe('aaaaaaaaaaa');
  expect(body.data.matched).toBe(true);
  // derive got the matched video's ISO duration as the fallback
  expect(mockDerive).toHaveBeenCalledWith(expect.objectContaining({ matchedVideoDuration: 'PT4M14S' }));
});

it('uses an explicit youtubeVideoId + audioDuration verbatim (no lookups)', async () => {
  const res = await POST(
    req({ title: 'Manual', audioUrl: `${S3}/a.wav`, youtubeVideoId: 'bbbbbbbbbbb', audioDuration: 200 })
  );
  expect(res.status).toBe(201);
  expect(mockFetchUploads).not.toHaveBeenCalled();
  expect(mockDerive).not.toHaveBeenCalled();
  expect(mockExecute).toHaveBeenCalledWith(
    expect.objectContaining({ youtubeVideoId: 'bbbbbbbbbbb', audioDuration: 200 })
  );
});

it('sets the theme and generates a cover after creating', async () => {
  const res = await POST(req({ title: 'Themed Song', audioUrl: `${S3}/a.wav`, theme: 'mother' }));
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(mockSetTheme).toHaveBeenCalledWith('cnt_new', 'mother');
  expect(mockGenCover).toHaveBeenCalledWith('cnt_new');
  expect(body.data.theme).toBe('mother');
  expect(body.data.featuredImage).toContain('song-covers');
});

it('still publishes (201) when cover generation fails — best-effort', async () => {
  mockGenCover.mockResolvedValueOnce({ ok: false, status: 503, error: 'OpenAI not configured' });
  const res = await POST(req({ title: 'No Cover Song', audioUrl: `${S3}/a.wav` }));
  const body = await res.json();
  expect(res.status).toBe(201); // publish is not rolled back
  expect(body.data.featuredImage).toBeNull();
  expect(body.data.coverError).toBe('OpenAI not configured');
});

it('skips cover generation when generateCover is false', async () => {
  const res = await POST(req({ title: 'Bare Song', audioUrl: `${S3}/a.wav`, generateCover: false }));
  expect(res.status).toBe(201);
  expect(mockGenCover).not.toHaveBeenCalled();
});

it('triggers an Amplify deploy and returns the jobId', async () => {
  const res = await POST(req({ title: 'Deployed Song', audioUrl: `${S3}/a.wav` }));
  const body = await res.json();
  expect(mockTrigger).toHaveBeenCalledWith('d3rkmepk4popv0', 'master');
  expect(body.data.deploy).toEqual({ jobId: '181' });
});

it('skips deploy when deploy is false', async () => {
  const res = await POST(req({ title: 'No Deploy Song', audioUrl: `${S3}/a.wav`, deploy: false }));
  expect(res.status).toBe(201);
  expect(mockTrigger).not.toHaveBeenCalled();
});

it('still publishes (201) when the deploy trigger fails', async () => {
  mockTrigger.mockResolvedValueOnce({ ok: false, error: 'AccessDenied: amplify:StartJob' });
  const res = await POST(req({ title: 'Deploy Fails Song', audioUrl: `${S3}/a.wav` }));
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(body.data.deployError).toContain('AccessDenied');
});
