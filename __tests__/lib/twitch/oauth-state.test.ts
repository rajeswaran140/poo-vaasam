import {
  mintOAuthState,
  verifyOAuthState,
  oauthStateCookieOptions,
  oauthStateClearCookieOptions,
} from '@/lib/twitch/oauth-state';

// Every test uses the same secret so signatures compute reproducibly.
// The module falls back to a DEV default when the env var is unset — which is
// the intended dev-safe behavior; here we set it explicitly so a test never
// depends on that fallback drifting.
const TEST_SECRET = 'twitch-state-test-secret-do-not-use-in-prod';

describe('twitch/oauth-state', () => {
  const originalSecret = process.env.TWITCH_STATE_SECRET;
  beforeEach(() => {
    process.env.TWITCH_STATE_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.TWITCH_STATE_SECRET;
    else process.env.TWITCH_STATE_SECRET = originalSecret;
  });

  describe('sign / verify roundtrip', () => {
    it('mint → verify returns the same payload shape', () => {
      const { token, payload } = mintOAuthState();
      const verified = verifyOAuthState(token);
      expect(verified).not.toBeNull();
      expect(verified?.nonce).toBe(payload.nonce);
      expect(verified?.at).toBe(payload.at);
      expect(verified?.v).toBe(1);
    });

    it('carries an optional returnTo through the roundtrip', () => {
      const { token } = mintOAuthState('/admin/twitch?from=onboarding');
      expect(verifyOAuthState(token)?.returnTo).toBe('/admin/twitch?from=onboarding');
    });

    it('two mints produce different nonces', () => {
      const a = mintOAuthState().payload.nonce;
      const b = mintOAuthState().payload.nonce;
      expect(a).not.toBe(b);
    });
  });

  describe('tamper detection', () => {
    it('rejects a token whose body has been altered', () => {
      const { token } = mintOAuthState();
      const [body, sig] = token.split('.');
      // Flip one byte in the body — even a tiny change breaks the HMAC.
      const tamperedBody = body.slice(0, -1) + (body.at(-1) === 'A' ? 'B' : 'A');
      expect(verifyOAuthState(`${tamperedBody}.${sig}`)).toBeNull();
    });

    it('rejects a token whose signature has been altered', () => {
      const { token } = mintOAuthState();
      const [body, sig] = token.split('.');
      // Tamper with the FIRST character, not the last.
      //
      // An HMAC-SHA256 signature is 32 bytes, which base64url-encodes to 43
      // characters: ten full 3-byte groups plus two leftover bytes. Those two
      // bytes occupy 16 bits spread over 3 characters (18 bits), so the final
      // character's low 2 bits are unused padding — 'A', 'B', 'C' and 'D' all
      // decode to the same trailing byte.
      //
      // verifyOAuthState decodes the signature and compares BYTES with
      // timingSafeEqual, which is the correct thing to do. So flipping the last
      // character produced a different string that decoded to an identical
      // signature, and the token still verified. That failed roughly one run in
      // sixteen — it passed locally and in CI on the Twitch PRs by luck, then
      // failed on an unrelated docs PR.
      //
      // The first character's six bits all land inside byte 0, so changing it
      // always changes the decoded signature. Deterministic.
      const tamperedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
      expect(verifyOAuthState(`${body}.${tamperedSig}`)).toBeNull();
    });

    it('rejects a token signed with a DIFFERENT secret', () => {
      const { token } = mintOAuthState();
      process.env.TWITCH_STATE_SECRET = 'different-secret';
      expect(verifyOAuthState(token)).toBeNull();
    });
  });

  describe('malformed input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['no dot', 'abcdef'],
      ['too many dots', 'a.b.c'],
      ['empty body', '.abc'],
      ['empty sig', 'abc.'],
    ])('rejects %s', (_label, input) => {
      expect(verifyOAuthState(input as never)).toBeNull();
    });
  });

  describe('expiry', () => {
    it('rejects a token older than the 10-minute state cookie lifetime', () => {
      // Mint a token AT one fixed instant, then advance the clock 20 min and
      // try to verify. Both timestamps must be under fake timers so mint's
      // internal `new Date().toISOString()` uses the earlier value; setting
      // system time BACK to `new Date()` after `useFakeTimers` would just
      // read the fake clock, not the real one — hence the two absolute times.
      jest.useFakeTimers();
      const t0 = new Date('2026-08-24T00:00:00.000Z');
      const t1 = new Date('2026-08-24T00:20:00.000Z');
      jest.setSystemTime(t0);
      const { token } = mintOAuthState();
      jest.setSystemTime(t1);
      expect(verifyOAuthState(token)).toBeNull();
      jest.useRealTimers();
    });

    it('accepts a token minted seconds ago', () => {
      const { token } = mintOAuthState();
      expect(verifyOAuthState(token)).not.toBeNull();
    });
  });

  describe('cookie options', () => {
    it('sets httpOnly + secure + SameSite=Lax for CSRF safety on the return redirect', () => {
      const o = oauthStateCookieOptions();
      expect(o.httpOnly).toBe(true);
      expect(o.secure).toBe(true);
      expect(o.sameSite).toBe('lax');
      expect(o.path).toBe('/');
      expect(o.maxAge).toBeGreaterThan(0);
    });

    it('clear-cookie sets maxAge=0 while keeping the other attributes', () => {
      const clear = oauthStateClearCookieOptions();
      expect(clear.maxAge).toBe(0);
      expect(clear.httpOnly).toBe(true);
      expect(clear.secure).toBe(true);
      expect(clear.sameSite).toBe('lax');
    });
  });
});
