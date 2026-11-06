/** @jest-environment node */
/** Uploading your own picture to a shot: it becomes a free STILL candidate. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  putCandidate: jest.fn(),
  selectCandidateIfNone: jest.fn(),
  reserve: jest.fn(),
  settle: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockPresign = jest.fn();
const mockLength = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    getSignedUploadPost: (...a: unknown[]) => mockPresign(...a),
    getContentLength: (...a: unknown[]) => mockLength(...a),
  },
}));

import { POST } from '@/app/api/admin/visual-story/[vsId]/shots/[shotKey]/upload/route';
import * as auth from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { candidateKey, refKey, MAX_REF_BYTES } from '@/lib/visual-story-storage';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const CH = 'ch_1700000000000_abcdef12';
const CD = 'cd_1700000000000_abcdef12';

const mk = (body: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? { Authorization: 'Bearer t' } : undefined,
  });
const ctx = (shotKey = '001-002', vsId = VS) => ({ params: Promise.resolve({ vsId, shotKey }) });

const shot = (sceneOrder: number, shotOrder: number) => ({
  sceneOrder,
  shotOrder,
  mode: 'HERO',
  durationSec: 6,
  startSec: 0,
  visualPrompt: 'A lamp',
  negativePrompt: '',
  charIds: [],
  selectedCandidateId: null,
});
const tree = (candidates: unknown[] = []) => ({
  story: { vsId: VS, aspectRatio: '9:16', budgetUsdCap: 1, spentUsd: 0, reservedUsd: 0 },
  scenes: [{ order: 1, heading: 'Scene 1', summary: '' }],
  shots: [shot(1, 1), shot(1, 2)],
  characters: [],
  candidates,
  drafts: [],
  jobs: [],
});

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.loadTree.mockResolvedValue(tree());
  mockPresign.mockResolvedValue({ url: 'https://s3/x', fields: { a: 'b' } });
  mockLength.mockResolvedValue(2048);
});

describe('guards', () => {
  it('401 without a bearer token', async () => {
    expect((await POST(mk({ op: 'presign', contentType: 'image/png' }, false), ctx())).status).toBe(401);
    expect((await POST(mk({ op: 'confirm', key: 'k' }, false), ctx())).status).toBe(401);
  });
  it('404 for a malformed story id, a malformed shot key, or a shot not on the story', async () => {
    expect((await POST(mk({ op: 'presign', contentType: 'image/png' }), ctx('001-002', '../x'))).status).toBe(404);
    expect((await POST(mk({ op: 'presign', contentType: 'image/png' }), ctx('1-2'))).status).toBe(404);
    expect((await POST(mk({ op: 'presign', contentType: 'image/png' }), ctx('002-001'))).status).toBe(404);
    expect(mockPresign).not.toHaveBeenCalled();
  });
  it('404 when the story is gone', async () => {
    repo.loadTree.mockResolvedValue(null);
    expect((await POST(mk({ op: 'presign', contentType: 'image/png' }), ctx())).status).toBe(404);
  });
});

describe('presign', () => {
  it('presigns a server-built candidate key with a pinned type, 1..MAX size and 1 h TTL', async () => {
    const res = await POST(mk({ op: 'presign', contentType: 'image/jpeg', size: 1000, key: 'audio/x.jpg' }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(new RegExp(`^audio/mastering/visual-story/${VS}/candidates/cd_\\d+_[a-z0-9]{8}\\.jpg$`));
    expect(body.uploadUrl).toBe('https://s3/x');
    expect(mockPresign).toHaveBeenCalledWith(body.key, 'image/jpeg', MAX_REF_BYTES, 3600, 1);
  });
  it('a PNG gets a .png key', async () => {
    const body = await (await POST(mk({ op: 'presign', contentType: 'image/png' }), ctx())).json();
    expect(body.key.endsWith('.png')).toBe(true);
  });
  it('refuses WebP, GIF and non-images', async () => {
    for (const t of ['image/webp', 'image/gif', 'video/mp4', 'application/pdf']) {
      const res = await POST(mk({ op: 'presign', contentType: t }), ctx());
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/JPEG or PNG/);
    }
    expect(mockPresign).not.toHaveBeenCalled();
  });
  it('refuses a declared size over the cap', async () => {
    expect((await POST(mk({ op: 'presign', contentType: 'image/png', size: MAX_REF_BYTES + 1 }), ctx())).status).toBe(400);
  });
  it('502 when presigning fails', async () => {
    mockPresign.mockRejectedValue(new Error('aws'));
    expect((await POST(mk({ op: 'presign', contentType: 'image/png' }), ctx())).status).toBe(502);
  });
});

describe('confirm', () => {
  it('adds a free STILL candidate on this shot once HeadObject finds the file, and never touches the budget', async () => {
    const key = candidateKey(VS, CD, 'png');
    const res = await POST(mk({ op: 'confirm', key }), ctx());
    expect(res.status).toBe(201);
    expect(mockLength).toHaveBeenCalledWith(key);
    const cand = repo.putCandidate.mock.calls[0][1];
    expect(repo.putCandidate).toHaveBeenCalledWith(VS, expect.anything());
    expect(cand).toMatchObject({
      candId: CD,
      sceneOrder: 1,
      shotOrder: 2,
      jobId: null,
      providerId: 'upload',
      providerTaskId: null,
      mode: 'STILL',
      s3Key: key,
      costUsd: 0,
    });
    expect((await res.json()).data.candidate.candId).toBe(CD);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });
  it('chooses the uploaded picture when the shot has nothing chosen; a failed choose keeps the 201', async () => {
    const key = candidateKey(VS, CD, 'jpg');
    repo.selectCandidateIfNone.mockResolvedValueOnce(true);
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(201);
    expect(repo.selectCandidateIfNone).toHaveBeenCalledWith(VS, 1, 2, CD);
    repo.selectCandidateIfNone.mockRejectedValueOnce(new Error('ddb down'));
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(201);
  });
  it('400 for a key that is not a picture key of this story, and never heads S3', async () => {
    for (const key of [
      candidateKey(VS, CD, 'mp4'),
      candidateKey('vs_1700000000001_zzzzzz99', CD, 'jpg'),
      refKey(VS, CH, 'png'),
      'audio/mastering/other.wav',
      '',
    ]) {
      expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(400);
    }
    expect(mockLength).not.toHaveBeenCalled();
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });
  it('is idempotent for the same picture on the same shot', async () => {
    const key = candidateKey(VS, CD, 'jpg');
    repo.loadTree.mockResolvedValue(
      tree([{ candId: CD, sceneOrder: 1, shotOrder: 2, mode: 'STILL', s3Key: key, providerId: 'upload' }])
    );
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(200);
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });
  it('409 when that id already belongs to another candidate (e.g. a Grok still)', async () => {
    const key = candidateKey(VS, CD, 'jpg');
    repo.loadTree.mockResolvedValue(
      tree([{ candId: CD, sceneOrder: 1, shotOrder: 1, mode: 'STILL', s3Key: key, providerId: 'grok-image' }])
    );
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(409);
    expect(mockLength).not.toHaveBeenCalled();
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });
  it('400 when the file is missing, empty or over the cap; 502 when S3 cannot be checked', async () => {
    const key = candidateKey(VS, CD, 'jpg');
    mockLength.mockResolvedValueOnce(null);
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(400);
    mockLength.mockResolvedValueOnce(0);
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(400);
    mockLength.mockResolvedValueOnce(MAX_REF_BYTES + 1);
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(400);
    mockLength.mockRejectedValueOnce(new Error('aws'));
    expect((await POST(mk({ op: 'confirm', key }), ctx())).status).toBe(502);
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });
});
