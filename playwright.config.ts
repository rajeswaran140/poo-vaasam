import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  /**
   * ⚠️ 60 s, NOT Playwright's 30 s default, and the reason is the web server
   * below: `next dev` COMPILES EACH ROUTE ON FIRST REQUEST. With five browser
   * projects running fully parallel against one dev server, an admin route's
   * first visit regularly costs more than 30 s — and it failed as a timeout on
   * an assertion, which reads exactly like a broken selector and sent a whole
   * afternoon chasing locators that were already correct.
   *
   * This is NOT a way to let slow product code pass: every one of those tests
   * passes in about a second once the route is compiled. The durable fix is to
   * serve a production BUILD here instead of `next dev`, at which point this
   * can go back to the default.
   */
  timeout: 60_000,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Signs in to Cognito once and caches the tokens; `admin` depends on it.
    // Skips itself (and therefore leaves `admin` with nothing to run) when
    // E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set.
    {
      name: 'setup',
      testMatch: /support\/admin-auth\.ts/,
    },
    // Admin pages are behind Cognito, so they cannot share the anonymous
    // projects' context. Kept separate rather than authenticating everything:
    // the public pages must keep being tested as a logged-OUT visitor sees
    // them, which is how most of the audience arrives.
    {
      name: 'admin',
      testMatch: /e2e\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /e2e\/.*\.spec\.ts/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /e2e\/.*\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /e2e\/.*\.spec\.ts/,
    },
    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: /e2e\/.*\.spec\.ts/,
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testIgnore: /e2e\/.*\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      // Point local dev at the ISOLATED e2e Cognito pool, never the production
      // one. These are public identifiers (NEXT_PUBLIC_*), not secrets — the
      // only secret is the password, which lives in SSM and reaches the run
      // through E2E_ADMIN_PASSWORD. Production's pool and ADMIN_EMAILS are
      // deliberately untouched by any of this.
      NEXT_PUBLIC_USER_POOL_ID: process.env.E2E_USER_POOL_ID || 'ca-central-1_yVricaWyq',
      NEXT_PUBLIC_USER_POOL_CLIENT_ID:
        process.env.E2E_USER_POOL_CLIENT_ID || '2065k71nr8f05pol6ca26jc2hs',
      NEXT_PUBLIC_AWS_REGION: 'ca-central-1',
      // The e2e user must clear the server-side admin gate too, or the pages
      // render empty and it reads as a product bug (src/lib/auth-helper.ts).
      ADMIN_EMAILS: process.env.E2E_ADMIN_EMAIL || 'e2e@tamilagaval.test',
      // The identity pool is optional in amplify-config; leaving it unset keeps
      // the e2e session away from any AWS credentials.
      NEXT_PUBLIC_IDENTITY_POOL_ID: '',
    },
  },
});
