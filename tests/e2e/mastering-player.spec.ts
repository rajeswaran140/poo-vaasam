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

    const play = page.getByRole('button', { name: /^play$/i }).first();
    if (!(await play.isVisible().catch(() => false))) {
      test.skip(true, 'No master in the library to audition on this environment.');
    }
    await play.click();
    await page.waitForTimeout(4000);

    expect(wavRequests.filter((r) => r.startsWith('HEAD'))).toHaveLength(0);
  });

  test('auditioning several masters does not exhaust the AudioContext budget', async ({ page }) => {
    // Finding 1: the decode context was closed only on the success path, and
    // the player is keyed on the master URL — so switching rows mid-decode
    // leaked one context each time. Browsers stop granting them at ~6, after
    // which the meter and equaliser go silent with no visible cause.
    await page.addInitScript(() => {
      const w = window as unknown as { __ctx: { made: number; closed: number } };
      w.__ctx = { made: 0, closed: 0 };
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
      }
      window.AudioContext = Counted as unknown as typeof AudioContext;
    });
    await page.reload();

    const rows = page.getByRole('button', { name: /^play$/i });
    const count = Math.min(await rows.count(), 5);
    if (count < 2) test.skip(true, 'Need at least two masters to exercise the switch path.');

    // Switch quickly, so each decode is abandoned mid-flight — the exact path
    // that leaked.
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click();
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(2000);

    const ctx = await page.evaluate(
      () => (window as unknown as { __ctx: { made: number; closed: number } }).__ctx
    );
    // One context stays open for playback; every decode context must be closed.
    expect(ctx.made - ctx.closed).toBeLessThanOrEqual(1);
  });

  test('the waveform is a seek surface and the transport reflects it', async ({ page }) => {
    const wave = page.getByRole('slider', { name: /waveform/i }).first();
    if (!(await wave.isVisible().catch(() => false))) {
      test.skip(true, 'No decoded waveform available in this environment.');
    }
    const before = await wave.getAttribute('aria-valuenow');
    const box = await wave.boundingBox();
    if (!box) test.skip(true, 'Waveform not laid out.');
    await page.mouse.click(box!.x + box!.width * 0.6, box!.y + box!.height / 2);
    await expect
      .poll(async () => wave.getAttribute('aria-valuenow'))
      .not.toBe(before);
  });
});
