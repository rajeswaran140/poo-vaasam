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
    let t = 1_000_000;
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
    let t = 0;
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
    let t = 5_000;
    const rl = new RateLimiter({ windowMs: 2000, max: 1, now: () => t });
    rl.check('ip');
    const blocked = rl.check('ip');
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBe(5_000 + 2000);
  });
});

describe('clientIp', () => {
  const make = (headers: Record<string, string>) =>
    new NextRequest('http://localhost/api/x', { headers });

  it('uses the first entry of x-forwarded-for', () => {
    expect(clientIp(make({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(make({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('falls back to "unknown" when no IP headers are present', () => {
    expect(clientIp(make({}))).toBe('unknown');
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
  it('keys the limiter on the request IP', () => {
    const rl = new RateLimiter({ windowMs: 60_000, max: 1 });
    const req = new NextRequest('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(checkRateLimit(rl, req).allowed).toBe(true);
    expect(checkRateLimit(rl, req).allowed).toBe(false);
  });
});
