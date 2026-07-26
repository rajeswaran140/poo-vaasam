/** @jest-environment node */
/**
 * Tests for POST /api/admin/prompt-critic — admin gate, validation, and the
 * mapping of critiquePrompt() results to HTTP responses. The LLM service is mocked.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockCritique = jest.fn();
jest.mock('@/services/ai/promptCritic', () => ({
  critiquePrompt: (...a: unknown[]) => mockCritique(...a),
}));

import { POST } from '@/app/api/admin/prompt-critic/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;

const req = (body: unknown, withBearer = true) =>
  new NextRequest('http://localhost/api/admin/prompt-critic', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
  });

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ userId: 'admin', isAdmin: true });
  mockCritique.mockReset();
});

describe('POST /api/admin/prompt-critic', () => {
  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValue(new auth.AuthError('Unauthorized', 401));
    const res = await POST(req({ style: 's', lyrics: 'l' }));
    expect(res.status).toBe(401);
    expect(mockCritique).not.toHaveBeenCalled();
  });

  it('401s without a Bearer token (CSRF defense on the mutation)', async () => {
    const res = await POST(req({ style: 's', lyrics: 'l' }, false));
    expect(res.status).toBe(401);
    expect(mockCritique).not.toHaveBeenCalled();
  });

  it('400s on a missing field', async () => {
    const res = await POST(req({ style: 'only style' }));
    expect(res.status).toBe(400);
    expect(mockCritique).not.toHaveBeenCalled();
  });

  it('returns the critique on success', async () => {
    const critique = { verdict: 'risky', summary: 'mostly fine', issues: [{ severity: 'medium', title: 'Mood mismatch', detail: 'd', fix: 'f' }] };
    mockCritique.mockResolvedValue({ ok: true, critique });
    const res = await POST(req({ style: 'Tamil ballad, flute', lyrics: '[Verse]\nஎல்லார்க்கும்' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.critique).toEqual(critique);
  });

  it('maps not_configured → 503', async () => {
    mockCritique.mockResolvedValue({ ok: false, code: 'not_configured', error: 'no key' });
    const res = await POST(req({ style: 's', lyrics: 'l' }));
    expect(res.status).toBe(503);
    expect((await res.json()).success).toBe(false);
  });

  it('maps rate_limit → 429', async () => {
    mockCritique.mockResolvedValue({ ok: false, code: 'rate_limit', error: 'slow down' });
    const res = await POST(req({ style: 's', lyrics: 'l' }));
    expect(res.status).toBe(429);
  });
});
