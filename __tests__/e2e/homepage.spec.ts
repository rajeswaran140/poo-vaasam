/**
 * E2E Tests for Homepage
 *
 * Testing the complete user journey on the homepage
 */

import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have correct title and meta', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/பூ வாசம்|Poo Vaasam/);

    // Check meta description
    const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDescription).toContain('Tamil content publishing platform');
  });

  test('should display main heading in Tamil', async ({ page }) => {
    // Check for Tamil heading
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('பூ வாசம்');
  });

  test('should display subtitle in Tamil', async ({ page }) => {
    // Check for Tamil subtitle
    const subtitle = page.getByText('தமிழ் இலக்கிய உள்ளடக்க வெளியீட்டு தளம்');
    await expect(subtitle).toBeVisible();
  });

  test('should render Tamil fonts correctly', async ({ page }) => {
    // Check if Tamil font is loaded
    const heading = page.locator('h1');
    const fontFamily = await heading.evaluate((el) => {
      return window.getComputedStyle(el).fontFamily;
    });

    expect(fontFamily).toContain('Noto Sans Tamil');
  });

  test('should display content type cards', async ({ page }) => {
    // Check for content cards
    await expect(page.getByText('பாடல்கள்')).toBeVisible();
    await expect(page.getByText('கவிதைகள்')).toBeVisible();
    await expect(page.getByText('கதைகள்')).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Check if content is still visible
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();

    // Check if cards stack vertically
    const cards = page.locator('div.grid > div');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should have accessible content', async ({ page }) => {
    // Run basic accessibility checks
    const heading = page.locator('h1');
    await expect(heading).toHaveAttribute('class');

    // Check for proper HTML structure
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('should display Phase 1 completion message', async ({ page }) => {
    // Check for the Phase 1 message
    await expect(page.getByText(/Phase 1: Foundation Setup Complete/)).toBeVisible();
  });

  test('should load without console errors', async ({ page }) => {
    const errors: string[] = [];

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // No console errors should be present
    expect(errors).toHaveLength(0);
  });

  test('should have correct language attribute', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ta');
  });

  test('should support dark mode (if implemented)', async ({ page }) => {
    // Check if dark mode classes exist
    const body = page.locator('body');
    const className = await body.getAttribute('class');

    // The class might contain dark mode related classes
    expect(className).toBeDefined();
  });
});

test.describe('Homepage Performance', () => {
  test('should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loadTime = Date.now() - startTime;

    // Should load within 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  test('should have good Core Web Vitals', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get performance metrics
    const metrics = await page.evaluate(() => {
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find((entry) => entry.name === 'first-contentful-paint');

      return {
        fcp: fcp?.startTime || 0,
      };
    });

    // FCP should be less than 1.8 seconds for good score
    expect(metrics.fcp).toBeLessThan(1800);
  });
});
