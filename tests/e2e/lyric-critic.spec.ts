/**
 * E2E — Lyric Critic writing surface.
 *
 * WHAT THIS CAN AND CANNOT COVER. /admin/compose/critique sits behind Cognito,
 * and there is no service-account path into an admin session, so the authored
 * flow (type → autosave → reload → restore) cannot run unattended here. Faking
 * it would mean stubbing the very auth the page depends on, which tests nothing
 * real. The jsdom suites cover the component contract; this covers what only a
 * browser can: that the route exists, is genuinely protected, and that the
 * client bundle carrying react-transliterate loads without a runtime error.
 *
 * The authenticated block is written and skipped rather than omitted — when an
 * admin storageState is available, remove the skip and it runs as-is.
 */

import { test, expect } from '@playwright/test';

const CRITIQUE = '/admin/compose/critique';

test.describe('Lyric Critic — route protection', () => {
  test('the page exists and redirects an anonymous visitor to login', async ({ page }) => {
    const res = await page.goto(CRITIQUE);
    // A 404 would mean the route did not ship; a redirect means it shipped and
    // is gated. Either the response redirected or the URL moved away.
    expect(res?.status()).toBeLessThan(500);
    await expect(page).not.toHaveURL(new RegExp(`${CRITIQUE}$`));
  });

  test('no uncaught client error while loading the admin bundle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(CRITIQUE);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});

// Unskip once an admin storageState exists (see playwright.config `use.storageState`).
test.describe.skip('Lyric Critic — authored flow', () => {
  test('types Tamil, autosaves, and offers the working copy back after reload', async ({ page }) => {
    await page.goto(CRITIQUE);

    // Transliteration is the default mode.
    const toggle = page.getByRole('button', { name: /english → tamil/i });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const editor = page.locator('#critic-lyrics');
    await editor.fill('கண்ணே');

    // Dirty immediately, saved once the debounce elapses.
    await expect(page.getByTestId('autosave-status')).toHaveText(/unsaved changes/i);
    await expect(page.getByTestId('autosave-status')).toHaveText(/all changes saved/i, { timeout: 15_000 });

    // A reload must not lose the text.
    await page.reload();
    await expect(page.getByRole('button', { name: /restore it/i })).toBeVisible();
    await page.getByRole('button', { name: /restore it/i }).click();
    await expect(editor).toHaveValue(/கண்ணே/);
  });

  test('direct-Tamil mode writes to the same field', async ({ page }) => {
    await page.goto(CRITIQUE);
    await page.getByRole('button', { name: /english → tamil/i }).click();
    await expect(page.getByRole('button', { name: /direct tamil/i })).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#critic-lyrics').fill('பல்லவி');
    await expect(page.locator('#critic-lyrics')).toHaveValue('பல்லவி');
  });
});
