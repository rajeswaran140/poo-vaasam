/** @jest-environment node */
/**
 * OAuth state token — the CSRF defence for the connect flow, and (because the
 * callback is not admin-gated) the only thing authorising a callback at all.
 */

import {
  STATE_TTL_MS,
  createOAuthState,
  verifyOAuthState,
} from '@/lib/twitch/oauth-state';

const SECRET = 'twitch-client-secret-used-for-signing';
const TENANT = 'tamilagaval';

describe('OAuth state token', () => {
  it('round-trips a valid token and preserves the tenant', () => {
    const token = createOAuthState(TENANT, SECRET);
    const payload = verifyOAuthState(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.t).toBe(TENANT);
    expect(payload!.v).toBe(1);
  });

  it('is unique per call, so no two authorize URLs are the same', () => {
    const a = createOAuthState(TENANT, SECRET);
    const b = createOAuthState(TENANT, SECRET);
    expect(a).not.toBe(b);
  });

  it('rejects a token signed with a different secret', () => {
    const token = createOAuthState(TENANT, 'a-different-secret');
    expect(verifyOAuthState(token, SECRET)).toBeNull();
  });

  it('rejects a token whose payload was edited', () => {
    const token = createOAuthState(TENANT, SECRET);
    const [body, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.t = 'someone-elses-tenant';
    const forged = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const issued = Date.parse('2026-08-20T12:00:00Z');
    const token = createOAuthState(TENANT, SECRET, issued);
    expect(verifyOAuthState(token, SECRET, issued + STATE_TTL_MS + 1)).toBeNull();
  });

  it('accepts a token still inside its TTL', () => {
    const issued = Date.parse('2026-08-20T12:00:00Z');
    const token = createOAuthState(TENANT, SECRET, issued);
    expect(verifyOAuthState(token, SECRET, issued + STATE_TTL_MS - 1)).not.toBeNull();
  });

  it('rejects a future-dated token', () => {
    const issued = Date.parse('2026-08-20T12:00:00Z');
    const token = createOAuthState(TENANT, SECRET, issued);
    expect(verifyOAuthState(token, SECRET, issued - STATE_TTL_MS - 1)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['too many parts', 'a.b.c'],
    ['undecodable payload', '!!!!.!!!!'],
  ])('rejects a malformed token (%s) without throwing', (_label, value) => {
    expect(() => verifyOAuthState(value as string | null | undefined, SECRET)).not.toThrow();
    expect(verifyOAuthState(value as string | null | undefined, SECRET)).toBeNull();
  });

  it('rejects when no secret is configured', () => {
    const token = createOAuthState(TENANT, SECRET);
    expect(verifyOAuthState(token, '')).toBeNull();
  });
});
