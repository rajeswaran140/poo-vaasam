/**
 * E2E for the /admin/mastering LAYOUT (2026-11-07): five numbered steps, a
 * "More tools" disclosure closed on every load, and a "…" menu on each
 * saved-master row.
 *
 * WHAT THIS ADDS OVER THE JEST TESTS. jsdom has no stylesheet, so it cannot
 * tell whether a closed disclosure is actually invisible: Tailwind's `[hidden]`
 * rule loses to any display utility on the same element, and only a real
 * browser shows whether the panel stays hidden.
 *
 * ⚠️ READ-ONLY. The dev server talks to the REAL production table and
 * Lambdas. This spec only loads the page, opens and closes disclosures and a
 * menu. It never clicks Master, Save, Render, Short, Upload, Publish, Rename,
 * Delete or any menu ITEM.
 *
 * Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (see tests/support/admin-auth).
 */

import { test, expect } from '@playwright/test';
import { adminCredentials, NO_CREDS_REASON } from '../support/admin-credentials';

test.skip(!adminCredentials(), NO_CREDS_REASON);

test.describe('mastering page layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/mastering');
    await expect(page).toHaveURL(/\/admin\/mastering/);
    // Every admin page renders its title twice; the page's own h1 is level 1.
    await expect(
      page.getByRole('heading', { level: 1, name: /Sound Engineering & Mastering/ }).first()
    ).toBeVisible();
  });

  test('the five steps read top to bottom, in order', async ({ page }) => {
    const steps = page.getByRole('heading', { level: 2, name: /^[1-5] · / });
    await expect(steps).toHaveText(['1 · Upload', '2 · Master', '3 · Save', '4 · Video', '5 · YouTube']);
  });

  test('More tools is collapsed on load and opens on click', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /^More tools/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The real-browser check: hidden content must not be visible.
    await expect(page.getByRole('heading', { name: 'Repair marks', exact: true })).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Trim', 'Join two parts', 'Compare before and after', 'Repair marks']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }

    // Collapses again, and stays collapsed on the next load.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await page.reload();
    await expect(page.getByRole('button', { name: /^More tools/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a saved-master row opens its "…" menu and closes it with Escape', async ({ page }) => {
    await page.getByRole('button', { name: /saved masters/i }).click();
    const menus = page.getByRole('button', { name: /^More actions for / });
    await menus.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    test.skip((await menus.count()) === 0, 'No saved master in this environment.');

    const trigger = menus.first();
    await expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const group = page.getByRole('group', { name: /^Actions for / });
    await expect(group).toBeVisible();
    // Every row offers these; the render items need a master file, so they
    // are checked only when this row offers a render at all.
    await expect(group.getByRole('button', { name: 'Rename', exact: true })).toBeVisible();
    await expect(group.getByRole('link', { name: /^(Stems \(\d+\)|Add stems)$/ })).toBeVisible();
    if ((await group.getByRole('button', { name: 'Make a short', exact: true }).count()) > 0) {
      for (const name of ['Make a short', 'Background', 'Slideshow', 'Whole-song vertical']) {
        await expect(group.getByRole('button', { name, exact: true })).toBeVisible();
      }
    }

    // Nothing in the menu is clicked. Escape closes it and focus goes back.
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(group).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
