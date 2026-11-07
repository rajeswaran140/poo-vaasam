/**
 * E2E for /admin/video-text (2026-11-07): the project list, and (when one
 * exists) that opening a project renders the editor's main controls.
 *
 * ⚠️ READ-ONLY. The dev server talks to the REAL production table. This spec
 * only loads the list and opens an existing project (a read). It never
 * creates, uploads, renders, renames or deletes, and never clicks "New
 * project", "Create" or "Make video".
 *
 * Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (see tests/support/admin-auth).
 */

import { test, expect, type Page } from '@playwright/test';
import { adminCredentials, NO_CREDS_REASON } from '../support/admin-credentials';

test.skip(!adminCredentials(), NO_CREDS_REASON);

async function waitForList(page: Page) {
  // The list is loaded once either the empty note or at least one project shows.
  await expect(
    page.getByText('No projects yet.').or(page.locator('ul li button').first())
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('video text page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/video-text');
    await expect(page).toHaveURL(/\/admin\/video-text/);
    // Every admin page renders its title twice; the page's own h1 is level 1.
    await expect(page.getByRole('heading', { level: 1, name: /Video Text/ }).first()).toBeVisible();
  });

  test('shows the project list and the New project button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await waitForList(page);
  });

  test('does not scroll sideways at 390 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await waitForList(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('opening an existing project shows the editor, and All projects returns', async ({ page }) => {
    await waitForList(page);
    const rows = page.locator('ul li button');
    test.skip((await rows.count()) === 0, 'No project in this environment (the spec never creates one).');

    await rows.first().click();
    await expect(page).toHaveURL(/[?&]p=/);
    await expect(page.getByRole('button', { name: /All projects/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: /All projects/ }).click();
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]p=/);
  });
});
