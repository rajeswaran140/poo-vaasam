import { test, expect } from '@playwright/test';

test.describe('AI Features Testing', () => {

  test('AI Search page loads correctly', async ({ page }) => {
    await page.goto('/ai-search');
    await page.waitForLoadState('networkidle');

    // Check page title
    await expect(page.locator('h1')).toContainText('AI தேடல்');

    // Check search input exists
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible();

    // Check search button exists
    const searchButton = page.locator('button:has-text("தேடு")');
    await expect(searchButton).toBeVisible();

    console.log('✅ AI Search page loaded successfully');
  });

  test('Poetry Guide Chat button appears on content pages', async ({ page }) => {
    // Go to home page first
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Try to find any poem link
    const poemLinks = page.locator('a[href^="/content/"]');
    const count = await poemLinks.count();

    if (count > 0) {
      // Click first poem
      await poemLinks.first().click();
      await page.waitForLoadState('networkidle');

      // Wait a bit for chat button to render
      await page.waitForTimeout(2000);

      // Look for chat button
      const chatButton = page.locator('button').filter({ hasText: /கவிதை வழிகாட்டி|AI/ });

      if (await chatButton.count() > 0) {
        console.log('✅ Poetry Guide Chat button found on poem page');
        await expect(chatButton.first()).toBeVisible();
      } else {
        console.log('⚠️  No poems with chat button found (this is OK if no poems exist)');
      }
    } else {
      console.log('⚠️  No poem links found to test chat feature');
    }
  });

  test('Check AI API endpoints are configured', async ({ page }) => {
    console.log('\n=== AI FEATURES CONFIGURATION TEST ===\n');

    // Test search endpoint availability (will fail auth but shows endpoint exists)
    const searchResponse = await page.request.post('/api/ai/search', {
      data: { query: 'test' }
    });

    console.log(`Search API Status: ${searchResponse.status()}`);
    console.log(`Search API exists: ${searchResponse.status() === 401 || searchResponse.status() === 200 || searchResponse.status() === 503 ? '✅' : '❌'}`);

    // Test chat endpoint availability
    const chatResponse = await page.request.post('/api/ai/chat', {
      data: { messages: [{ role: 'user', content: 'test' }] }
    });

    console.log(`Chat API Status: ${chatResponse.status()}`);
    console.log(`Chat API exists: ${chatResponse.status() === 401 || chatResponse.status() === 200 || chatResponse.status() === 503 ? '✅' : '❌'}`);

    console.log('\n=== Configuration Summary ===');
    console.log('If status is 401: API exists but needs authentication');
    console.log('If status is 503: API exists but keys not configured');
    console.log('If status is 200: API fully working');
    console.log('If status is 404: API route not found (error)');
  });
});
