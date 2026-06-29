/** @jest-environment node */
/** loudness-targets — status thresholds, per-platform deltas, streaming-norm verdict. */

import { statusFor, compareToTargets, streamingNormVerdict, STREAMING_TARGETS } from '@/lib/loudness-targets';

it('classifies hot / quiet / ok against a tolerance', () => {
  expect(statusFor(0)).toBe('ok');
  expect(statusFor(0.5)).toBe('ok'); // within ±1
  expect(statusFor(2)).toBe('hot');
  expect(statusFor(-2)).toBe('quiet');
});

it('computes a delta per platform (positive = louder than target)', () => {
  const rows = compareToTargets(-11);
  expect(rows).toHaveLength(STREAMING_TARGETS.length);
  const spotify = rows.find((r) => r.platform === 'Spotify')!;
  expect(spotify.deltaLu).toBeCloseTo(3, 5); // −11 vs −14 → +3 LU hot
  expect(spotify.status).toBe('hot');
  const apple = rows.find((r) => r.platform === 'Apple Music')!;
  expect(apple.deltaLu).toBeCloseTo(5, 5); // −11 vs −16 → +5 LU
});

it('summarises against the −14 streaming norm', () => {
  expect(streamingNormVerdict(-14).status).toBe('ok');
  const hot = streamingNormVerdict(-11);
  expect(hot.status).toBe('hot');
  expect(hot.deltaLu).toBeCloseTo(3, 5);
  expect(hot.label).toMatch(/hot/);
  expect(streamingNormVerdict(-18).status).toBe('quiet');
});
