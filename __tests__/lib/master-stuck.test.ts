/** @jest-environment node */
/**
 * Detecting a mastering job whose worker died silently.
 *
 * The bug this guards: a Lambda timeout or OOM terminates the worker before
 * its catch block runs, so the job claims `processing` forever, the Studio
 * spins with no end state, and 24h later the ttl deletes the evidence.
 */

import { isStuck, STUCK_AFTER_MS, STUCK_ERROR, WORKER_TIMEOUT_MS } from '@/lib/master-stuck';
import type { MasterJob } from '@/types/masterJob';

const START = Date.parse('2026-08-01T10:00:00.000Z');
const job = (over: Partial<MasterJob> = {}) =>
  ({ status: 'processing', createdAt: new Date(START).toISOString(), ...over }) as MasterJob;

describe('a job that cannot still be running', () => {
  it('is stuck once it outlives the worker ceiling plus grace', () => {
    expect(isStuck(job(), START + STUCK_AFTER_MS + 1)).toBe(true);
  });

  it('is NOT stuck while it could still legitimately be working', () => {
    expect(isStuck(job(), START + 1000)).toBe(false);
    expect(isStuck(job(), START + WORKER_TIMEOUT_MS - 1)).toBe(false);
  });

  /**
   * The grace window is the whole safety margin. Declaring a slow-but-healthy
   * master dead is worse than the bug: the operator abandons a job that was
   * about to succeed.
   */
  it('leaves a job alone through the entire grace window', () => {
    expect(isStuck(job(), START + WORKER_TIMEOUT_MS + 1)).toBe(false);
    expect(isStuck(job(), START + STUCK_AFTER_MS)).toBe(false);
    expect(STUCK_AFTER_MS).toBeGreaterThan(WORKER_TIMEOUT_MS);
  });

  it.each([['done'], ['error']] as const)('never re-judges a %s job however old', (status) => {
    expect(isStuck(job({ status }), START + STUCK_AFTER_MS * 100)).toBe(false);
  });

  /**
   * A bad timestamp is not evidence of death. Failing a job on an unparseable
   * stamp would destroy a real result over a formatting problem.
   */
  it.each([['empty', ''], ['nonsense', 'not-a-date'], ['null-ish', null as unknown as string]])(
    'refuses to judge a job with a %s createdAt',
    (_label, createdAt) => {
      expect(isStuck(job({ createdAt }), START + STUCK_AFTER_MS * 10)).toBe(false);
    }
  );

  it('reports a cause the operator can act on', () => {
    expect(STUCK_ERROR.code).toBe('worker-died');
    expect(STUCK_ERROR.message).toMatch(/re-run/i);
  });

  it('keys off createdAt, so a job is judged by its age not its last write', () => {
    // updatedAt on a processing job is still its creation stamp today, but the
    // moment the worker reports progress that would stop meaning "age".
    const old = job({ updatedAt: new Date(START + STUCK_AFTER_MS + 5000).toISOString() });
    expect(isStuck(old, START + STUCK_AFTER_MS + 1)).toBe(true);
  });
});
