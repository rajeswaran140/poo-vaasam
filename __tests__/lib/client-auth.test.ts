/**
 * Tests for client-auth: attaching the Cognito ID token to admin API calls.
 */

const mockCurrentSession = jest.fn();
jest.mock('aws-amplify', () => ({
  Auth: { currentSession: () => mockCurrentSession() },
}));

import { getIdToken, adminFetch } from '@/lib/client-auth';

const originalFetch = global.fetch;

beforeEach(() => {
  mockCurrentSession.mockReset();
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe('getIdToken', () => {
  it('returns the current ID-token JWT', async () => {
    mockCurrentSession.mockResolvedValue({
      getIdToken: () => ({ getJwtToken: () => 'jwt-tok' }),
    });
    expect(await getIdToken()).toBe('jwt-tok');
  });

  it('returns null when there is no session', async () => {
    mockCurrentSession.mockRejectedValue(new Error('No current user'));
    expect(await getIdToken()).toBeNull();
  });
});

describe('adminFetch', () => {
  it('attaches the Bearer token and credentials', async () => {
    mockCurrentSession.mockResolvedValue({
      getIdToken: () => ({ getJwtToken: () => 'jwt-tok' }),
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await adminFetch('/api/x', { method: 'POST' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-tok');
  });

  it('omits Authorization when no token is available', async () => {
    mockCurrentSession.mockRejectedValue(new Error('nope'));
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await adminFetch('/api/x');

    const init = fetchMock.mock.calls[0][1];
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(init.credentials).toBe('include');
  });
});
