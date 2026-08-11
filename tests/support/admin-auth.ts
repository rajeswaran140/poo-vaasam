/**
 * Cognito login for the admin E2E project, run once and cached as storageState.
 *
 * WHY A SETUP PROJECT RATHER THAN A beforeEach. Signing in through the Amplify
 * Authenticator is a real Cognito round trip; doing it per test made the admin
 * specs slower than the pages they exercise. Playwright's dependency mechanism
 * runs this once, writes the tokens to disk, and every admin test starts
 * already authenticated.
 *
 * ⚠️ CREDENTIALS COME FROM THE ENVIRONMENT AND ARE NEVER COMMITTED.
 * `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`. When they are absent the admin
 * project SKIPS with an explanatory message rather than failing — a red suite
 * that everyone learns to ignore is worse than an honestly skipped one.
 *
 * ⚠️ The user must also be listed in the app's `ADMIN_EMAILS`, or the session
 * authenticates but every /api/admin/* call returns 403 and the pages render
 * empty — which looks like a product bug rather than a missing grant.
 */

import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADMIN_STORAGE_STATE, adminCredentials, NO_CREDS_REASON } from './admin-credentials';

setup('authenticate as admin', async ({ page }) => {
  const creds = adminCredentials();
  setup.skip(!creds, NO_CREDS_REASON);
  if (!creds) return;

  await page.goto('/login');

  // The Amplify Authenticator renders a plain sign-in form. Target by label so
  // this survives their markup changing between minor versions.
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // The login page pushes to /admin (or the ?redirect target) once Cognito
  // returns a user, so landing there is the real success signal.
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/admin/);

  if (!existsSync(dirname(ADMIN_STORAGE_STATE))) {
    mkdirSync(dirname(ADMIN_STORAGE_STATE), { recursive: true });
  }
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
