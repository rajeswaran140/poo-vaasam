/** @jest-environment node */
/**
 * Unit tests for src/lib/job-timeout.ts — the pure "is this processing job past
 * the worker budget?" check used by the compose/critique poll routes.
 */
import { isStalledJob, JOB_STALL_MS, JOB_TIMEOUT_ERROR } from '@/lib/job-timeout';

const NOW = Date.parse('2026-07-01T12:00:00.000Z');

describe('isStalledJob', () => {
  it('is false for a fresh processing job (within the budget)', () => {
    const createdAt = new Date(NOW - 10_000).toISOString(); // 10s ago
    expect(isStalledJob({ status: 'processing', createdAt }, NOW)).toBe(false);
  });

  it('is true for a processing job older than the worker budget', () => {
    const createdAt = new Date(NOW - JOB_STALL_MS - 1000).toISOString();
    expect(isStalledJob({ status: 'processing', createdAt }, NOW)).toBe(true);
  });

  it('is false for terminal jobs regardless of age', () => {
    const old = new Date(NOW - JOB_STALL_MS - 60_000).toISOString();
    expect(isStalledJob({ status: 'done', createdAt: old }, NOW)).toBe(false);
    expect(isStalledJob({ status: 'error', createdAt: old }, NOW)).toBe(false);
  });

  it('is false when createdAt is missing or unparseable (never a false timeout)', () => {
    expect(isStalledJob({ status: 'processing' }, NOW)).toBe(false);
    expect(isStalledJob({ status: 'processing', createdAt: 'not-a-date' }, NOW)).toBe(false);
    expect(isStalledJob({ status: 'processing', createdAt: null }, NOW)).toBe(false);
  });

  it('exposes an upstream-coded synthetic error', () => {
    expect(JOB_TIMEOUT_ERROR.code).toBe('upstream');
    expect(JOB_TIMEOUT_ERROR.message).toMatch(/timed out/i);
  });
});
