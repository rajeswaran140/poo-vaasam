/** @jest-environment node */
import { NextRequest } from 'next/server';
import {
  RateLimiter,
  clientIp,
  rateLimitedResponse,
  checkRateLimit,
} from '@/lib/rate-limit';

describe('RateLimiter', () => {
  it('allows up to max requests then blocks within the window', () => {
    const t = 1_000_000;
    const rl = new RateLimiter({ windowMs: 60_000, max: 3, now: () => t });

    expect(rl.check('ip').allowed).toBe(true);
    expect(rl.check('ip').allowed).toBe(true);
    const third = rl.check('ip');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = rl.check('ip');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.limit).toBe(3);
  });

  it('tracks each key (IP) independently', () => {
    const t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 1, now: () => t });

    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    // A different key is unaffected.
    expect(rl.check('b').allowed).toBe(true);
  });

  it('frees up once the window has elapsed', () => {
    let t = 0;
    const rl = new RateLimiter({ windowMs: 1000, max: 1, now: () => t });

    expect(rl.check('ip').allowed).toBe(true);
    expect(rl.check('ip').allowed).toBe(false);

    t += 1001; // window passed
    expect(rl.check('ip').allowed).toBe(true);
  });

  it('reports a resetAt in the future when blocked', () => {
    const t = 5_000;
    const rl = new RateLimiter({ windowMs: 2000, max: 1, now: () => t });
    rl.check('ip');
    const blocked = rl.check('ip');
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBe(5_000 + 2000);
  });
});

/**
 * `clientIp` is the key the limiter buckets on, so any header value an attacker
 * can control is a rate-limit bypass — and the same helper guards the AI/TTS
 * spend endpoints, not just the analytics beacon.
 *
 * CloudFront (which fronts Amplify) does NOT replace a client-supplied
 * `X-Forwarded-For` — it APPENDS the real viewer IP to whatever the client
 * sent. So at our origin the header reads:
 *
 *     X-Forwarded-For: <anything the client made up>, <real viewer IP>
 *
 * The leftmost entry is therefore attacker-controlled and the RIGHTMOST entry
 * (appended by the trusted proxy nearest us) is the trustworthy one. Taking the
 * leftmost hands every request a fresh bucket.
 */
describe('clientIp', () => {
  const make = (headers: Record<string, string>) =>
    new NextRequest('http://localhost/api/x', { headers });

  it('takes the RIGHTMOST x-forwarded-for entry (the hop appended by our proxy)', () => {
    expect(clientIp(make({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores a client-spoofed prefix and returns the real viewer IP', () => {
    // Attacker sends "X-Forwarded-For: 1.1.1.1"; CloudFront appends 203.0.113.7.
    expect(clientIp(make({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('cannot be fooled by a spoofed prefix that looks like a proxy chain', () => {
    expect(
      clientIp(make({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 198.51.100.99' }))
    ).toBe('198.51.100.99');
  });

  it('tolerates whitespace and empty entries', () => {
    expect(clientIp(make({ 'x-forwarded-for': '1.1.1.1 ,  , 203.0.113.7 ' }))).toBe('203.0.113.7');
  });

  it('handles IPv6 viewer addresses', () => {
    expect(clientIp(make({ 'x-forwarded-for': 'evil, 2001:db8::8a2e:370:7334' }))).toBe(
      '2001:db8::8a2e:370:7334'
    );
  });

  it('does NOT trust x-real-ip (nothing in our infra sets it; it is client-spoofable)', () => {
    expect(clientIp(make({ 'x-real-ip': '198.51.100.2' }))).toBe('unknown');
  });

  it('does not let x-real-ip override a real x-forwarded-for hop', () => {
    expect(
      clientIp(make({ 'x-forwarded-for': 'evil, 203.0.113.7', 'x-real-ip': '1.1.1.1' }))
    ).toBe('203.0.113.7');
  });

  it('falls back to "unknown" when no forwarded-for header is present', () => {
    expect(clientIp(make({}))).toBe('unknown');
  });

  it('falls back to "unknown" for a blank/comma-only header', () => {
    expect(clientIp(make({ 'x-forwarded-for': '  ' }))).toBe('unknown');
    expect(clientIp(make({ 'x-forwarded-for': ' , , ' }))).toBe('unknown');
  });
});

describe('clientIp — bypass regression (the actual vulnerability)', () => {
  it('gives a spoofing attacker the SAME bucket every request, so the limit holds', async () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 2 });
    // Same real viewer (203.0.113.7), rotating the spoofed left-hand entry each
    // request — the classic bypass. All three must land in one bucket.
    const spoof = (fake: string) =>
      new NextRequest('http://localhost/api/events', {
        headers: { 'x-forwarded-for': `${fake}, 203.0.113.7` },
      });

    expect((await checkRateLimit(rl, spoof('1.1.1.1'))).allowed).toBe(true);
    expect((await checkRateLimit(rl, spoof('2.2.2.2'))).allowed).toBe(true);
    expect((await checkRateLimit(rl, spoof('3.3.3.3'))).allowed).toBe(false);
    expect((await checkRateLimit(rl, spoof('4.4.4.4'))).allowed).toBe(false);
  });

  it('still separates two genuinely different viewers', async () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 1 });
    const viewer = (ip: string) =>
      new NextRequest('http://localhost/api/events', {
        headers: { 'x-forwarded-for': `cf-edge, ${ip}` },
      });

    expect((await checkRateLimit(rl, viewer('203.0.113.7'))).allowed).toBe(true);
    expect((await checkRateLimit(rl, viewer('203.0.113.7'))).allowed).toBe(false);
    expect((await checkRateLimit(rl, viewer('198.51.100.4'))).allowed).toBe(true);
  });
});

describe('rateLimitedResponse', () => {
  it('is a 429 with Retry-After and rate-limit headers', async () => {
    const res = rateLimitedResponse({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      limit: 20,
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('checkRateLimit', () => {
  it('keys the limiter on the request IP', async () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 1 });
    const req = new NextRequest('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect((await checkRateLimit(rl, req)).allowed).toBe(true);
    expect((await checkRateLimit(rl, req)).allowed).toBe(false);
  });

  it('buckets all header-less callers together rather than throwing', async () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 1 });
    const bare = () => new NextRequest('http://localhost/api/x');
    expect((await checkRateLimit(rl, bare())).allowed).toBe(true);
    expect((await checkRateLimit(rl, bare())).allowed).toBe(false);
  });
});
