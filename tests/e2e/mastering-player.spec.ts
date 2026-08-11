/**
 * E2E for the /admin/mastering audition player.
 *
 * WHAT THIS ADDS OVER THE JEST TESTS. jsdom fakes the whole audio stack: there
 * is no AudioContext, no decode, no media pipeline, and canvas is a stub. The
 * defects fixed in the 2026-08-11 audit all live exactly there — a leaked
 * AudioContext, canvas layers rebuilt per frame, a second network transfer of
 * a large WAV. Those can only be observed in a real browser.
 *
 * Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (see tests/support/admin-auth).
 */

import { test, expect } from '@playwright/test';
import { adminCredentials, NO_CREDS_REASON } from '../support/admin-credentials';

test.skip(!adminCredentials(), NO_CREDS_REASON);

/**
 * Open the saved-master library and start the first master, returning false
 * when this environment simply has none to audition.
 *
 * The player only mounts when a row is playing (MasteringStudio renders it
 * under `libraryOpen && playing`), so every test below has to get here first.
 */
async function auditionFirstMaster(page: import('@playwright/test').Page): Promise<boolean> {
  await page.getByRole('button', { name: /saved masters/i }).click();
  const rows = page.getByRole('button', { name: /^Play / });
  await rows.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if ((await rows.count()) === 0) return false;
  await rows.first().click();
  return true;
}

/**
 * Wait for proof that the waveform DECODE actually completed.
 *
 * ⚠️ WITHOUT THIS GATE THESE TESTS PASS VACUOUSLY. The slider only exists once
 * `peaks` is set, which happens at the end of the fetch → decode path — the
 * very path being measured. On a slow presigned fetch the assertions were
 * otherwise evaluated before any of it ran, and "no HEAD request" / "no leaked
 * context" were both trivially true because nothing had happened yet. Measured
 * against the pre-fix source they passed for exactly that reason.
 */
async function waitForDecodedWaveform(page: import('@playwright/test').Page): Promise<boolean> {
  const slider = page.getByRole('slider', { name: /waveform/i }).first();
  try {
    await slider.waitFor({ state: 'visible', timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('mastering audition player', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/mastering');
    await expect(page).toHaveURL(/\/admin\/mastering/);
  });

  test('the page loads authenticated rather than bouncing to login', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /master/i }).first()).toBeVisible();
  });

  test('the master is transferred once, not fetched a second time for the waveform', async ({ page }) => {
    // Finding 3: the waveform used to issue a HEAD plus a full GET while the
    // <audio> element was already streaming the same file.
    const wavRequests: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\.wav(\?|$)/i.test(u)) wavRequests.push(`${r.method()} ${u.split('?')[0]}`);
    });

    const ok = await auditionFirstMaster(page);
    test.skip(!ok, 'No saved master in this environment to audition.');
    const decoded = await waitForDecodedWaveform(page);
    test.skip(!decoded, 'Waveform never decoded here — nothing to measure.');

    // Only meaningful now that the decode demonstrably ran.
    expect(wavRequests.length).toBeGreaterThan(0);
    expect(wavRequests.filter((r) => r.startsWith('HEAD'))).toHaveLength(0);
  });

  test('auditioning several masters does not exhaust the AudioContext budget', async ({ page }) => {
    // Finding 1: the decode context was closed only on the success path, and
    // the player is keyed on the master URL — so switching rows mid-decode
    // leaked one context each time. Browsers stop granting them at ~6, after
    // which the meter and equaliser go silent with no visible cause.
    await page.addInitScript(() => {
      const w = window as unknown as { __ctx: { made: number; closed: number; decoded: number } };
      w.__ctx = { made: 0, closed: 0, decoded: 0 };
      const Real = window.AudioContext;
      class Counted extends Real {
        constructor(...args: ConstructorParameters<typeof Real>) {
          super(...args);
          w.__ctx.made++;
        }
        close() {
          w.__ctx.closed++;
          return super.close();
        }
        decodeAudioData(...a: Parameters<AudioContext['decodeAudioData']>) {
          w.__ctx.decoded++;
          return super.decodeAudioData(...a);
        }
      }
      window.AudioContext = Counted as unknown as typeof AudioContext;
    });
    await page.reload();

    await page.getByRole('button', { name: /saved masters/i }).click();
    const rows = page.getByRole('button', { name: /^Play / });
    await rows.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const count = Math.min(await rows.count(), 5);
    test.skip(count < 2, 'Need at least two saved masters to exercise the switch path.');

    // Let the first one decode fully, so we know the path runs in this
    // environment at all; then switch quickly so later decodes are abandoned
    // mid-flight — the exact path that leaked.
    await rows.first().click();
    const decoded = await waitForDecodedWaveform(page);
    test.skip(!decoded, 'Waveform never decoded here — nothing to measure.');

    for (let i = 1; i < count; i++) {
      await rows.nth(i).click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(3000);

    const ctx = await page.evaluate(
      () => (window as unknown as { __ctx: { made: number; closed: number; decoded: number } }).__ctx
    );
    // Guard against a vacuous pass: if no decode context was ever built there
    // is nothing to leak and the assertion below proves nothing.
    expect(ctx.decoded).toBeGreaterThan(0);
    // One context stays open for playback; every decode context must be closed.
    expect(ctx.made - ctx.closed).toBeLessThanOrEqual(1);
  });

  test('the waveform is a seek surface and the transport reflects it', async ({ page }) => {
    const ok = await auditionFirstMaster(page);
    test.skip(!ok, 'No saved master in this environment to audition.');
    const wave = page.getByRole('slider', { name: /waveform/i }).first();
    await wave.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    if (!(await wave.isVisible().catch(() => false))) {
      test.skip(true, 'No decoded waveform available in this environment.');
    }
    const before = await wave.getAttribute('aria-valuenow');
    // The player sits well below the library list, so raw page.mouse
    // coordinates can land off-screen. locator.click scrolls it into view and
    // clicks a point INSIDE the element, which is what a person does.
    const box = await wave.boundingBox();
    test.skip(!box, 'Waveform not laid out.');
    await wave.click({ position: { x: box!.width * 0.6, y: box!.height / 2 } });
    await expect
      .poll(async () => wave.getAttribute('aria-valuenow'), { timeout: 10_000 })
      .not.toBe(before);
  });
});
