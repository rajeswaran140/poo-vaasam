#!/usr/bin/env node
/**
 * One-shot mobile audit — visits key public pages at real mobile viewports
 * against a target URL (default production), takes screenshots, and logs
 * suspect elements so we know WHAT is broken before speculating fixes.
 *
 * Run: node scripts/mobile-audit.mjs
 *      BASE_URL=http://localhost:3000 node scripts/mobile-audit.mjs
 * Screenshots land in /tmp/mobile-audit/.
 */
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'https://tamilagaval.com';
const OUT = '/tmp/mobile-audit';
const PAGES = ['/', '/songs', '/lyrics', '/videos', '/stories', '/popular'];
const DEVICE_LIST = [
  { name: 'iphone-se', spec: { ...devices['iPhone SE'] } },        // 375×667 — the tightest common phone
  { name: 'pixel-5',   spec: { ...devices['Pixel 5'] } },          // 393×851
  { name: 'iphone-12', spec: { ...devices['iPhone 12'] } },        // 390×844
];

// Tap-target audit — surface every interactive element under this size.
const MIN_TAP = 44;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

const findings = { overflow: [], tinyTaps: [], missingContent: [] };

for (const dev of DEVICE_LIST) {
  const ctx = await browser.newContext(dev.spec);
  const page = await ctx.newPage();

  for (const path of PAGES) {
    const url = `${BASE}${path}`;
    console.log(`→ ${dev.name.padEnd(12)}  ${url}`);
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    if (!resp || !resp.ok()) {
      console.log(`  ✗ HTTP ${resp?.status?.() ?? '?'} — skipping`);
      continue;
    }

    // Full-page screenshot
    const shotPath = `${OUT}/${dev.name}--${path === '/' ? 'home' : path.slice(1)}.png`;
    await page.screenshot({ path: shotPath, fullPage: true });

    // 1. Horizontal overflow — page wider than viewport = the classic mobile break
    const overflowInfo = await page.evaluate(({ vw }) => {
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const hasOverflow = scrollW > clientW + 1;
      // Find the specific offending elements — any element wider than viewport
      const wide = [];
      if (hasOverflow) {
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > vw + 4 && r.height > 4) {
            wide.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className || '').toString().slice(0, 80),
              width: Math.round(r.width),
              id: el.id || '',
            });
          }
        });
      }
      return { scrollW, clientW, hasOverflow, wide: wide.slice(0, 5) };
    }, { vw: dev.spec.viewport.width });
    if (overflowInfo.hasOverflow) {
      findings.overflow.push({ dev: dev.name, path, ...overflowInfo });
    }

    // 2. Tap targets — every button + link, flag under 44×44
    const taps = await page.evaluate((MIN_TAP) => {
      const results = [];
      document.querySelectorAll('a, button, [role="button"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return; // invisible
        if (r.width < MIN_TAP || r.height < MIN_TAP) {
          results.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 40),
            aria: el.getAttribute('aria-label') || '',
            width: Math.round(r.width),
            height: Math.round(r.height),
            href: el.getAttribute('href')?.slice(0, 60) || '',
          });
        }
      });
      return results;
    }, MIN_TAP);
    if (taps.length > 0) {
      findings.tinyTaps.push({ dev: dev.name, path, count: taps.length, samples: taps.slice(0, 8) });
    }
  }

  await ctx.close();
}

await browser.close();
await writeFile(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));

console.log('\n========== SUMMARY ==========');
console.log(`overflow issues:  ${findings.overflow.length}`);
console.log(`tap-target issues: ${findings.tinyTaps.length}  (${findings.tinyTaps.reduce((s, x) => s + x.count, 0)} total elements)`);
console.log(`\nScreenshots + findings.json in ${OUT}/`);
