/**
 * Landing Page Typography Audit
 *
 * Analyzes text alignment, spacing, line height, and readability
 */

import { test, expect } from '@playwright/test';

test.describe('Landing Page Typography Audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('audit hero section typography', async ({ page }) => {
    console.log('\n========== HERO SECTION AUDIT ==========\n');

    // Main headline
    const headline = page.locator('h1').first();
    const headlineBox = await headline.boundingBox();
    const headlineStyles = await headline.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        textAlign: styles.textAlign,
        letterSpacing: styles.letterSpacing,
        marginTop: styles.marginTop,
        marginBottom: styles.marginBottom,
        paddingTop: styles.paddingTop,
        paddingBottom: styles.paddingBottom,
      };
    });

    console.log('📝 Main Headline (h1):');
    console.log('  Font Size:', headlineStyles.fontSize);
    console.log('  Line Height:', headlineStyles.lineHeight);
    console.log('  Text Align:', headlineStyles.textAlign);
    console.log('  Letter Spacing:', headlineStyles.letterSpacing);
    console.log('  Margin Top:', headlineStyles.marginTop);
    console.log('  Margin Bottom:', headlineStyles.marginBottom);
    console.log('  Width:', headlineBox?.width, 'px');

    // Check if line height is adequate (should be 1.2-1.6 for headlines)
    const lineHeightValue = parseFloat(headlineStyles.lineHeight);
    const fontSizeValue = parseFloat(headlineStyles.fontSize);
    const lineHeightRatio = lineHeightValue / fontSizeValue;
    console.log('  Line Height Ratio:', lineHeightRatio.toFixed(2));

    if (lineHeightRatio < 1.1) {
      console.log('  ⚠️  WARNING: Line height too tight for Tamil text');
    } else if (lineHeightRatio > 1.6) {
      console.log('  ⚠️  WARNING: Line height too loose');
    } else {
      console.log('  ✅ Line height is optimal');
    }

    // Subtitle/description
    const description = page.locator('p').first();
    const descStyles = await description.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        textAlign: styles.textAlign,
        marginTop: styles.marginTop,
        marginBottom: styles.marginBottom,
        maxWidth: styles.maxWidth,
      };
    });

    console.log('\n📝 Description Text:');
    console.log('  Font Size:', descStyles.fontSize);
    console.log('  Line Height:', descStyles.lineHeight);
    console.log('  Text Align:', descStyles.textAlign);
    console.log('  Max Width:', descStyles.maxWidth);
    console.log('  Margin Top:', descStyles.marginTop);

    // Check paragraph line height (should be 1.5-1.8 for body text)
    const descLineHeightValue = parseFloat(descStyles.lineHeight);
    const descFontSizeValue = parseFloat(descStyles.fontSize);
    const descLineHeightRatio = descLineHeightValue / descFontSizeValue;
    console.log('  Line Height Ratio:', descLineHeightRatio.toFixed(2));

    if (descLineHeightRatio < 1.4) {
      console.log('  ⚠️  WARNING: Line height too tight for readability');
    } else if (descLineHeightRatio > 2.0) {
      console.log('  ⚠️  WARNING: Line height too loose');
    } else {
      console.log('  ✅ Line height is optimal for readability');
    }
  });

  test('audit hero section alignment', async ({ page }) => {
    console.log('\n========== ALIGNMENT AUDIT ==========\n');

    // Check if content is centered
    const heroContent = page.locator('section').first().locator('div').first();
    const heroStyles = await heroContent.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        display: styles.display,
        justifyContent: styles.justifyContent,
        alignItems: styles.alignItems,
        textAlign: styles.textAlign,
        paddingLeft: styles.paddingLeft,
        paddingRight: styles.paddingRight,
      };
    });

    console.log('🎯 Hero Container:');
    console.log('  Display:', heroStyles.display);
    console.log('  Justify Content:', heroStyles.justifyContent);
    console.log('  Align Items:', heroStyles.alignItems);
    console.log('  Text Align:', heroStyles.textAlign);
    console.log('  Padding Left:', heroStyles.paddingLeft);
    console.log('  Padding Right:', heroStyles.paddingRight);

    // Check all text elements for alignment
    const allTextElements = await page.locator('h1, h2, h3, p').evaluateAll((elements) => {
      return elements.map((el) => {
        const styles = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          textAlign: styles.textAlign,
          text: el.textContent?.substring(0, 50),
        };
      });
    });

    console.log('\n📋 All Text Elements Alignment:');
    const alignmentCounts = { left: 0, center: 0, right: 0, justify: 0 };
    allTextElements.forEach((el, idx) => {
      if (idx < 10) { // Show first 10
        console.log(`  ${el.tag}: ${el.textAlign} - "${el.text}"`);
      }
      if (el.textAlign === 'left') alignmentCounts.left++;
      if (el.textAlign === 'center') alignmentCounts.center++;
      if (el.textAlign === 'right') alignmentCounts.right++;
      if (el.textAlign === 'justify') alignmentCounts.justify++;
    });

    console.log('\n📊 Alignment Distribution:');
    console.log('  Left:', alignmentCounts.left);
    console.log('  Center:', alignmentCounts.center);
    console.log('  Right:', alignmentCounts.right);
    console.log('  Justify:', alignmentCounts.justify);
  });

  test('audit spacing consistency', async ({ page }) => {
    console.log('\n========== SPACING AUDIT ==========\n');

    // Check section spacing
    const sections = page.locator('section');
    const sectionCount = await sections.count();

    console.log(`📐 Found ${sectionCount} sections\n`);

    for (let i = 0; i < Math.min(sectionCount, 5); i++) {
      const section = sections.nth(i);
      const spacing = await section.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          paddingTop: styles.paddingTop,
          paddingBottom: styles.paddingBottom,
          marginTop: styles.marginTop,
          marginBottom: styles.marginBottom,
        };
      });

      console.log(`Section ${i + 1}:`);
      console.log('  Padding Top:', spacing.paddingTop);
      console.log('  Padding Bottom:', spacing.paddingBottom);
      console.log('  Margin Top:', spacing.marginTop);
      console.log('  Margin Bottom:', spacing.marginBottom);
    }

    // Check heading spacing
    const headings = await page.locator('h1, h2, h3').evaluateAll((elements) => {
      return elements.slice(0, 8).map((el) => {
        const styles = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          marginTop: styles.marginTop,
          marginBottom: styles.marginBottom,
          text: el.textContent?.substring(0, 30),
        };
      });
    });

    console.log('\n📝 Heading Spacing:');
    headings.forEach((h) => {
      console.log(`  ${h.tag}: MT=${h.marginTop} MB=${h.marginBottom}`);
      console.log(`    "${h.text}"`);
    });
  });

  test('audit Tamil text readability', async ({ page }) => {
    console.log('\n========== TAMIL TEXT READABILITY ==========\n');

    // Find Tamil text elements
    const tamilElements = await page.locator('.font-tamil, [class*="tamil"]').evaluateAll((elements) => {
      return elements.slice(0, 5).map((el) => {
        const styles = window.getComputedStyle(el);
        return {
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          fontFamily: styles.fontFamily,
          fontWeight: styles.fontWeight,
          letterSpacing: styles.letterSpacing,
          wordSpacing: styles.wordSpacing,
        };
      });
    });

    console.log('🔤 Tamil Text Elements:');
    tamilElements.forEach((styles, idx) => {
      console.log(`\nElement ${idx + 1}:`);
      console.log('  Font Family:', styles.fontFamily);
      console.log('  Font Size:', styles.fontSize);
      console.log('  Font Weight:', styles.fontWeight);
      console.log('  Line Height:', styles.lineHeight);
      console.log('  Letter Spacing:', styles.letterSpacing);
      console.log('  Word Spacing:', styles.wordSpacing);

      const lineHeight = parseFloat(styles.lineHeight);
      const fontSize = parseFloat(styles.fontSize);
      const ratio = lineHeight / fontSize;

      if (ratio < 1.3) {
        console.log('  ⚠️  Tamil text may be cramped (line-height too tight)');
      } else {
        console.log('  ✅ Good spacing for Tamil characters');
      }
    });
  });

  test('audit responsive breakpoints', async ({ page }) => {
    console.log('\n========== RESPONSIVE TYPOGRAPHY AUDIT ==========\n');

    const viewports = [
      { name: 'Mobile', width: 375, height: 667 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Desktop', width: 1440, height: 900 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(300);

      const h1Styles = await page.locator('h1').first().evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          paddingLeft: styles.paddingLeft,
          paddingRight: styles.paddingRight,
        };
      });

      console.log(`\n📱 ${viewport.name} (${viewport.width}x${viewport.height}):`);
      console.log('  H1 Font Size:', h1Styles.fontSize);
      console.log('  H1 Line Height:', h1Styles.lineHeight);
      console.log('  Padding Horizontal:', h1Styles.paddingLeft, '/', h1Styles.paddingRight);
    }
  });

  test('identify typography issues', async ({ page }) => {
    console.log('\n========== TYPOGRAPHY ISSUES SUMMARY ==========\n');

    const issues: string[] = [];

    // Check for text overflow
    const overflowElements = await page.locator('*').evaluateAll((elements) => {
      return elements.filter((el) => {
        const styles = window.getComputedStyle(el);
        return (
          el.scrollWidth > el.clientWidth &&
          el.textContent &&
          el.textContent.trim().length > 0
        );
      }).length;
    });

    if (overflowElements > 5) {
      issues.push(`⚠️  ${overflowElements} elements have text overflow`);
    }

    // Check for very small text
    const smallTextElements = await page.locator('*').evaluateAll((elements) => {
      return elements.filter((el) => {
        const styles = window.getComputedStyle(el);
        const fontSize = parseFloat(styles.fontSize);
        return fontSize < 14 && el.textContent && el.textContent.trim().length > 10;
      }).length;
    });

    if (smallTextElements > 0) {
      issues.push(`⚠️  ${smallTextElements} elements have very small text (<14px)`);
    }

    // Check for missing line-height
    const noLineHeightElements = await page.locator('p, h1, h2, h3').evaluateAll((elements) => {
      return elements.filter((el) => {
        const styles = window.getComputedStyle(el);
        return styles.lineHeight === 'normal';
      }).length;
    });

    if (noLineHeightElements > 0) {
      issues.push(`⚠️  ${noLineHeightElements} text elements use default line-height`);
    }

    if (issues.length === 0) {
      console.log('✅ No major typography issues detected!');
    } else {
      console.log('Issues Found:');
      issues.forEach(issue => console.log(issue));
    }

    console.log('\n' + '='.repeat(50) + '\n');
  });
});
