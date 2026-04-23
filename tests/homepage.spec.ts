import { test, expect } from '@playwright/test';

test.describe('தமிழகவல் Homepage', () => {
  test('should display header with logo and navigation', async ({ page }) => {
    await page.goto('/');
    
    // Check header exists
    await expect(page.locator('header')).toBeVisible();
    
    // Check logo
    await expect(page.getByText('தமிழகவல்')).toBeVisible();
    
    // Check navigation links
    await expect(page.getByText('கவிதைகள்')).toBeVisible();
    await expect(page.getByText('பாடல்கள்')).toBeVisible();
    await expect(page.getByText('கதைகள்')).toBeVisible();
  });

  test('should display hero section with free messaging', async ({ page }) => {
    await page.goto('/');
    
    // Check "100% Free" badge
    await expect(page.getByText('முற்றிலும் இலவசம்')).toBeVisible();
    
    // Check tagline
    await expect(page.getByText('படியுங்கள். கேளுங்கள். அனுபவியுங்கள்.')).toBeVisible();
    
    // Check free features
    await expect(page.getByText('இலவச வாசிப்பு')).toBeVisible();
    await expect(page.getByText('இலவச கேட்டல்')).toBeVisible();
  });

  test('should display content type cards', async ({ page }) => {
    await page.goto('/');
    
    // Check all 5 content type cards are visible
    await expect(page.getByText('உள்ளடக்க தொகுப்புகள்')).toBeVisible();
    
    // Verify content type links work
    const poemsCard = page.locator('a[href="/poems"]');
    await expect(poemsCard).toBeVisible();
  });

  test('should navigate to poems page', async ({ page }) => {
    await page.goto('/');
    
    // Click on poems button
    await page.click('a[href="/poems"]');
    
    // Verify navigation
    await expect(page).toHaveURL(/.*poems/);
  });

  test('should be mobile responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Header should still be visible
    await expect(page.locator('header')).toBeVisible();
    
    // Mobile menu button should be visible
    const mobileMenuButton = page.locator('button[aria-label="Toggle menu"]');
    await expect(mobileMenuButton).toBeVisible();
  });
});
