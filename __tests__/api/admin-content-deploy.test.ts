/** @jest-environment node */
/**
 * POST /api/admin/content auto-triggers a go-live Amplify deploy when the new
 * content is PUBLISHED (the public pages are build-time), and does NOT for a
 * DRAFT. Best-effort: the create still succeeds.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));
jest.mock('@/infrastructure/database/ContentRepository', () => ({ ContentRepository: jest.fn() }));
jest.mock('@/infrastructure/database/CategoryRepository', () => ({ CategoryRepository: jest.fn() }));
jest.mock('@/infrastructure/database/TagRepository', () => ({ TagRepository: jest.fn() }));

// Internals defined INSIDE the factories (route.ts constructs the use case at
// module-load, so an outer `const` would hit the TDZ via the hoisted import).
jest.mock('@/application/use-cases/CreateContentUseCase', () => {
  const execute = jest.fn();
  return { CreateContentUseCase: jest.fn(() => ({ execute })), __execute: execute };
});
jest.mock('@/lib/amplify-deploy', () => ({ triggerReleaseFromEnv: jest.fn() }));

import { POST } from '@/app/api/admin/content/route';
import * as auth from '@/lib/auth-helper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecute = (jest.requireMock('@/application/use-cases/CreateContentUseCase') as any).__execute as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTrigger = (jest.requireMock('@/lib/amplify-deploy') as any).triggerReleaseFromEnv as jest.Mock;

const post = (body: unknown) =>
  POST(new NextRequest(new Request('http://localhost/api/admin/content', {
    method: 'POST',
    body: JSON.stringify(body),
  })));

const base = { type: 'POEMS', title: 'மழையே', body: 'உள்ளடக்கம்', author: 'இராஜ்' };

beforeEach(() => {
  jest.clearAllMocks();
  (auth.requireAdmin as jest.Mock).mockResolvedValue({ isAuthenticated: true, userId: 'a', groups: ['admin'] });
  mockExecute.mockImplementation(async (dto) => ({ toObject: () => ({ id: 'cnt_x', ...dto }) }));
});

describe('POST /api/admin/content — auto deploy on publish', () => {
  it('triggers a deploy when status is PUBLISHED', async () => {
    mockTrigger.mockResolvedValueOnce({ ok: true, jobId: '200' });
    const res = await post({ ...base, status: 'PUBLISHED' });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(json.deploy).toEqual({ triggered: true, jobId: '200' });
  });

  it('does NOT trigger a deploy for a DRAFT', async () => {
    const res = await post({ ...base, status: 'DRAFT' });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockTrigger).not.toHaveBeenCalled();
    expect(json.deploy).toEqual({ triggered: false });
  });

  it('still succeeds (201) when the deploy fails — best effort', async () => {
    mockTrigger.mockResolvedValueOnce({ ok: false, error: 'AccessDenied' });
    const res = await post({ ...base, status: 'PUBLISHED' });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.deploy).toEqual({ triggered: false, error: 'AccessDenied' });
  });
});
