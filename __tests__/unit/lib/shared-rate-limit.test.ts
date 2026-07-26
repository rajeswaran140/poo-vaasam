/** @jest-environment node */
/**
 * SharedRateLimiter — the DynamoDB tier that makes rate limiting hold ACROSS
 * Lambda instances. The in-memory limiter it wraps is covered in
 * rate-limit.test.ts; everything here is about the shared behaviour and,
 * critically, the degradation path.
 *
 * DynamoDBOperations is mocked with a fake table so "two instances" is modelled
 * honestly: two separate limiter objects (no shared memory) reading and writing
 * one counter store, which is exactly the production topology.
 */

jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const update = jest.fn();
  return { DynamoDBOperations: { update }, __update: update };
});

import { SharedRateLimiter, __resetSharedWarningsForTests } from '@/lib/rate-limit';

const dbMock = jest.requireMock('@/infrastructure/database/dynamodb-client') as Record<string, jest.Mock>;
const update = dbMock.__update;

/** Minimal stand-in for the single table: atomic ADD on count, keyed by PK+SK. */
function fakeTable() {
  const rows = new Map<string, { count: number; ttl: number }>();
  return {
    rows,
    impl: async ({ key, expressionAttributeValues }: {
      key: { PK: string; SK: string };
      expressionAttributeValues: Record<string, number>;
    }) => {
      const id = `${key.PK}|${key.SK}`;
      const existing = rows.get(id);
      const next = {
        count: (existing?.count ?? 0) + expressionAttributeValues[':one'],
        ttl: existing?.ttl ?? expressionAttributeValues[':exp'],
      };
      rows.set(id, next);
      return next;
    },
  };
}

beforeEach(() => {
  update.mockReset();
  __resetSharedWarningsForTests();
  // Restore console spies too — otherwise a spy created in one test keeps
  // accumulating calls from the next, and the warn-once assertion is meaningless.
  jest.restoreAllMocks();
});

describe('cross-instance enforcement', () => {
  it('holds the cap across two instances that share no memory', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);

    // Two cold Lambdas, same viewer IP, max 3 between them.
    const a = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 3 });
    const b = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 3 });

    expect((await a.check('1.2.3.4')).allowed).toBe(true);
    expect((await b.check('1.2.3.4')).allowed).toBe(true);
    expect((await a.check('1.2.3.4')).allowed).toBe(true);
    // 4th overall — the old per-instance limiter would have allowed this,
    // because neither instance had seen 3 on its own.
    expect((await b.check('1.2.3.4')).allowed).toBe(false);
  });

  it('keeps separate buckets from sharing a budget', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);
    const ai = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 1 });
    const tts = new SharedRateLimiter({ bucket: 'tts', windowMs: 60_000, max: 1 });

    expect((await ai.check('1.2.3.4')).allowed).toBe(true);
    expect((await ai.check('1.2.3.4')).allowed).toBe(false);
    // Same IP, different endpoint — must still have its own allowance.
    expect((await tts.check('1.2.3.4')).allowed).toBe(true);
  });

  it('keeps separate IPs from sharing a budget', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 1 });

    expect((await rl.check('1.1.1.1')).allowed).toBe(true);
    expect((await rl.check('1.1.1.1')).allowed).toBe(false);
    expect((await rl.check('2.2.2.2')).allowed).toBe(true);
  });

  it('reports remaining and resetAt from the shared count, not the local one', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);
    const t = 1_000_000_000;
    const a = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 5, now: () => t });
    const b = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 5, now: () => t });

    await a.check('ip');
    await b.check('ip');
    const third = await a.check('ip');
    // 3 consumed globally, even though instance `a` has only seen 2.
    expect(third.remaining).toBe(2);
    expect(third.limit).toBe(5);
    expect(third.resetAt).toBe(t - (t % 60_000) + 60_000);
  });
});

describe('window handling', () => {
  it('starts a fresh counter row in the next fixed window', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);
    let t = 1_000_000_000;
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 1, now: () => t });

    expect((await rl.check('ip')).allowed).toBe(true);
    expect((await rl.check('ip')).allowed).toBe(false);

    t += 60_000; // next window
    rl.reset(); // local tier would also have aged out
    expect((await rl.check('ip')).allowed).toBe(true);
    expect(table.rows.size).toBe(2); // one row per window
  });

  it('writes a TTL past the window so rows self-clean', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);
    const t = 1_000_000_000;
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 5, now: () => t });
    await rl.check('ip');

    const args = update.mock.calls[0][0];
    const windowStart = t - (t % 60_000);
    expect(args.key.PK).toBe('RATELIMIT#ai#ip');
    expect(args.key.SK).toBe(String(windowStart));
    expect(args.expressionAttributeNames['#ttl']).toBe('ttl');
    // epoch SECONDS, strictly after the window closes
    expect(args.expressionAttributeValues[':exp']).toBeGreaterThan((windowStart + 60_000) / 1000);
    expect(args.updateExpression).toContain('ADD #count :one');
  });
});

// The most important behaviour: a DynamoDB problem must not take the site down,
// and must not silently hand out unlimited AI spend either.
describe('degradation when the shared store is unavailable', () => {
  it('falls back to per-instance limiting instead of failing open', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    update.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 2 });

    expect((await rl.check('ip')).allowed).toBe(true);
    expect((await rl.check('ip')).allowed).toBe(true);
    // Local tier still enforces — NOT unlimited.
    expect((await rl.check('ip')).allowed).toBe(false);
  });

  it('does not fail closed — a healthy caller is still served', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    update.mockRejectedValue(new Error('network down'));
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 10 });
    expect((await rl.check('ip')).allowed).toBe(true);
  });

  it('logs the degradation once per bucket, not once per request', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    update.mockRejectedValue(new Error('boom'));
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 10 });

    await rl.check('ip');
    await rl.check('ip');
    await rl.check('ip');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('falling back to per-instance');
  });

  it('skips the DynamoDB round trip entirely once the local tier already denies', async () => {
    const table = fakeTable();
    update.mockImplementation(table.impl);
    const rl = new SharedRateLimiter({ bucket: 'ai', windowMs: 60_000, max: 1 });

    await rl.check('ip'); // 1 shared write
    await rl.check('ip'); // local already at cap → no second write
    expect(update).toHaveBeenCalledTimes(1);
  });
});
