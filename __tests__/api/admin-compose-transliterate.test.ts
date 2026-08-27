/** @jest-environment node */
/**
 * GET /api/admin/compose/transliterate — proxy for Google Input Tools.
 * The real fetch is mocked; we test input validation, auth, and upstream-error
 * handling. The upstream JSON pass-through is verified structurally.
 */

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ email: 'admin@test' }),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: 401 })),
}));

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

import { GET } from '@/app/api/admin/compose/transliterate/route';

afterEach(() => {
  fetchMock.mockReset();
});

async function call(qs: string) {
  const req = new Request(`http://localhost/api/admin/compose/transliterate${qs}`);
  const res = await GET(req as unknown as import('next/server').NextRequest);
  return { status: res.status, body: await res.json() };
}

it('passes the upstream JSON through verbatim on success', async () => {
  fetchMock.mockResolvedValue(new Response(
    JSON.stringify(['SUCCESS', [['pallavi', ['பல்லவி', 'பாலாவி'], [], { candidate_type: [0, 0] }]]]),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  const { status, body } = await call('?text=pallavi&lang=ta');
  expect(status).toBe(200);
  expect(body[0]).toBe('SUCCESS');
  expect(body[1][0][1]).toContain('பல்லவி');
});

it('rejects an empty text with 400 [ERROR]', async () => {
  const { status, body } = await call('?text=&lang=ta');
  expect(status).toBe(400);
  expect(body).toEqual(['ERROR']);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects an oversized text (>100 chars) with 400', async () => {
  const { status } = await call(`?text=${'a'.repeat(101)}&lang=ta`);
  expect(status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects control characters in the text (defence against smuggling)', async () => {
  const { status } = await call(`?text=${encodeURIComponent('foo\x00bar')}&lang=ta`);
  expect(status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a malformed lang code', async () => {
  const { status } = await call('?text=pallavi&lang=1234-tamil');
  expect(status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('returns 502 [ERROR] when the upstream fetch throws', async () => {
  fetchMock.mockRejectedValue(new Error('ECONNRESET'));
  const { status, body } = await call('?text=pallavi&lang=ta');
  expect(status).toBe(502);
  expect(body).toEqual(['ERROR']);
});

it('returns 502 [ERROR] when the upstream returns a non-OK status', async () => {
  fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
  const { status, body } = await call('?text=pallavi&lang=ta');
  expect(status).toBe(502);
  expect(body).toEqual(['ERROR']);
});

it('clamps a runaway num parameter to a safe default', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(['SUCCESS', []]), { status: 200 }));
  await call('?text=pallavi&lang=ta&num=999');
  // The upstream URL should carry num=5 (the clamp), not the user's 999.
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('num=5'),
    expect.any(Object),
  );
});
