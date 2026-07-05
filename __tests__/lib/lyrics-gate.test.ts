/**
 * Tests for the lyrics email-gate token (src/lib/lyrics-gate.ts): sign→verify
 * round-trip, tamper rejection, wrong-secret rejection, and cookie options.
 */

import {
  signGateToken,
  verifyGateToken,
  gateCookieOptions,
  LYRICS_GATE_COOKIE,
} from '@/lib/lyrics-gate';

describe('lyrics-gate token', () => {
  const ORIGINAL = process.env.LYRICS_GATE_SECRET;
  beforeEach(() => {
    process.env.LYRICS_GATE_SECRET = 'unit-test-secret-1';
  });
  afterAll(() => {
    process.env.LYRICS_GATE_SECRET = ORIGINAL;
  });

  it('round-trips a signed payload', () => {
    const at = new Date().toISOString();
    const token = signGateToken({ v: 1, at });
    expect(verifyGateToken(token)).toEqual({ v: 1, at });
  });

  it('returns null for a tampered payload (kept signature)', () => {
    const token = signGateToken({ v: 1, at: new Date().toISOString() });
    const sig = token.split('.')[1];
    const forgedBody = Buffer.from(
      JSON.stringify({ v: 1, at: '2000-01-01T00:00:00.000Z' })
    ).toString('base64url');
    expect(verifyGateToken(`${forgedBody}.${sig}`)).toBeNull();
  });

  it('returns null for a garbage signature', () => {
    const body = signGateToken({ v: 1, at: new Date().toISOString() }).split('.')[0];
    expect(verifyGateToken(`${body}.not-a-real-signature`)).toBeNull();
  });

  it('returns null when verified under a different secret', () => {
    const token = signGateToken({ v: 1, at: new Date().toISOString() });
    process.env.LYRICS_GATE_SECRET = 'a-completely-different-secret';
    expect(verifyGateToken(token)).toBeNull();
  });

  it('returns null on malformed / missing input', () => {
    expect(verifyGateToken('')).toBeNull();
    expect(verifyGateToken(undefined)).toBeNull();
    expect(verifyGateToken(null)).toBeNull();
    expect(verifyGateToken('no-dot')).toBeNull();
    expect(verifyGateToken('a.b.c')).toBeNull();
  });

  it('exposes httpOnly/secure/lax cookie options with a 180-day maxAge', () => {
    expect(gateCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    });
    expect(LYRICS_GATE_COOKIE).toBe('tg_lyrics');
  });
});
