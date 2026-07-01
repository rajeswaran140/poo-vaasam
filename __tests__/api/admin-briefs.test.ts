/** @jest-environment node */
/**
 * Tests for /api/admin/briefs (+ /[id]) — admin gate, validation, save (201),
 * list, and fetch-one (404). BriefRepository is mocked.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockSave = jest.fn();
const mockList = jest.fn();
const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/BriefRepository', () => ({
  BriefRepository: jest.fn().mockImplementation(() => ({
    save: mockSave,
    list: mockList,
    findById: mockFindById,
  })),
}));

import { POST, GET } from '@/app/api/admin/briefs/route';
import { GET as GET_ONE } from '@/app/api/admin/briefs/[id]/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;

// A complete, schema-valid analysis — the briefs route now validates the full
// composer schema before persisting the durable record.
const analysis = {
  emotion: 'அன்னை',
  emotion_breakdown: ['அன்னை', 'பாசம்'],
  mood: 'Warm and devotional',
  theme: 'A mother’s love',
  suggested_key: 'C Major',
  suggested_bpm: 80,
  suggested_instruments: ['Flute', 'Veena', 'Tabla', 'Nadaswaram'],
  suggested_ragas: ['Anandabhairavi', 'Sahana'],
  recommended_voice: ['Female Adult', 'Elder Male'],
  song_titles: ['அன்னையின் அன்பு', 'தாய்மை', 'பாசமலர்'],
  suno_prompts: [{ style: 'Traditional Tamil', prompt: 'Gentle devotional piece led by flute over soft tabla.' }],
  thumbnail_prompt: 'A warm village dawn with a mother and child, soft light.',
  youtube_description_tamil: 'தாயன்பைப் போற்றும் பாடல். #tamilagaval',
  youtube_description_english: 'A song honouring a mother’s love. #tamilagaval',
  reel: { hook: 'அன்னையே', caption: 'For every mother', hashtags: ['#tamil', '#amma'] },
};

const post = (body: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/briefs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
  });
const getReq = (url = 'https://tamilagaval.com/api/admin/briefs') =>
  new NextRequest(url, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('POST returns 403 when caller is not admin (and does not save)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await POST(post({ lyrics: 'l', analysis }));
  expect(res.status).toBe(403);
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST returns 401 without a Bearer token (CSRF defense on the mutation)', async () => {
  const res = await POST(post({ lyrics: 'l', analysis }, false));
  expect(res.status).toBe(401);
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST returns 400 on invalid payload (missing analysis)', async () => {
  const res = await POST(post({ lyrics: 'l' }));
  expect(res.status).toBe(400);
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST rejects a partial/degraded analysis (durable record must be complete)', async () => {
  // Only the dominant emotion — would have slipped through the old loose
  // `.passthrough()` validation; now refused so we never persist a half-brief.
  const res = await POST(post({ lyrics: 'l', analysis: { emotion: 'அன்னை' } }));
  expect(res.status).toBe(400);
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST strips unknown keys from analysis before persisting', async () => {
  mockSave.mockResolvedValueOnce({ id: 'brief_x' });
  const res = await POST(post({ lyrics: 'l', analysis: { ...analysis, injected: 'evil', __proto__hack: 1 } }));
  expect(res.status).toBe(201);
  const savedAnalysis = mockSave.mock.calls[0][0].analysis;
  expect(savedAnalysis).not.toHaveProperty('injected');
  expect(savedAnalysis.emotion).toBe('அன்னை');
});

it('POST saves and returns 201 with the brief', async () => {
  mockSave.mockResolvedValueOnce({ id: 'brief_1', decision: { chosenSunoStyle: 'Traditional Tamil' } });
  const res = await POST(post({ lyrics: 'அரிதான', analysis, decision: { chosenSunoStyle: 'Traditional Tamil' } }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.id).toBe('brief_1');
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({ lyrics: 'அரிதான', decision: { chosenSunoStyle: 'Traditional Tamil' } })
  );
});

it('GET lists briefs (clamps limit) and returns 200', async () => {
  mockList.mockResolvedValueOnce([{ id: 'brief_2' }, { id: 'brief_1' }]);
  const res = await GET(getReq('https://tamilagaval.com/api/admin/briefs?limit=5'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(2);
  expect(mockList).toHaveBeenCalledWith({ limit: 5 });
});

it('GET /[id] returns 404 when the brief is missing', async () => {
  mockFindById.mockResolvedValueOnce(null);
  const res = await GET_ONE(getReq('https://tamilagaval.com/api/admin/briefs/nope'), { params: Promise.resolve({ id: 'nope' }) });
  expect(res.status).toBe(404);
});

it('GET /[id] returns the brief when found', async () => {
  mockFindById.mockResolvedValueOnce({ id: 'brief_9', analysis });
  const res = await GET_ONE(getReq('https://tamilagaval.com/api/admin/briefs/brief_9'), { params: Promise.resolve({ id: 'brief_9' }) });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.id).toBe('brief_9');
});
