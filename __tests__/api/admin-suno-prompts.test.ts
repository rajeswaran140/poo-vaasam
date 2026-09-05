/** @jest-environment node */
/**
 * GET/POST /api/admin/suno-prompts — admin gate, CSRF bearer on the mutation,
 * validation, and the audio-influence invariant enforced at the API boundary
 * rather than trusted from the UI.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindAll = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/infrastructure/database/SunoPromptRepository', () => ({
  SunoPromptRepository: jest.fn().mockImplementation(() => ({
    findAll: mockFindAll,
    create: mockCreate,
  })),
}));

import { GET, POST } from '@/app/api/admin/suno-prompts/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const BEARER = { Authorization: 'Bearer test-token' };

const get = () => GET(new NextRequest('https://tamilagaval.com/api/admin/suno-prompts'));
const post = (b: unknown, withBearer = true) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/admin/suno-prompts', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: withBearer ? BEARER : undefined,
    })
  );

const valid = (over: Record<string, unknown> = {}) => ({
  title: 'Enna Idhu Kadhalā — folk take',
  lyrics: 'என்ன இது காதலா',
  style: 'Tamil village folk',
  styleBox: 'tamil folk, thavil, warm male lead',
  exclude: ['autotune'],
  lyricsBlock: '[Verse - flute intro]\nஎன்ன இது காதலா',
  weirdness: 50,
  styleInfluence: 80,
  usesAudioUpload: false,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});

describe('admin gate', () => {
  it('GET 403 for a non-admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await get()).status).toBe(403);
    expect(mockFindAll).not.toHaveBeenCalled();
  });

  it('POST 401 without a Bearer token (CSRF defense)', async () => {
    expect((await post(valid(), false)).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns saved prompts', async () => {
    mockFindAll.mockResolvedValue([{ id: 'snp_1', title: 'one' }]);
    const body = await (await get()).json();
    expect(body.success).toBe(true);
    expect(body.prompts).toHaveLength(1);
  });
});

describe('POST validation', () => {
  it('creates a valid prompt', async () => {
    mockCreate.mockResolvedValue({ id: 'snp_1', ...valid() });
    const res = await post(valid());
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('400s without a style — the generator cannot run without one', async () => {
    const res = await post(valid({ style: '' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('400s without a title', async () => {
    expect((await post(valid({ title: '' }))).status).toBe(400);
  });

  it('400s on a slider outside 0-100', async () => {
    expect((await post(valid({ weirdness: 101 }))).status).toBe(400);
    expect((await post(valid({ styleInfluence: -1 }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('400s on more exclude entries than Suno accepts', async () => {
    expect((await post(valid({ exclude: ['a', 'b', 'c', 'd'] }))).status).toBe(400);
  });
});

describe('the audio-influence invariant', () => {
  it('rejects audioInfluence when the prompt uses no audio upload', async () => {
    const res = await post(valid({ usesAudioUpload: false, audioInfluence: 40 }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepts audioInfluence when the prompt does use an audio upload', async () => {
    mockCreate.mockResolvedValue({ id: 'snp_2' });
    const res = await post(valid({ usesAudioUpload: true, audioInfluence: 40 }));
    expect(res.status).toBe(201);
  });

  it('accepts an audio-upload prompt that has not set the slider yet', async () => {
    mockCreate.mockResolvedValue({ id: 'snp_3' });
    expect((await post(valid({ usesAudioUpload: true }))).status).toBe(201);
  });
});
