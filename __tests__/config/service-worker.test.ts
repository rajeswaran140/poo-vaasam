/** @jest-environment node */
/**
 * public/sw.js — guarding what the service worker must NEVER start doing.
 *
 * A service worker registered from /admin/mastering controls the WHOLE origin,
 * /admin included. The moment it caches a response it did not author, that copy
 * outlives sign-out on the device and can be replayed to the next person to
 * open the browser. The current worker caches exactly one static file and
 * intercepts only navigations.
 *
 * These are source-level assertions, which is unusual — but the failure they
 * guard against is a plausible future "improvement" (add offline caching for
 * the admin pages!) whose damage is invisible in every functional test. Behaviour
 * is covered by the offline fallback itself; this covers the restraint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sw = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

describe('what the service worker caches', () => {
  it('adds exactly one thing to a cache, and it is the offline page', () => {
    const adds = sw.match(/cache\.add(?:All)?\(/g) ?? [];
    expect(adds).toHaveLength(1);
    expect(sw).toMatch(/cache\.add\(OFFLINE_URL\)/);
    expect(sw).toMatch(/const OFFLINE_URL = '\/offline\.html'/);
  });

  it('never stores a response it did not precache', () => {
    // cache.put is how a runtime-caching worker saves fetched responses; its
    // absence is the whole guarantee.
    expect(sw).not.toMatch(/cache\.put\(/);
    expect(sw).not.toMatch(/caches\.open\([^)]*\)\.then\(\s*\(?\w+\)?\s*=>\s*\w+\.put/);
  });

  it('caches nothing from /admin or /api, by having no such literals at all', () => {
    expect(sw).not.toMatch(/['"`]\/admin/);
    expect(sw).not.toMatch(/['"`]\/api\//);
  });
});

describe('what the service worker intercepts', () => {
  it('returns early for every request that is not a navigation', () => {
    // Without this guard the worker would sit in front of S3 uploads and the
    // mastering API, where a cached or altered response is a correctness bug,
    // not just a privacy one.
    expect(sw).toMatch(/request\.mode !== 'navigate'\)\s*return/);
  });

  it('only reaches the cache after the network has actually failed', () => {
    // fetch first, cache as the fallback — never cache-first, which would serve
    // a stale page to someone who is online.
    const fetchIdx = sw.indexOf('fetch(event.request)');
    const matchIdx = sw.indexOf('caches.match(OFFLINE_URL)');
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(matchIdx).toBeGreaterThan(fetchIdx);
    expect(sw).toMatch(/fetch\(event\.request\)\.catch\(/);
  });

  it('surfaces a real error rather than an empty 200 if the fallback is missing', () => {
    expect(sw).toMatch(/cached \|\| Response\.error\(\)/);
  });
});

describe('the push path still works', () => {
  it('keeps the push and notificationclick handlers', () => {
    expect(sw).toMatch(/addEventListener\('push'/);
    expect(sw).toMatch(/addEventListener\('notificationclick'/);
  });

  it('does not let a precache failure block activation', () => {
    // Push notifications predate the cache and need none of it; an install that
    // threw would leave existing subscribers without a worker at all.
    expect(sw).toMatch(/\.catch\(\(\) => undefined\)/);
  });
});
