/**
 * E2E for /admin/video-text (2026-11-07): the project list, and (when one
 * exists) that opening a project renders the editor's main controls.
 *
 * ⚠️ READ-ONLY. The dev server talks to the REAL production table. This spec
 * only loads the list and opens an existing project (a read). It never
 * creates, uploads, renders, renames or deletes, and never clicks "New
 * project", "Create" or "Make video".
 *
 * Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (see tests/support/admin-auth).
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { defaultBlocks } from '../../src/lib/video-text/timeline';
import { adminCredentials, NO_CREDS_REASON } from '../support/admin-credentials';

test.skip(!adminCredentials(), NO_CREDS_REASON);

/**
 * Fails the test on ANY non-GET request to /api/ that nothing more specific
 * fulfilled. Register it BEFORE the mocks: Playwright runs the last-registered
 * matching route first, so a mock that fulfils never reaches this one. GETs
 * (the admin shell's own reads) pass through.
 */
async function guardApiWrites(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.abort();
  });
  return writes;
}

async function waitForList(page: Page) {
  // The list is loaded once either the empty note or at least one project shows.
  await expect(
    page.getByText('No projects yet.').or(page.locator('ul li button').first())
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('video text page', () => {
  let writes: string[] = [];
  test.beforeEach(async ({ page }) => {
    writes = await guardApiWrites(page);
    await page.goto('/admin/video-text');
    await expect(page).toHaveURL(/\/admin\/video-text/);
    // Every admin page renders its title twice; the page's own h1 is level 1.
    await expect(page.getByRole('heading', { level: 1, name: /Video Text/ }).first()).toBeVisible();
  });

  test.afterEach(() => {
    expect(writes, 'non-GET /api/ requests made against production').toEqual([]);
  });

  test('shows the project list and the New project button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await waitForList(page);
  });

  test('does not scroll sideways at 390 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await waitForList(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('opening an existing project shows the editor, and All projects returns', async ({ page }) => {
    await waitForList(page);
    const rows = page.locator('ul li button');
    test.skip((await rows.count()) === 0, 'No project in this environment (the spec never creates one).');

    await rows.first().click();
    await expect(page).toHaveURL(/[?&]p=/);
    await expect(page.getByRole('button', { name: /All projects/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: /All projects/ }).click();
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]p=/);
  });
});

/**
 * The editor in a real browser WITHOUT touching production: every
 * /api/admin/video-text request is fulfilled here, and the only other request
 * the page may make for the project is the fixture clip. Anything else under
 * that API is aborted and fails the test.
 *
 * The clip is WebM (VP8 + Opus), not MP4: Playwright's bundled Chromium has no
 * H.264 decoder, so an MP4 would never produce a frame to draw over.
 */
test.describe('video text editor (mocked API)', () => {
  const ID = 'e2efixture01';
  const DURATION = 40;
  const CLIP_URL = '/e2e-fixture/clip.webm';
  const lyricsText = 'தமிழ் மண்ணின் வாசம்\nகடலலை பாடும் ராகம்\nஊரெங்கும் உறவின் கீதம்';
  const titleText = 'தமிழகவல்';
  const creditsText = 'இசை: ராஜ்';

  let clipPath = '';
  let ffmpegMissing = '';

  test.beforeAll(() => {
    const dir = path.join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    clipPath = path.join(dir, 'video-text-fixture.webm');
    try {
      execFileSync(
        'ffmpeg',
        [
          '-y', '-loglevel', 'error',
          '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=25:duration=${DURATION}`,
          '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURATION}`,
          '-c:v', 'libvpx', '-b:v', '1M', '-g', '5', '-c:a', 'libopus', '-shortest', clipPath,
        ],
        { stdio: 'pipe' }
      );
    } catch (err) {
      ffmpegMissing = `ffmpeg could not make the fixture clip: ${err instanceof Error ? err.message.split('\n')[0] : err}`;
    }
  });

  function project() {
    const now = new Date().toISOString();
    return {
      id: ID,
      name: 'E2E fixture song',
      titleText,
      creditsText,
      lyricsText,
      blocks: defaultBlocks({ titleText, creditsText, lyricsText, durationSec: DURATION }),
      style: { sizeScale: 1, lyricPosition: 'lower' },
      source: {
        key: 'video-text/e2efixture01/source.mp4',
        width: 1280,
        height: 720,
        fps: 25,
        durationSec: DURATION,
        hasAudio: true,
        uploadedAt: now,
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      },
      render: {
        renderId: null, status: 'idle', progress: null, outputKey: null,
        outputExpiresAt: null, error: null, startedAt: null, updatedAt: null,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  test('renders the tracks, draws the title, nudges a block, and never calls the real API', async ({ page }, testInfo) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');

    const writes = await guardApiWrites(page);
    const unexpected: string[] = [];
    const patches: string[] = [];
    const json = (route: Route, body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    await page.route('**/api/admin/video-text**', async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      const rest = pathname.replace(/^\/api\/admin\/video-text\/?/, '');
      const method = req.method();
      if (rest === '' && method === 'GET') return json(route, { projects: [project()] });
      if (rest === ID && method === 'GET') return json(route, { project: project() });
      if (rest === `${ID}/source` && method === 'GET') return json(route, { url: CLIP_URL });
      if (rest === ID && method === 'PATCH') {
        patches.push(req.postData() ?? '');
        const sent = JSON.parse(req.postData() ?? '{}');
        return json(route, { version: (sent.version ?? 1) + 1 });
      }
      unexpected.push(`${method} ${pathname}`);
      return route.abort();
    });

    // Serve the clip with Range support so the browser can seek.
    await page.route(`**${CLIP_URL}`, async (route) => {
      const body = readFileSync(clipPath);
      const size = statSync(clipPath).size;
      const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers()['range'] ?? '');
      if (!range) {
        return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes' }, body });
      }
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      return route.fulfill({
        status: 206,
        contentType: 'video/webm',
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}` },
        body: body.subarray(start, end + 1),
      });
    });

    await page.goto('/admin/video-text');
    await page.locator('ul li button').first().click();
    await expect(page.getByRole('button', { name: /All projects/ })).toBeVisible({ timeout: 30_000 });

    // Three tracks, and the three lyric blocks as labelled sliders.
    for (const row of ['Title row', 'Lyrics row', 'Credits row']) {
      await expect(page.getByRole('group', { name: row })).toBeVisible();
    }
    const lyricBlocks = page.getByRole('slider', { name: /^Lyric \d: / });
    await expect(lyricBlocks).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(lyricBlocks.nth(i)).toBeVisible();

    // Seek to ~1 s: the title is on screen, so the overlay canvas has pixels.
    const video = page.locator('video');
    await expect(video).toBeVisible();
    const blocks = project().blocks;
    const lyrics = blocks.filter((b) => b.track === 'lyric');
    // Real, non-overlapping widths (title 0-5, credits 30-40, lyrics tile 5-30).
    expect(lyrics).toHaveLength(3);
    for (const b of lyrics) expect(b.endSec - b.startSec).toBeGreaterThan(5);
    for (let i = 0; i < 3; i++) {
      const box = await lyricBlocks.nth(i).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
    }
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    const seekTo = (sec: number) =>
      video.evaluate(
        (v: HTMLVideoElement, t: number) =>
          new Promise<void>((resolve) => {
            v.addEventListener('seeked', () => resolve(), { once: true });
            v.currentTime = t;
          }),
        sec
      );
    await seekTo(1);
    /** Non-transparent pixels in the horizontal band [fromY, toY) of the overlay (0..1 of its height). */
    const opaque = (fromY: number, toY: number) =>
      page.evaluate(
        ([a, b]) => {
          const c = document.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement | null;
          const ctx = c?.getContext('2d');
          if (!c || !ctx || !c.width || !c.height) return 0;
          const y0 = Math.floor(c.height * a);
          const d = ctx.getImageData(0, y0, c.width, Math.floor(c.height * b) - y0).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
          return n;
        },
        [fromY, toY]
      );
    await expect.poll(() => opaque(0, 1), { timeout: 15_000 }).toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/video-text-editor-1280.png', fullPage: true });

    // Seek into the first lyric block: the redraw follows the seek and the
    // lyric lands in the lower third (and the title is gone by then).
    await seekTo(lyrics[0].startSec + 2);
    await expect.poll(() => opaque(2 / 3, 1), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => opaque(0, 1 / 3), { timeout: 15_000 }).toBe(0);

    // ArrowRight on a focused lyric block moves it. Tiled lyrics have no room
    // to move except the last one, which can slide right into the gap before
    // the end of the video.
    const last = lyricBlocks.last();
    const before = await last.getAttribute('aria-valuetext');
    await last.focus();
    await page.keyboard.press('ArrowRight');
    await expect(last).not.toHaveAttribute('aria-valuetext', before ?? '');

    // Autosave goes to the mock, not production, and carries the new start.
    await expect.poll(() => patches.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const moved = JSON.parse(patches[patches.length - 1]).edits.blocks.find(
      (b: { id: string }) => b.id === lyrics[2].id
    );
    expect(moved.startSec).toBeCloseTo(lyrics[2].startSec + 0.1, 2);

    // No sideways scroll on a phone.
    await page.setViewportSize({ width: 390, height: 800 });
    const overflowNow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await expect.poll(overflowNow, { timeout: 5_000 }).toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'test-results/video-text-editor-390.png', fullPage: true });

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
    testInfo.annotations.push({ type: 'patches', description: String(patches.length) });
  });
});
