/**
 * Hook recommendation — turns a detected hook window into Studio-Trim guidance,
 * productising the "open on the hook in the first 15s" retention lever.
 */

import { buildHookRecommendation, formatClock, FIRST_15S } from '@/lib/hook-recommendation';
import type { HookWindow } from '@/lib/hook-window';

const win = (start: number, end: number): HookWindow => ({ start, end, avgLufs: -12 });

describe('formatClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(72)).toBe('1:12');
    expect(formatClock(125.9)).toBe('2:05');
  });

  it('clamps negatives to 0:00', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('buildHookRecommendation', () => {
  it('says no trim is needed when the hook is already at the start', () => {
    const r = buildHookRecommendation(win(0, 30));
    expect(r.verdict).toBe('hook-at-start');
    expect(r.trimInstruction).toMatch(/no trim needed/i);
    expect(r.hooksWithinFirst15s).toBe(true);
  });

  it('recommends a trim when the hook is within the first 15s', () => {
    const r = buildHookRecommendation(win(10, 40));
    expect(r.verdict).toBe('trim-recommended');
    expect(r.introSec).toBe(10);
    expect(r.hookStartLabel).toBe('0:10');
    expect(r.trimInstruction).toContain('0:00–0:10');
    expect(r.hooksWithinFirst15s).toBe(true);
  });

  it('strongly recommends a trim when the hook is past the first 15s', () => {
    const r = buildHookRecommendation(win(42, 72));
    expect(r.verdict).toBe('trim-strongly-recommended');
    expect(r.hooksWithinFirst15s).toBe(false);
    expect(r.hookStartLabel).toBe('0:42');
    expect(r.windowLabel).toBe('0:42–1:12');
    expect(r.trimInstruction).toMatch(/highest-leverage/i);
  });

  it('exposes the 15s lever constant', () => {
    expect(FIRST_15S).toBe(15);
  });
});
