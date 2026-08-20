/** @jest-environment node */
/**
 * The OAuth pair: GET /api/admin/twitch/connect (admin-gated, mints state) and
 * GET /api/twitch/callback (state-gated, completes the connection).
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/application/use-cases/ConnectTwitch', () => ({
  completeConnection: jest.fn(),
}));

import { GET as connectRoute } from '@/app/api/admin/twitch/connect/route';
import { GET as callbackRoute } from '@/app/api/twitch/callback/route';
import * as auth from '@/lib/auth-helper';
import { completeConnection } from '@/application/use-cases/ConnectTwitch';
import { createOAuthState } from '@/lib/twitch/oauth-state';
import { TwitchApiError } from '@/services/twitch/twitch-client';

const requireAdmin = auth.requireAdmin as jest.Mock;
const CLIENT_SECRET = 'twitch-client-secret';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TWITCH_CLIENT_ID = 'twitch-client-id';
  process.env.TWITCH_CLIENT_SECRET = CLIENT_SECRET;
  process.env.TWITCH_EVENTSUB_SECRET = 'eventsub-secret';
  process.env.TWITCH_REDIRECT_URI = 'https://tamilagaval.com/api/twitch/callback';
  process.env.TWITCH_EVENTSUB_CALLBACK_URL = 'https://tamilagaval.com/api/twitch/eventsub';
  requireAdmin.mockResolvedValue({ isAuthenticated: true, email: 'admin@example.com' });
  (completeConnection as jest.Mock).mockResolvedValue({ twitchLogin: 'tamilagaval' });
});

const connectReq = () =>
  new NextRequest('https://tamilagaval.com/api/admin/twitch/connect');

const callbackReq = (params: Record<string, string>) => {
  const url = new URL('https://tamilagaval.com/api/twitch/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
};

/** The ?status= the callback redirects back to /admin/twitch with. */
const redirectStatus = (res: Response) =>
  new URL(res.headers.get('location')!).searchParams.get('status');

describe('GET /api/admin/twitch/connect', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new auth.AuthError('Forbidden', 403));
    const res = await connectRoute(connectReq());
    expect(res.status).toBe(403);
  });

  it('returns an authorize URL carrying a verifiable state', async () => {
    const res = await connectRoute(connectReq());
    const { url } = await res.json();
    const authorize = new URL(url);

    expect(authorize.origin + authorize.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('twitch-client-id');
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://tamilagaval.com/api/twitch/callback'
    );
    expect(authorize.searchParams.get('state')).toBeTruthy();
  });

  it('requests NO scopes in Phase 1', async () => {
    const res = await connectRoute(connectReq());
    const { url } = await res.json();
    expect(new URL(url).searchParams.get('scope')).toBe('');
  });

  it('never leaks the client secret into the authorize URL', async () => {
    const res = await connectRoute(connectReq());
    const { url } = await res.json();
    expect(url).not.toContain(CLIENT_SECRET);
  });

  it('reports 503 with the missing keys when Twitch is not configured', async () => {
    delete process.env.TWITCH_CLIENT_ID;
    const res = await connectRoute(connectReq());
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toContain('TWITCH_CLIENT_ID');
  });
});

describe('GET /api/twitch/callback', () => {
  const validState = () => createOAuthState('tamilagaval', CLIENT_SECRET);

  it('completes the connection for a valid state + code', async () => {
    const res = await callbackRoute(callbackReq({ state: validState(), code: 'auth-code' }));
    expect(redirectStatus(res)).toBe('connected');
    expect(completeConnection).toHaveBeenCalledWith(
      expect.anything(),
      'tamilagaval',
      'auth-code'
    );
  });

  it('rejects a forged state and never exchanges the code', async () => {
    const forged = createOAuthState('tamilagaval', 'not-the-real-secret');
    const res = await callbackRoute(callbackReq({ state: forged, code: 'auth-code' }));
    expect(redirectStatus(res)).toBe('invalid_state');
    expect(completeConnection).not.toHaveBeenCalled();
  });

  it('rejects a missing state', async () => {
    const res = await callbackRoute(callbackReq({ code: 'auth-code' }));
    expect(redirectStatus(res)).toBe('invalid_state');
    expect(completeConnection).not.toHaveBeenCalled();
  });

  it('handles the user declining at Twitch', async () => {
    const res = await callbackRoute(
      callbackReq({ error: 'access_denied', error_description: 'The user denied you access' })
    );
    expect(redirectStatus(res)).toBe('denied');
    expect(completeConnection).not.toHaveBeenCalled();
  });

  it('handles a valid state that arrives without a code', async () => {
    const res = await callbackRoute(callbackReq({ state: validState() }));
    expect(redirectStatus(res)).toBe('missing_code');
  });

  it('reports a rejected authorization distinctly from a generic failure', async () => {
    (completeConnection as jest.Mock).mockRejectedValue(
      new TwitchApiError('Twitch rejected the authorization code', 400, true)
    );
    const res = await callbackRoute(callbackReq({ state: validState(), code: 'stale-code' }));
    expect(redirectStatus(res)).toBe('rejected');
  });

  it('degrades to an error status when Twitch is down', async () => {
    (completeConnection as jest.Mock).mockRejectedValue(new Error('network'));
    const res = await callbackRoute(callbackReq({ state: validState(), code: 'auth-code' }));
    expect(redirectStatus(res)).toBe('error');
  });

  it('does NOT require an admin session — the signed state is the gate', async () => {
    // Twitch redirects the browser here from another origin, so no Authorization
    // header is guaranteed. Gating on it would break connecting after consent.
    requireAdmin.mockRejectedValue(new auth.AuthError('Unauthorized', 401));
    const res = await callbackRoute(callbackReq({ state: validState(), code: 'auth-code' }));
    expect(redirectStatus(res)).toBe('connected');
  });
});
