/** @jest-environment node */
/** loudness-targets — status thresholds, per-platform deltas, streaming-norm verdict. */

import { statusFor, compareToTargets, streamingNormVerdict, STREAMING_TARGETS, platformLanding } from '@/lib/loudness-targets';

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

describe('platformLanding', () => {
  it('groups the four −14 streamers into one row, Apple separate, loudest first', () => {
    const rows = platformLanding(-14);
    expect(rows).toHaveLength(2); // −14 group + −16 (Apple)
    expect(rows[0].target).toBe(-14); // loudest target first
    expect(rows[0].platforms).toEqual(expect.arrayContaining(['Spotify', 'YouTube', 'Amazon Music', 'TIDAL']));
    expect(rows[1].platforms).toEqual(['Apple Music']);
  });

  it('a −14 master plays as-is on −14 and is normalised down on Apple −16', () => {
    const [norm, apple] = platformLanding(-14);
    expect(norm.status).toBe('ok');
    expect(norm.mark).toBe('✓');
    expect(norm.note).toMatch(/plays exactly as mastered/);
    expect(apple.status).toBe('hot'); // −14 is louder than Apple's −16 → playback lowered
    expect(apple.mark).toBe('↓');
    expect(apple.deltaLu).toBeCloseTo(2, 5);
    // Reassuring: normalisation is playback volume, not a re-encode.
    expect(apple.note).toMatch(/playback lowered ~2\.0 LU · no quality loss/);
  });

  it('a −16 master sits below the −14 targets', () => {
    const [norm, apple] = platformLanding(-16);
    expect(norm.status).toBe('quiet');
    expect(norm.mark).toBe('·');
    expect(norm.note).toMatch(/2\.0 LU below target/);
    expect(apple.status).toBe('ok');
    expect(apple.mark).toBe('✓');
  });
});
