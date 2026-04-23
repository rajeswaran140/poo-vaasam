/**
 * E2E Tests for Admin Portal
 *
 * Tests critical flows for content management
 */

import { test, expect } from '@playwright/test';

test.describe('Admin Portal - Critical Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Note: These tests require authentication setup
    // For now, we'll test the UI flows assuming user is authenticated
    await page.goto('/admin');
  });

  test.describe('Categories Management', () => {
    test('should display categories page', async ({ page }) => {
      await page.goto('/admin/categories');

      // Check page title
      await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();

      // Check for new category button
      await expect(page.getByRole('button', { name: /new category/i })).toBeVisible();
    });

    test('should open create category form', async ({ page }) => {
      await page.goto('/admin/categories');

      // Click new category button
      await page.getByRole('button', { name: /new category/i }).click();

      // Check form is visible
      await expect(page.getByText(/create new category/i)).toBeVisible();
      await expect(page.getByLabel(/category name/i)).toBeVisible();
      await expect(page.getByLabel(/description/i)).toBeVisible();
    });

    test('should validate required fields', async ({ page }) => {
      await page.goto('/admin/categories');

      // Open form
      await page.getByRole('button', { name: /new category/i }).click();

      // Try to submit without filling fields
      await page.getByRole('button', { name: /create category/i }).click();

      // Form should not submit (HTML5 validation)
      await expect(page.getByLabel(/category name/i)).toHaveAttribute('required');
    });
  });

  test.describe('Tags Management', () => {
    test('should display tags page', async ({ page }) => {
      await page.goto('/admin/tags');

      // Check page title
      await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();

      // Check for new tag button
      await expect(page.getByRole('button', { name: /new tag/i })).toBeVisible();
    });

    test('should open create tag form', async ({ page }) => {
      await page.goto('/admin/tags');

      // Click new tag button
      await page.getByRole('button', { name: /new tag/i }).click();

      // Check form is visible
      await expect(page.getByText(/create new tag/i)).toBeVisible();
      await expect(page.getByLabel(/tag name/i)).toBeVisible();
    });

    test('should show delete confirmation modal', async ({ page }) => {
      await page.goto('/admin/tags');

      // Check if there are any tags
      const tagElements = page.locator('[class*="group"]').filter({ hasText: '#' });
      const tagCount = await tagElements.count();

      if (tagCount > 0) {
        // Hover over first tag to show delete button
        await tagElements.first().hover();

        // Click delete button (small X button)
        await tagElements.first().locator('button').click();

        // Check confirmation modal appears
        await expect(page.getByText(/delete tag/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /delete tag/i })).toBeVisible();
      }
    });
  });

  test.describe('Content List', () => {
    test('should display content list page', async ({ page }) => {
      await page.goto('/admin/content');

      // Check page title
      await expect(page.getByRole('heading', { name: 'All Content' })).toBeVisible();

      // Check for create button
      await expect(page.getByRole('link', { name: /create new content/i })).toBeVisible();
    });

    test('should display filter buttons', async ({ page }) => {
      await page.goto('/admin/content');

      // Check filter buttons exist
      await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Songs' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Poems' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lyrics' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stories' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Essays' })).toBeVisible();
    });

    test('should filter content by type', async ({ page }) => {
      await page.goto('/admin/content');

      // Wait for content to load
      await page.waitForTimeout(1000);

      // Click Songs filter
      await page.getByRole('button', { name: 'Songs' }).click();

      // Check Songs button is active (has purple background)
      const songsButton = page.getByRole('button', { name: 'Songs' });
      await expect(songsButton).toHaveClass(/bg-purple-600/);
    });

    test('should have status filter dropdown', async ({ page }) => {
      await page.goto('/admin/content');

      // Check status dropdown exists
      const statusSelect = page.locator('select').filter({ hasText: 'All Status' });
      await expect(statusSelect).toBeVisible();

      // Check options
      await expect(statusSelect.locator('option', { hasText: 'All Status' })).toBeVisible();
      await expect(statusSelect.locator('option', { hasText: 'Published' })).toBeVisible();
      await expect(statusSelect.locator('option', { hasText: 'Draft' })).toBeVisible();
    });

    test('should display pagination when content exists', async ({ page }) => {
      await page.goto('/admin/content');

      // Wait for content to load
      await page.waitForTimeout(1000);

      // Check for pagination elements (they should exist even if disabled)
      const previousButton = page.getByRole('button', { name: 'Previous' });
      const nextButton = page.getByRole('button', { name: 'Next' });

      await expect(previousButton).toBeVisible();
      await expect(nextButton).toBeVisible();
    });
  });

  test.describe('Content Creation', () => {
    test('should display create content page', async ({ page }) => {
      await page.goto('/admin/content/new');

      // Check page title
      await expect(page.getByRole('heading', { name: /create new content/i })).toBeVisible();

      // Check content type buttons
      await expect(page.getByRole('button', { name: /songs/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /poems/i }).first()).toBeVisible();
    });

    test('should have Tamil input fields', async ({ page }) => {
      await page.goto('/admin/content/new');

      // Check for Tamil input labels
      await expect(page.getByText(/title.*தலைப்பு/i)).toBeVisible();
      await expect(page.getByText(/content.*உள்ளடக்கம்/i)).toBeVisible();
      await expect(page.getByText(/author.*ஆசிரியர்/i)).toBeVisible();
    });

    test('should allow content type selection', async ({ page }) => {
      await page.goto('/admin/content/new');

      // Click on different content types
      const songsButton = page.getByRole('button', { name: /🎵/ });
      const poemsButton = page.getByRole('button', { name: /📝/ });

      await songsButton.click();
      await expect(songsButton).toHaveClass(/border-purple-600/);

      await poemsButton.click();
      await expect(poemsButton).toHaveClass(/border-purple-600/);
    });
  });

  test.describe('Content Editing', () => {
    test.skip('should display edit page for existing content', async ({ page }) => {
      // Skip this test as it requires an existing content ID
      // In a real scenario, you would:
      // 1. Create content via API
      // 2. Navigate to edit page
      // 3. Test editing functionality
      // 4. Clean up
    });
  });

  test.describe('Navigation', () => {
    test('should navigate between admin sections', async ({ page }) => {
      await page.goto('/admin');

      // Navigate to categories
      await page.getByRole('link', { name: /categories/i }).click();
      await expect(page).toHaveURL(/\/admin\/categories/);

      // Navigate to tags
      await page.getByRole('link', { name: /tags/i }).click();
      await expect(page).toHaveURL(/\/admin\/tags/);

      // Navigate to content
      await page.getByRole('link', { name: /content/i }).click();
      await expect(page).toHaveURL(/\/admin\/content/);
    });

    test('should display admin header with logo', async ({ page }) => {
      await page.goto('/admin');

      // Check for logo text
      await expect(page.getByText('தமிழகவல்')).toBeVisible();
      await expect(page.getByText(/admin dashboard/i)).toBeVisible();
    });

    test('should have logout button', async ({ page }) => {
      await page.goto('/admin');

      // Check for logout button
      await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
    });
  });

  test.describe('Confirm Modal Component', () => {
    test('should close modal on cancel', async ({ page }) => {
      await page.goto('/admin/tags');

      // Try to trigger delete modal
      const tagElements = page.locator('[class*="group"]').filter({ hasText: '#' });
      const tagCount = await tagElements.count();

      if (tagCount > 0) {
        await tagElements.first().hover();
        await tagElements.first().locator('button').click();

        // Click cancel
        await page.getByRole('button', { name: /cancel/i }).click();

        // Modal should be closed
        await expect(page.getByText(/delete tag/i)).not.toBeVisible();
      }
    });

    test('should close modal on escape key', async ({ page }) => {
      await page.goto('/admin/tags');

      const tagElements = page.locator('[class*="group"]').filter({ hasText: '#' });
      const tagCount = await tagElements.count();

      if (tagCount > 0) {
        await tagElements.first().hover();
        await tagElements.first().locator('button').click();

        // Press escape
        await page.keyboard.press('Escape');

        // Modal should be closed
        await expect(page.getByText(/delete tag/i)).not.toBeVisible();
      }
    });
  });
});
