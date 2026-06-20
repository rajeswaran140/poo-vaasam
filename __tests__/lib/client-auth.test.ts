/**
 * Tests for client-auth: attaching the Cognito ID token to admin API calls.
 */

const mockCurrentSession = jest.fn();
const mockSignOut = jest.fn();
jest.mock('aws-amplify', () => ({
  Auth: { currentSession: () => mockCurrentSession(), signOut: () => mockSignOut() },
}));

import { getIdToken, adminFetch } from '@/lib/client-auth';

const originalFetch = global.fetch;

beforeEach(() => {
  mockCurrentSession.mockReset();
  mockSignOut.mockReset();
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

  it('signs out (clears the dead session) on a 401', async () => {
    mockCurrentSession.mockResolvedValue({
      getIdToken: () => ({ getJwtToken: () => 'jwt-tok' }),
    });
    mockSignOut.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false }) as unknown as typeof fetch;
    // The handler also calls window.location.assign('/login?…'); jsdom logs a
    // "Not implemented: navigation" notice for that — silence it.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await adminFetch('/api/admin/compose', { method: 'POST' });

    expect(mockSignOut).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('does NOT sign out on a 401 when suppressExpiryRedirect is set (background callers)', async () => {
    // The per-keystroke transliteration aid must degrade quietly, not boot the
    // admin to /login mid-typing.
    mockCurrentSession.mockResolvedValue({
      getIdToken: () => ({ getJwtToken: () => 'jwt-tok' }),
    });
    mockSignOut.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false }) as unknown as typeof fetch;

    const res = await adminFetch('/api/admin/transliterate?text=amma', { suppressExpiryRedirect: true });

    expect(res.status).toBe(401);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does not forward suppressExpiryRedirect into the fetch init', async () => {
    mockCurrentSession.mockResolvedValue({
      getIdToken: () => ({ getJwtToken: () => 'jwt-tok' }),
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await adminFetch('/api/x', { method: 'GET', suppressExpiryRedirect: true });

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('GET');
    expect('suppressExpiryRedirect' in init).toBe(false);
  });
});
