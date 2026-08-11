/**
 * Admin E2E credentials — plain helpers, deliberately NOT a test file.
 *
 * Playwright refuses to let one test file import another, so the values shared
 * between the setup project and the admin specs live here on their own.
 *
 * ⚠️ CREDENTIALS COME FROM THE ENVIRONMENT AND ARE NEVER COMMITTED.
 */

export const ADMIN_STORAGE_STATE = 'tests/.auth/admin.json';

export function adminCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

/** Stated once, so every skip gives the same actionable reason. */
export const NO_CREDS_REASON =
  'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set — admin E2E needs a Cognito user that is also in ADMIN_EMAILS.';
