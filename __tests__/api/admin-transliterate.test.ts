/** @jest-environment node */
/** GET /api/admin/transliterate — admin gate, latin-only guard, proxy happy path, graceful upstream failure. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

import { GET } from '@/app/api/admin/transliterate/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const req = (qs: string) => GET(new NextRequest(`https://tamilagaval.com/api/admin/transliterate${qs}`));
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});
afterEach(() => { global.fetch = originalFetch; });

it('returns 403 for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await req('?text=amma')).status).toBe(403);
});

it('returns [] for non-latin / empty input without calling Google', async () => {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  const body = await (await req('?text=' + encodeURIComponent('அம்மா'))).json();
  expect(body.candidates).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('proxies candidates from Google on the happy path', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ['SUCCESS', [['vanakkam', ['வணக்கம்', 'வனக்கம்'], [], {}]]],
  }) as unknown as typeof fetch;
  const body = await (await req('?text=vanakkam')).json();
  expect(body.success).toBe(true);
  expect(body.candidates).toEqual(['வணக்கம்', 'வனக்கம்']);
});

it('degrades to [] when the upstream fails (typing never breaks)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
  const res = await req('?text=kaadhal');
  expect(res.status).toBe(200);
  expect((await res.json()).candidates).toEqual([]);
});
