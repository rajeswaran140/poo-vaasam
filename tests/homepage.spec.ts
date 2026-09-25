import { test, expect } from '@playwright/test';

/**
 * The homepage, as it is now.
 *
 * ⚠️ EVERY ASSERTION IN HERE USED TO FAIL, on all five browser projects, and
 * none of it was a bug in the page. The spec was written against an earlier
 * design and then drifted:
 *
 *  - `getByText('தமிழகவல்')` matched NINE nodes once the page gained headings
 *    and a footer carrying the name, and Playwright's strict mode fails a
 *    locator that resolves to more than one element. Loose text is not an
 *    identifier; the wordmark is asked for as the header's home link.
 *  - The tagline is now two spans reading "படியுங்கள். கேளுங்கள்." and
 *    "அனுபவித்து மகிழுங்கள்." — the old single string never existed as one text
 *    node, and the wording changed as well.
 *  - "இலவச வாசிப்பு", "இலவச கேட்டல்" and "உள்ளடக்க தொகுப்புகள்" are simply not
 *    on the page any more.
 *  - The mobile menu button is `aria-label="Open menu"`, never "Toggle menu".
 *
 * ⚠️ THIS SPEC RUNS AT PHONE WIDTH TOO (the Mobile Chrome and Mobile Safari
 * projects), where the desktop nav is display:none. So the nav is checked by
 * ATTRIBUTE, which only needs the link attached, and visibility is asserted
 * only for what is visible at every width.
 */
test.describe('தமிழகவல் Homepage', () => {
  /**
   * Where the header's nav must point. The name is matched EXACTLY, so that
   * "பாடல்கள்" does not also catch the neighbouring "பாடல் வரிகள்".
   */
  const NAV: ReadonlyArray<readonly [string, string]> = [
    ['பாடல்கள்', '/songs'],
    ['கவிதைகள்', '/poems'],
    ['கதைகள்', '/stories'],
  ];

  test('shows the header, the wordmark, and links to the three main sections', async ({ page }) => {
    await page.goto('/');

    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByRole('link', { name: 'தமிழகவல்', exact: true })).toBeVisible();

    // ⚠️ NOT getByRole. These three live inside the "படைப்புகள்" dropdown and
    // are display:none until it opens — and a role locator only ever matches
    // the ACCESSIBILITY TREE, which excludes hidden elements. getByRole here
    // reports "element(s) not found" for a link that is plainly in the DOM.
    for (const [name, href] of NAV) {
      const link = header.locator(`a[href="${href}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveText(name);
    }
  });

  test('opens on the hero: the free badge and the tagline', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('முற்றிலும் இலவசம்')).toBeVisible();

    // Asserted per line, because the tagline is two spans inside one h1 —
    // exactly what the old single-string assertion could never match.
    const hero = page.getByRole('heading', { level: 1 });
    await expect(hero).toContainText('படியுங்கள். கேளுங்கள்.');
    await expect(hero).toContainText('அனுபவித்து மகிழுங்கள்.');
  });

  test('offers a way into the poems collection', async ({ page }) => {
    await page.goto('/');

    // The page links to /poems more than once (header and body), which is
    // correct — so this counts rather than demanding a single match.
    const poems = page.locator('a[href="/poems"]');
    expect(await poems.count()).toBeGreaterThan(0);
  });

  test('navigates to the poems page from the footer nav', async ({ page }) => {
    /**
     * ⚠️ THIS TEST FAILED ON WEBKIT FOR A REASON WORTH REMEMBERING.
     *
     * The click landed on every engine, and on WebKit the URL simply never
     * changed. The cause was not the link, the selector, or Safari: the app
     * sent `upgrade-insecure-requests` in its CSP in DEVELOPMENT too, WebKit
     * honours it on localhost, and every internal navigation was rewritten to
     * `https://localhost:3000/...` — which the plain-HTTP dev server answered
     * with a failed TLS handshake. Chromium exempts localhost, so it looked
     * engine-specific. Fixed in src/config/csp.ts: the directive is production
     * only. Production was never affected — it is HTTPS, where the directive
     * is correct.
     */
    await page.goto('/');

    // ⚠️ THE FOOTER'S LINK, and it took four wrong answers to get here. The
    // page carries exactly two /poems links and the header's one is unusable:
    //   - opening the header's "படைப்புகள்" dropdown first HANGS at phone
    //     width, where that button does not exist at all (0 on Mobile Chrome);
    //   - a plain `.first()` picks the header copy, which is hidden on
    //     Chromium/Firefox/Mobile Chrome, and waits out the timeout;
    //   - on WebKit and Mobile Safari that same copy IS visible, but a
    //     lazy-loaded <img> below overlaps it and intercepts the pointer;
    //   - and there is no <main> on this page to scope to.
    // The footer's list link is the only one visible on all five projects.
    // Playwright scrolls to it, so the distance down the page costs nothing.
    // waitForURL is armed BEFORE the click: asserting afterwards races the
    // navigation, and on WebKit the route is slow enough for that to matter.
    const arrived = page.waitForURL(/\/poems/, { timeout: 45000 });
    await page.locator('li a[href="/poems"]:visible').first().click();
    await arrived;

    await expect(page).toHaveURL(/\/poems/);
  });

  test('offers the menu button at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  });
});
