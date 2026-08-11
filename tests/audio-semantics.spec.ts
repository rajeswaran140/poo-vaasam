/**
 * Real-browser checks of the media/Web-Audio behaviour the mastering player
 * RELIES ON but cannot verify in jsdom.
 *
 * These need no application, no auth and no fixtures — they interrogate the
 * browser itself on a blank page. They exist because three fixes in the
 * 2026-08-11 audit of the audition player rest on assumptions about how a
 * media element and an AudioContext behave, and jsdom stubs all of it away.
 * If a future browser changes one of these, the player's comments become
 * quietly wrong and these fail loudly instead.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
});

test('setting currentTime immediately after src survives the load', async ({ page }) => {
  // The A/B toggle assigns `src` then `currentTime` synchronously, so the
  // comparison is of the SAME moment. That looks like it should be lost to the
  // load algorithm; per spec, assigning currentTime while readyState is
  // HAVE_NOTHING sets the DEFAULT PLAYBACK START POSITION, which the element
  // then seeks to. The audit relied on this being true rather than a bug.
  const result = await page.evaluate(async () => {
    const a = document.createElement('audio');
    document.body.appendChild(a);
    // A silent 5-second WAV, generated inline so there is no fixture to ship.
    const seconds = 5, rate = 8000;
    const n = seconds * rate;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    ascii(0, 'RIFF'); v.setUint32(4, 36 + n, true); ascii(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    ascii(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));

    a.src = url;
    a.currentTime = 2.5;                    // set BEFORE any metadata exists
    const readyStateAtSet = a.readyState;   // expect 0 = HAVE_NOTHING
    await new Promise<void>((res, rej) => {
      a.onloadedmetadata = () => res();
      a.onerror = () => rej(new Error('load failed'));
      setTimeout(() => rej(new Error('timeout')), 5000);
    });
    return { readyStateAtSet, currentTime: a.currentTime, duration: a.duration };
  });

  expect(result.readyStateAtSet).toBe(0);
  expect(result.duration).toBeGreaterThan(4);
  // The position survived the load — the A/B toggle compares the same moment.
  expect(result.currentTime).toBeGreaterThan(2);
});

test('preservesPitch exists, so a slowed vocal is not transposed', async ({ page }) => {
  // The 0.5x/0.75x presets are for judging sung Tamil consonants and vowel
  // length. If the browser transposes instead, the player must SAY so — this
  // asserts the capability the warning is gated on is really detectable.
  const supported = await page.evaluate(() => {
    const a = document.createElement('audio');
    return 'preservesPitch' in a || 'mozPreservesPitch' in a;
  });
  expect(supported).toBe(true);
});

test('an AudioContext is really released by close(), freeing the budget', async ({ page }) => {
  // The whole point of finding 1: contexts are a finite resource, and a leaked
  // decode context is not reclaimed by garbage collection alone.
  const states = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const before = ctx.state;
    await ctx.close();
    return { before, after: ctx.state };
  });
  expect(states.before).not.toBe('closed');
  expect(states.after).toBe('closed');
});

test('createMediaElementSource may only be called once per element', async ({ page }) => {
  // The player builds ONE graph and hangs the EQ and meter off it precisely
  // because a second call throws. If this ever stopped throwing, the comment
  // explaining the architecture would be stale.
  const threw = await page.evaluate(() => {
    const ctx = new AudioContext();
    const a = document.createElement('audio');
    ctx.createMediaElementSource(a);
    try {
      ctx.createMediaElementSource(a);
      return false;
    } catch {
      return true;
    } finally {
      void ctx.close();
    }
  });
  expect(threw).toBe(true);
});
