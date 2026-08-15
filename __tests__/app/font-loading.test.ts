/** @jest-environment node */
/**
 * Fonts must stay self-hosted.
 *
 * ⚠️ WHY THIS TEST EXISTS. `next/font/google` downloads the .woff2 files from
 * fonts.gstatic.com AT BUILD TIME. When CodeBuild cannot reach it, the loader
 * gets null and the build dies with `TypeError: Cannot read properties of null
 * (reading '1')` — an error that names `layout.tsx` and looks like a code fault
 * while being purely a network one. It killed Amplify jobs 553 and 558 on
 * 2026-08-14 (2 of 8 builds that day), each costing a manual retry.
 *
 * Switching back to `next/font/google` would reintroduce that failure mode
 * silently — the code would look tidier and deploys would start failing at
 * random a week later. Hence a test rather than a comment.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

describe('fonts are self-hosted, not fetched from Google at build time', () => {
  /**
   * Matches an IMPORT, not any mention — the doc comment in `layout.tsx`
   * necessarily names `next/font/google` to explain why it is not used, and a
   * bare substring check flags that comment as a violation.
   */
  it('does not import from next/font/google', () => {
    expect(layout).not.toMatch(/^\s*import[\s\S]*?from ["']next\/font\/google["']/m);
  });

  it('uses next/font/local', () => {
    expect(layout).toMatch(/from ["']next\/font\/local["']/);
  });

  it('sources the files from the @fontsource packages', () => {
    expect(layout).toMatch(/@fontsource\/noto-sans-tamil/);
    expect(layout).toMatch(/@fontsource\/kavivanar/);
    expect(layout).toMatch(/@fontsource\/baloo-thambi-2/);
  });

  /**
   * The three CSS variables the whole site's typography hangs off. Renaming one
   * silently drops a font family back to the browser default.
   */
  it('keeps the CSS variable names the stylesheets expect', () => {
    for (const v of ['--font-tamil', '--font-kavivanar', '--font-baloo-thambi']) {
      expect(layout).toContain(v);
    }
  });

  /** Same weights as the previous Google configuration — no silent thinning. */
  it('keeps every weight the site uses', () => {
    const noto = layout.match(/noto-sans-tamil-tamil-(\d+)-normal/g) ?? [];
    expect(noto).toHaveLength(4); // 400 500 600 700
    const baloo = layout.match(/baloo-thambi-2-tamil-(\d+)-normal/g) ?? [];
    expect(baloo).toHaveLength(5); // 400 500 600 700 800
    expect(layout).toMatch(/kavivanar-tamil-400-normal/);
  });

  it('uses the TAMIL subset, not latin — this is a Tamil site', () => {
    // A latin-subset file would render Tamil text as tofu.
    expect(layout).not.toMatch(/-latin(-ext)?-\d+-normal/);
  });

  it('keeps display: swap so text is visible while the font loads', () => {
    expect(layout.match(/display: 'swap'/g) ?? []).toHaveLength(3);
  });
});

describe('the font packages are real dependencies', () => {
  it('lists them in package.json, so the build installs them', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['@fontsource/noto-sans-tamil']).toBeDefined();
    expect(deps['@fontsource/kavivanar']).toBeDefined();
    expect(deps['@fontsource/baloo-thambi-2']).toBeDefined();
  });
});
