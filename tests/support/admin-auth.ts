/**
 * Cognito login for the admin E2E project, run once and cached as storageState.
 *
 * WHY A SETUP PROJECT RATHER THAN A beforeEach. Signing in through the Amplify
 * Authenticator is a real Cognito round trip; doing it per test made the admin
 * specs slower than the pages they exercise. Playwright's dependency mechanism
 * runs this once, writes the session to disk, and every admin test starts
 * already authenticated.
 *
 * ⚠️ CREDENTIALS COME FROM THE ENVIRONMENT AND ARE NEVER COMMITTED.
 * `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, against the ISOLATED e2e pool wired
 * in playwright.config.ts — never the production pool. When they are absent the
 * admin project SKIPS with an explanatory message rather than failing: a red
 * suite that everyone learns to ignore is worse than an honestly skipped one.
 *
 * ⚠️ THE LOCALHOST COOKIE PROBLEM, and why this file mirrors storage by hand.
 * `src/lib/amplify-config.ts` deliberately skips `cookieStorage` on localhost,
 * because Secure cookies require HTTPS — so on http://localhost Amplify keeps
 * its tokens in localStorage. But `src/middleware.ts` gates /admin by looking
 * for a `CognitoIdentityServiceProvider.*` COOKIE. The two disagree, so a
 * perfectly good local login still bounces /admin → /login forever, and the
 * login page pushes straight back to /admin: an infinite redirect.
 *
 * Rather than weaken the app's auth to suit a test, this signs in for real and
 * then copies the tokens Amplify placed in localStorage into the cookies the
 * middleware expects. Nothing is fabricated — the cookie values are the tokens
 * Cognito just issued. This is a LOCAL-DEV shim: in production the app sets
 * these cookies itself and the mirroring is a no-op.
 */

import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADMIN_STORAGE_STATE, adminCredentials, NO_CREDS_REASON } from './admin-credentials';

setup('authenticate as admin', async ({ page, context, baseURL }) => {
  const creds = adminCredentials();
  setup.skip(!creds, NO_CREDS_REASON);
  if (!creds) return;

  await page.goto('/login');

  // Target by label so this survives Amplify UI markup changing between minors.
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).first().fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait on the TOKENS, not on a URL. The post-login redirect to /admin is the
  // very thing the cookie/localStorage mismatch breaks, so waiting for it would
  // hang until timeout on exactly the run we want to succeed.
  const tokens = await page.waitForFunction(
    () => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('CognitoIdentityServiceProvider.')) out[k] = localStorage.getItem(k) ?? '';
      }
      // LastAuthUser plus at least an idToken means the session is established.
      return Object.keys(out).some((k) => k.endsWith('.idToken')) &&
        Object.keys(out).some((k) => k.endsWith('.LastAuthUser'))
        ? out
        : null;
    },
    undefined,
    { timeout: 30_000 }
  );
  const store = (await tokens.jsonValue()) as Record<string, string>;

  // Mirror into cookies for the middleware. Only the token keys it actually
  // matches are worth setting; see the pattern in src/middleware.ts.
  const host = new URL(baseURL || 'http://localhost:3000').hostname;
  const wanted = Object.entries(store).filter(
    ([k]) => k.endsWith('.idToken') || k.endsWith('.accessToken') || k.endsWith('.LastAuthUser')
  );
  expect(wanted.length).toBeGreaterThan(0);
  await context.addCookies(
    wanted.map(([name, value]) => ({
      name,
      value,
      domain: host,
      path: '/',
      httpOnly: false,
      secure: false, // http://localhost — matching the app's own localhost rule
      sameSite: 'Lax' as const,
    }))
  );

  // Now the middleware will let us through, and the client still has its
  // localStorage session, so the admin shell does not push us back to /login.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin/);
  await expect(page).not.toHaveURL(/\/login/);

  if (!existsSync(dirname(ADMIN_STORAGE_STATE))) {
    mkdirSync(dirname(ADMIN_STORAGE_STATE), { recursive: true });
  }
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
