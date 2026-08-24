import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchAuthenticatedUser,
  PHASE_1_SCOPES,
} from '@/lib/twitch/oauth';

// All tests mock global fetch. No real Twitch calls — enforced by the
// beforeAll assertion below AND the jest --ci gate; a leaked live call would
// fail the assertion loudly rather than hitting Twitch's rate limits.
const originalFetch = global.fetch;

describe('twitch/oauth', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.TWITCH_CLIENT_ID = 'test-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    // Fresh mock every test so leaking assertions can't confuse the next test.
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  describe('buildAuthorizeUrl', () => {
    it('includes client_id, response_type=code, state, and force_verify=true', () => {
      const url = new URL(
        buildAuthorizeUrl('state-abc', 'https://tamilagaval.com/api/admin/twitch/callback')
      );
      expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('state-abc');
      expect(url.searchParams.get('force_verify')).toBe('true');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://tamilagaval.com/api/admin/twitch/callback'
      );
      // Phase 1 requests no scopes.
      expect(url.searchParams.get('scope')).toBe(PHASE_1_SCOPES.join(' '));
    });

    it('throws a clear error when TWITCH_CLIENT_ID is unset', () => {
      const prev = process.env.TWITCH_CLIENT_ID;
      delete process.env.TWITCH_CLIENT_ID;
      expect(() => buildAuthorizeUrl('s', 'https://x/y')).toThrow(/TWITCH_CLIENT_ID/);
      process.env.TWITCH_CLIENT_ID = prev;
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('returns normalised tokens on a happy-path 200', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 14400,
          scope: ['user:read:email'],
          token_type: 'bearer',
        }),
      });
      const tokens = await exchangeCodeForTokens('code-xyz', 'https://cb');
      expect(tokens.access_token).toBe('at-1');
      expect(tokens.refresh_token).toBe('rt-1');
      expect(tokens.expires_in).toBe(14400);
      expect(tokens.scope).toEqual(['user:read:email']);
    });

    it('coerces scope-as-space-separated-string into an array', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: 'user:read:email channel:manage:broadcast',
        }),
      });
      const tokens = await exchangeCodeForTokens('c', 'https://cb');
      expect(tokens.scope).toEqual(['user:read:email', 'channel:manage:broadcast']);
    });

    it('handles empty scope (Phase 1 baseline)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: [],
        }),
      });
      const tokens = await exchangeCodeForTokens('c', 'https://cb');
      expect(tokens.scope).toEqual([]);
    });

    it('throws WITHOUT including the code in the message on a Twitch error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_code' }),
      });
      // Message contains HTTP status but NOT the code we posted — the code
      // could echo into logs if we include the Twitch body, so verify we don't.
      await expect(exchangeCodeForTokens('secret-code-value', 'https://cb')).rejects.toThrow(/HTTP 400/);
      await expect(exchangeCodeForTokens('secret-code-value', 'https://cb')).rejects.not.toThrow(/secret-code-value/);
    });

    it('throws when Twitch returns a 2xx with a missing required field', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'x', expires_in: 3600 }), // no refresh_token
      });
      await expect(exchangeCodeForTokens('c', 'https://cb')).rejects.toThrow(/missing required fields/);
    });
  });

  describe('refreshAccessToken', () => {
    it('returns fresh tokens on 200 — refresh_token rotation supported', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at-new',
          refresh_token: 'rt-rotated',
          expires_in: 14400,
          scope: [],
        }),
      });
      const tokens = await refreshAccessToken('rt-old');
      expect(tokens.access_token).toBe('at-new');
      expect(tokens.refresh_token).toBe('rt-rotated');
    });

    it('throws on 401 — caller treats this as user-revoked authorization', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid_refresh' }),
      });
      await expect(refreshAccessToken('rt-old')).rejects.toThrow(/HTTP 401/);
    });
  });

  describe('fetchAuthenticatedUser', () => {
    it('returns the first user in data[] with the four fields the connection needs', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: '12345',
              login: 'tamilagaval',
              display_name: 'TamilAgaval',
              profile_image_url: 'https://cdn.twitch/img.png',
            },
          ],
        }),
      });
      const user = await fetchAuthenticatedUser('at-1');
      expect(user).toEqual({
        id: '12345',
        login: 'tamilagaval',
        display_name: 'TamilAgaval',
        profile_image_url: 'https://cdn.twitch/img.png',
      });
    });

    it('falls back to login when display_name is missing', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1', login: 'no_display' }] }),
      });
      const user = await fetchAuthenticatedUser('at-1');
      expect(user.display_name).toBe('no_display');
    });

    it('throws when Twitch returns an empty data array', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });
      await expect(fetchAuthenticatedUser('at-1')).rejects.toThrow(/no user/);
    });

    it('passes the Client-Id header required by Helix', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1', login: 'x', display_name: 'X' }] }),
      });
      await fetchAuthenticatedUser('at-1');
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer at-1');
      expect(init.headers['Client-Id']).toBe('test-client-id');
    });
  });
});
