/** @jest-environment node */
/**
 * ⚠️ Impressions are a CUMULATIVE total over `windowDays`, so a 7-day reading is
 * arithmetically larger than a 2-day one for the same video even if distribution
 * did not change at all. Diffing across window sizes reports a fabricated rise.
 *
 * This matters because it is exactly the intended workflow: Raj plans to log
 * first-48h and first-7d impressions + CTR per release, to separate "YouTube
 * didn't show it" from "YouTube showed it and nobody clicked". Before this fix
 * the very first use would have read "+250% impressions" — pure window artefact.
 */

import { withDeltas, interpret } from '@/lib/impressions-log';

const e = (observedAt: string, impressions: number, ctr: number, windowDays: number) =>
  ({ scope: 'eOtHoW5QZGw', observedAt, impressions, ctr, windowDays } as never);

describe('readings are only compared within the same window', () => {
  it('does NOT diff a 7-day reading against a 2-day one', () => {
    const rows = withDeltas([
      e('2026-08-19T00:00:00Z', 900, 4.0, 2),
      e('2026-08-24T00:00:00Z', 3150, 4.0, 7),
    ]);
    const newest = rows[0];
    expect(newest.entry.windowDays).toBe(7);
    expect(newest.impressionsChangePct).toBeNull();   // NOT +250%
    expect(newest.incomparableWindow).toBe(2);
  });

  it('explains why, naming both windows', () => {
    const rows = withDeltas([
      e('2026-08-19T00:00:00Z', 900, 4.0, 2),
      e('2026-08-24T00:00:00Z', 3150, 4.0, 7),
    ]);
    const msg = interpret(rows[0]);
    expect(msg).toMatch(/previous reading covers 2 days, this one 7/);
    expect(msg).toMatch(/not comparable across windows/i);
  });

  it('DOES compare two readings of the same window, skipping the odd one out', () => {
    const rows = withDeltas([
      e('2026-08-19T00:00:00Z', 1000, 4.0, 7),
      e('2026-08-21T00:00:00Z', 5000, 9.9, 2),   // different window, must be skipped
      e('2026-08-26T00:00:00Z', 1500, 4.5, 7),
    ]);
    const newest = rows[0];
    expect(newest.entry.windowDays).toBe(7);
    expect(newest.impressionsChangePct).toBeCloseTo(50);  // 1000 → 1500
    expect(newest.ctrChangePts).toBeCloseTo(0.5);
    expect(newest.daysSincePrevious).toBe(7);
  });

  it('still reports a plain first reading as such', () => {
    const rows = withDeltas([e('2026-08-19T00:00:00Z', 900, 4.0, 2)]);
    expect(rows[0].impressionsChangePct).toBeNull();
    expect(rows[0].incomparableWindow ?? null).toBeNull();
    expect(interpret(rows[0])).toMatch(/First reading/);
  });

  /** The diagnostic Raj actually wants, once two same-window readings exist. */
  it('reads shown-but-not-clicked vs not-shown correctly', () => {
    const shownNotClicked = withDeltas([
      e('2026-08-19T00:00:00Z', 1000, 5.0, 7),
      e('2026-08-26T00:00:00Z', 3000, 2.0, 7),
    ])[0];
    expect(interpret(shownNotClicked)).toMatch(/broader, less well-matched/);

    const notShown = withDeltas([
      e('2026-08-19T00:00:00Z', 3000, 5.0, 7),
      e('2026-08-26T00:00:00Z', 1000, 6.5, 7),
    ])[0];
    expect(interpret(notShown)).toMatch(/narrower but better-matched/);
  });
});
