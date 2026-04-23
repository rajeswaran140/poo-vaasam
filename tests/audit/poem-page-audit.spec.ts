import { test, expect } from '@playwright/test';

test.describe('Poem Page Typography and Layout Audit', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to poems page
    await page.goto('/poems');
    await page.waitForLoadState('networkidle');
  });

  test('audit poems listing page header typography', async ({ page }) => {
    console.log('\n=== POEMS LISTING PAGE HEADER AUDIT ===\n');

    // Find the header section
    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    // Check main heading
    const heading = header.locator('h1');
    const headingStyles = await heading.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight,
        fontWeight: styles.fontWeight,
        letterSpacing: styles.letterSpacing,
        color: styles.color,
      };
    });

    console.log('Header H1 Styles:', headingStyles);

    // Check subtitle/description
    const subtitle = header.locator('p').first();
    const subtitleStyles = await subtitle.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight,
        color: styles.color,
      };
    });

    console.log('Header Subtitle Styles:', subtitleStyles);

    // Recommendations
    console.log('\n📝 RECOMMENDATIONS FOR HEADER:');

    const headingFontSize = parseFloat(headingStyles.fontSize);
    if (headingFontSize < 48) {
      console.log('⚠️  Heading font size could be larger for better impact');
      console.log(`   Current: ${headingStyles.fontSize}, Recommended: 48px+`);
    }

    const lineHeight = parseFloat(headingStyles.lineHeight) / headingFontSize;
    if (lineHeight < 1.2 || lineHeight > 1.5) {
      console.log('⚠️  Heading line height needs adjustment for Tamil text');
      console.log(`   Current ratio: ${lineHeight.toFixed(2)}, Recommended: 1.2-1.5`);
    }

    if (!headingStyles.fontFamily.includes('Baloo') && !headingStyles.fontFamily.includes('Tamil')) {
      console.log('⚠️  Consider using Baloo Thambi 2 or optimized Tamil font');
    }
  });

  test('audit poems listing page hero section', async ({ page }) => {
    console.log('\n=== POEMS LISTING PAGE HERO SECTION AUDIT ===\n');

    const header = page.locator('header').first();

    // Check header background and padding
    const headerStyles = await header.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        background: styles.background,
        paddingTop: styles.paddingTop,
        paddingBottom: styles.paddingBottom,
        minHeight: styles.minHeight,
      };
    });

    console.log('Header Container Styles:', headerStyles);

    // Check if there are decorative elements
    const decorativeElements = await header.locator('div[class*="absolute"]').count();
    console.log(`Decorative elements found: ${decorativeElements}`);

    if (decorativeElements === 0) {
      console.log('⚠️  Consider adding decorative background elements for visual interest');
    }

    // Check responsive padding
    const paddingTop = parseFloat(headerStyles.paddingTop);
    if (paddingTop < 64) {
      console.log('⚠️  Header padding could be more generous');
      console.log(`   Current: ${headerStyles.paddingTop}, Recommended: 64px+ (py-16 or py-20)`);
    }
  });

  test('audit individual poem page - navigate and check', async ({ page }) => {
    console.log('\n=== INDIVIDUAL POEM PAGE AUDIT ===\n');

    // Find and click first poem card
    const firstPoemCard = page.locator('a[href^="/content/"]').first();
    const poemExists = await firstPoemCard.count() > 0;

    if (!poemExists) {
      console.log('⚠️  No poems found to test. Skipping individual page audit.');
      test.skip();
      return;
    }

    await firstPoemCard.click();
    await page.waitForLoadState('networkidle');

    // Check hero section on poem page
    const poemHeader = page.locator('h1').first();
    const poemHeaderStyles = await poemHeader.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight,
        fontWeight: styles.fontWeight,
        marginBottom: styles.marginBottom,
      };
    });

    console.log('Individual Poem Header Styles:', poemHeaderStyles);

    // Check poem body text (the actual poem content)
    const poemBody = page.locator('.poem-text, pre').first();
    const poemBodyExists = await poemBody.count() > 0;

    if (poemBodyExists) {
      const poemBodyStyles = await poemBody.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          fontSize: styles.fontSize,
          fontFamily: styles.fontFamily,
          lineHeight: styles.lineHeight,
          letterSpacing: styles.letterSpacing,
          whiteSpace: styles.whiteSpace,
          paddingTop: styles.paddingTop,
          paddingBottom: styles.paddingBottom,
        };
      });

      console.log('\nPoem Body Text Styles:', poemBodyStyles);

      // Calculate line height ratio
      const bodyFontSize = parseFloat(poemBodyStyles.fontSize);
      const bodyLineHeight = parseFloat(poemBodyStyles.lineHeight);
      const lineHeightRatio = bodyLineHeight / bodyFontSize;

      console.log(`\nLine Height Analysis:`);
      console.log(`  Font Size: ${bodyFontSize}px`);
      console.log(`  Line Height: ${bodyLineHeight}px`);
      console.log(`  Ratio: ${lineHeightRatio.toFixed(2)}`);

      console.log('\n📝 RECOMMENDATIONS FOR POEM BODY:');

      if (lineHeightRatio < 2.0) {
        console.log('⚠️  Line height is too tight for Tamil poetry');
        console.log(`   Current ratio: ${lineHeightRatio.toFixed(2)}, Recommended: 2.0-2.4`);
        console.log('   This affects readability and aesthetic spacing between lines');
      }

      if (lineHeightRatio > 2.6) {
        console.log('⚠️  Line height might be too loose');
        console.log(`   Current ratio: ${lineHeightRatio.toFixed(2)}, Recommended: 2.0-2.4`);
      }

      if (bodyFontSize < 18) {
        console.log('⚠️  Font size could be larger for better readability');
        console.log(`   Current: ${bodyFontSize}px, Recommended: 20-22px`);
      }

      if (!poemBodyStyles.fontFamily.includes('Baloo') && !poemBodyStyles.fontFamily.includes('Tamil')) {
        console.log('⚠️  Consider using Baloo Thambi 2 font for poems');
      }

      const letterSpacing = parseFloat(poemBodyStyles.letterSpacing);
      if (letterSpacing < 0.5) {
        console.log('⚠️  Letter spacing could be slightly increased');
        console.log(`   Current: ${letterSpacing}px, Recommended: 0.5-1px`);
      }
    } else {
      console.log('⚠️  Poem body text not found with expected selectors');
    }
  });

  test('audit poem paragraph spacing', async ({ page }) => {
    console.log('\n=== POEM PARAGRAPH SPACING AUDIT ===\n');

    // Navigate to a poem
    const firstPoemCard = page.locator('a[href^="/content/"]').first();
    const poemExists = await firstPoemCard.count() > 0;

    if (!poemExists) {
      console.log('⚠️  No poems found to test. Skipping paragraph spacing audit.');
      test.skip();
      return;
    }

    await firstPoemCard.click();
    await page.waitForLoadState('networkidle');

    // Check for paragraph elements or line breaks in poem text
    const poemContainer = page.locator('.poem-text, pre, [class*="poem"]').first();

    if (await poemContainer.count() > 0) {
      const containerStyles = await poemContainer.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const text = el.textContent || '';
        const lines = text.split('\n').filter(line => line.trim().length > 0);

        return {
          lineHeight: styles.lineHeight,
          fontSize: styles.fontSize,
          whiteSpace: styles.whiteSpace,
          lineCount: lines.length,
          paddingTop: styles.paddingTop,
          paddingBottom: styles.paddingBottom,
          marginTop: styles.marginTop,
          marginBottom: styles.marginBottom,
        };
      });

      console.log('Poem Container Analysis:', containerStyles);

      console.log('\n📝 PARAGRAPH SPACING RECOMMENDATIONS:');

      if (containerStyles.whiteSpace !== 'pre-wrap') {
        console.log('⚠️  white-space should be "pre-wrap" to preserve poem formatting');
        console.log(`   Current: ${containerStyles.whiteSpace}`);
      }

      const padding = parseFloat(containerStyles.paddingTop) + parseFloat(containerStyles.paddingBottom);
      if (padding < 32) {
        console.log('⚠️  Container padding could be more generous');
        console.log(`   Current total: ${padding}px, Recommended: 48px+ (combined)`);
      }
    }
  });

  test('audit responsive behavior', async ({ page }) => {
    console.log('\n=== RESPONSIVE DESIGN AUDIT ===\n');

    const viewports = [
      { name: 'Mobile', width: 375, height: 667 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Desktop', width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(500); // Allow layout to settle

      const heading = page.locator('header h1').first();
      const styles = await heading.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          paddingLeft: styles.paddingLeft,
          paddingRight: styles.paddingRight,
        };
      });

      console.log(`\n${viewport.name} (${viewport.width}x${viewport.height}):`);
      console.log(`  Heading Font Size: ${styles.fontSize}`);
      console.log(`  Line Height: ${styles.lineHeight}`);

      const fontSize = parseFloat(styles.fontSize);
      if (viewport.name === 'Mobile' && fontSize > 36) {
        console.log('  ⚠️  Font size might be too large for mobile');
      }
      if (viewport.name === 'Desktop' && fontSize < 48) {
        console.log('  ⚠️  Font size could be larger on desktop');
      }
    }
  });

  test('generate comprehensive improvement report', async ({ page }) => {
    console.log('\n' + '='.repeat(80));
    console.log('📊 COMPREHENSIVE POEM PAGE IMPROVEMENT REPORT');
    console.log('='.repeat(80) + '\n');

    // Collect all data
    const header = page.locator('header h1').first();
    const headerData = await header.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight,
      };
    });

    console.log('🎯 PRIORITY IMPROVEMENTS NEEDED:\n');

    console.log('1. POEMS LISTING HEADER:');
    console.log('   - Use Baloo Thambi 2 font for better visual impact');
    console.log('   - Increase heading size to 56-64px on desktop');
    console.log('   - Add decorative gradient elements');
    console.log('   - Ensure line-height is 1.2-1.4 for Tamil characters\n');

    console.log('2. INDIVIDUAL POEM PAGE HERO:');
    console.log('   - Use consistent branding with main site');
    console.log('   - Ensure proper contrast ratios');
    console.log('   - Add breathing room with generous padding\n');

    console.log('3. POEM BODY TEXT (CRITICAL):');
    console.log('   - Line height MUST be 2.0-2.4 for Tamil poetry');
    console.log('   - Font size: 20-22px for optimal readability');
    console.log('   - Use Baloo Thambi 2 for consistent experience');
    console.log('   - Letter spacing: 0.5-1px');
    console.log('   - Preserve stanza breaks with proper spacing\n');

    console.log('4. PARAGRAPH SPACING:');
    console.log('   - Add margin between stanzas (24-32px)');
    console.log('   - Preserve poem formatting with white-space: pre-wrap');
    console.log('   - Consider adding subtle visual separators between stanzas\n');

    console.log('='.repeat(80));
  });
});
