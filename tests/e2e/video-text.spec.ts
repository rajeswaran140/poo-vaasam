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
    // The timeline re-measures after a resize (ResizeObserver): wait for it to settle.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 5_000 })
      .toBeLessThanOrEqual(0);

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

  /** Mocks every video-text API call and the clip; records PATCH bodies. */
  async function mockEditor(page: Page) {
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
      // The saved logo: none, unless a test layers its own route on top.
      if (rest === 'logo' && method === 'GET') return json(route, { logo: null });
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

    return { writes, unexpected, patches };
  }

  /** Opens the fixture project and waits for the video to be seekable. */
  async function openEditor(page: Page) {
    await page.goto('/admin/video-text');
    await page.locator('ul li button').first().click();
    await expect(page.getByRole('button', { name: /All projects/ })).toBeVisible({ timeout: 30_000 });
    const video = page.locator('video');
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
    return { seekTo };
  }

  /** Non-transparent overlay pixels inside the box [x0,x1)×[y0,y1), as fractions of its size. */
  const opaqueIn = (page: Page, x0: number, x1: number, y0: number, y1: number) =>
    page.evaluate(
      ([a, b, c, d]) => {
        const cv = document.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement | null;
        const ctx = cv?.getContext('2d');
        if (!cv || !ctx || !cv.width || !cv.height) return 0;
        const px = Math.floor(cv.width * a);
        const py = Math.floor(cv.height * c);
        const w = Math.max(1, Math.floor(cv.width * b) - px);
        const h = Math.max(1, Math.floor(cv.height * d) - py);
        const data = ctx.getImageData(px, py, w, h).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
        return n;
      },
      [x0, x1, y0, y1]
    );

  test('renders the tracks, draws the title, nudges a block, and never calls the real API', async ({ page }, testInfo) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');

    const { writes, unexpected, patches } = await mockEditor(page);

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

  test('title position moves the drawn title; the title block drags and takes typed times', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    const { seekTo } = await openEditor(page);
    await seekTo(1); // only the title (0-5 s) is on screen

    // Default: centred, so the middle band has the title and the top-left corner is empty.
    await expect.poll(() => opaqueIn(page, 0.3, 0.7, 0.4, 0.6), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await opaqueIn(page, 0, 0.5, 0, 0.25)).toBe(0);

    // Top left: the title moves into the top-left quarter and leaves the middle and the right.
    const titleGrid = page.getByRole('radiogroup', { name: 'Title position' });
    await titleGrid.getByRole('radio', { name: 'Top left' }).click();
    await expect(titleGrid.getByRole('radio', { name: 'Top left' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => opaqueIn(page, 0, 0.5, 0, 0.25), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => opaqueIn(page, 0, 1, 0.4, 0.6), { timeout: 15_000 }).toBe(0);
    expect(await opaqueIn(page, 0.75, 1, 0, 1)).toBe(0);
    await page.screenshot({ path: 'test-results/video-text-title-top-left.png', fullPage: true });

    // The saved style carries the placement.
    await expect
      .poll(() => patches.some((b) => JSON.parse(b).edits.style.titlePlace?.v === 'top'), { timeout: 15_000 })
      .toBe(true);

    // Drag the title block's body to the right with the mouse.
    const title = page.getByRole('slider', { name: /^Title: / });
    // Bring the timeline to the middle of the screen, clear of the sticky header.
    await title.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = (await title.boundingBox())!;
    const pxPerSec = box.width / 5;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 3 * pxPerSec, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    // The block re-renders after the pointer events: wait for it.
    await expect.poll(async () => Number(await title.getAttribute('aria-valuenow')), { timeout: 5_000 }).toBeGreaterThan(2.5);
    expect(Number(await title.getAttribute('aria-valuenow'))).toBeLessThan(3.5);

    // Typed times: clicking selected it, so the Start box is there.
    const times = page.getByRole('group', { name: 'Times for Title' });
    await expect(times).toBeVisible();
    await times.getByLabel('Start').fill('0:01.5');
    await times.getByLabel('Start').press('Enter');
    await expect(title).toHaveAttribute('aria-valuenow', '1.5');
    await times.getByLabel('End').fill('0:04');
    await times.getByLabel('End').press('Enter');
    await expect(title).toHaveAttribute('aria-valuetext', '0:01.5 to 0:04.0');
    await expect
      .poll(() => {
        const last = patches.at(-1);
        return last ? JSON.parse(last).edits.blocks.find((b: { id: string }) => b.id === 'title') : null;
      }, { timeout: 15_000 })
      .toMatchObject({ startSec: 1.5, endSec: 4 });

    // Whole video: the title stays on from start to end, and that is what's saved.
    await times.getByRole('button', { name: 'Whole video' }).click();
    await expect(title).toHaveAttribute('aria-valuetext', `0:00.0 to 0:${DURATION}.0`);
    await expect
      .poll(() => {
        const last = patches.at(-1);
        return last ? JSON.parse(last).edits.blocks.find((b: { id: string }) => b.id === 'title') : null;
      }, { timeout: 15_000 })
      .toMatchObject({ startSec: 0, endSec: DURATION });
    // Mid-song the title is still drawn (top left), alongside the lyric.
    await seekTo(DURATION / 2);
    await expect.poll(() => opaqueIn(page, 0, 0.5, 0, 0.25), { timeout: 15_000 }).toBeGreaterThan(0);

    // Still no sideways scroll on a phone with the new controls.
    await page.setViewportSize({ width: 390, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 5_000 })
      .toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'test-results/video-text-position-390.png', fullPage: true });

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('each part takes its own size and fonts; the chosen fonts really load and change the drawing', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    const fontFiles: string[] = [];
    page.on('response', (r) => {
      if (/\.woff2(\?|$)/.test(r.url())) fontFiles.push(`${r.status()} ${r.url().split('/').pop()}`);
    });
    const { seekTo } = await openEditor(page);
    await seekTo(1); // the title is on screen

    /** A cheap fingerprint of the drawn overlay: opaque pixel count over the whole frame. */
    const inked = () => opaqueIn(page, 0, 1, 0, 1);
    await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(0);
    const plain = await inked();

    const title = page.getByRole('group', { name: 'Title' });
    await title.getByLabel('Tamil font').selectOption('arima');
    await expect.poll(inked, { timeout: 15_000 }).not.toBe(plain);
    const arima = await inked();

    // The Arima face really loaded (not a fallback), from this site.
    const loaded = await page.evaluate(() => {
      const wrap = document.querySelector('[data-vt-fonts]')!;
      const fam = getComputedStyle(wrap).getPropertyValue('--vt-arima').trim();
      // The real face (first name); the list's Arial-based fallback errors on Linux.
      return { fam, ok: document.fonts.check(`700 32px ${fam.split(',')[0]}`, 'அ') };
    });
    expect(loaded.fam).not.toBe('');
    expect(loaded.ok).toBe(true);

    // Bigger: more ink.
    await title.getByLabel('Size', { exact: true }).fill('13.5'); // 1.8 × the title's normal 7.5%
    await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(arima);

    // English font for the credits; the sample shows it.
    const credits = page.getByRole('group', { name: 'Credits' });
    await credits.getByLabel('English font').selectOption('playfair-display');
    await expect(page.getByTestId('sample-Credits')).toHaveCSS('font-family', /playfair|__/i);

    await expect
      .poll(() => {
        const last = patches.at(-1);
        return last ? JSON.parse(last).edits.style.tracks : null;
      }, { timeout: 15_000 })
      .toMatchObject({ title: { tamilFont: 'arima', heightPct: 13.5 }, credits: { englishFont: 'playfair-display' } });

    expect(fontFiles.filter((f) => !f.startsWith('200')), 'font files that failed').toEqual([]);
    expect(fontFiles.some((f) => /arima/i.test(f) || f.startsWith('200')), 'a font file was fetched').toBe(true);
    await page.screenshot({ path: 'test-results/video-text-fonts.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 5_000 })
      .toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'test-results/video-text-fonts-390.png', fullPage: true });

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('Google fonts: a Tamil and an English Google font really load from Google, under the site CSP, and change the drawing', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    const cspErrors: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text());
    });
    const googleFiles: string[] = [];
    page.on('response', (r) => {
      if (/fonts\.(gstatic|googleapis)\.com/.test(r.url())) googleFiles.push(`${r.status()} ${new URL(r.url()).hostname}`);
    });
    const { seekTo } = await openEditor(page);
    await seekTo(1);
    const inked = () => opaqueIn(page, 0, 1, 0, 1);
    await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(0);
    const before = await inked();

    const title = page.getByRole('group', { name: 'Title' });
    await title.getByLabel('Tamil font').selectOption('g:Pavanam');
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('400 32px "vt-g-tamil-pavanam"', 'அ') && [...document.fonts].some((f) => f.family === 'vt-g-tamil-pavanam' && f.status === 'loaded')), { timeout: 20_000 })
      .toBe(true);
    await expect.poll(inked, { timeout: 15_000 }).not.toBe(before);

    const credits = page.getByRole('group', { name: 'Credits' });
    await credits.getByRole('button', { name: 'More fonts…' }).click();
    await credits.getByLabel('Search Google fonts').fill('Lobster');
    await credits.getByRole('button', { name: 'Lobster', exact: true }).click();
    await expect(credits.getByLabel('English font')).toHaveValue('g:Lobster');
    await expect(page.getByTestId('sample-Credits')).toHaveCSS('font-family', /vt-g-latin-lobster/);
    await expect
      .poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family === 'vt-g-latin-lobster' && f.status === 'loaded')), { timeout: 20_000 })
      .toBe(true);

    await expect
      .poll(() => {
        const last = patches.at(-1);
        return last ? JSON.parse(last).edits.style.tracks : null;
      }, { timeout: 15_000 })
      .toMatchObject({ title: { tamilFont: 'g:Pavanam' }, credits: { englishFont: 'g:Lobster' } });

    expect(cspErrors, 'CSP refusals').toEqual([]);
    expect(googleFiles.filter((f) => !f.startsWith('200')), 'Google requests that failed').toEqual([]);
    expect(googleFiles.some((f) => f.endsWith('fonts.gstatic.com'))).toBe(true);
    await page.screenshot({ path: 'test-results/video-text-google-fonts.png', fullPage: true });
    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('Make video: the browser loads the chosen fonts, draws every text image as a real PNG, uploads and finishes', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected } = await mockEditor(page);
    // Layered on top of mockEditor's routes (later routes win; fallback() hands back).
    let renderId: string | null = null;
    const pngs: { size: number; width: number; height: number }[] = [];
    await page.route('https://tamil-web-media.s3.amazonaws.com/e2e-mock-upload/**', async (route) => {
      const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
      const at = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      if (at >= 0) pngs.push({ size: body.length, width: body.readUInt32BE(at + 16), height: body.readUInt32BE(at + 20) });
      // Cross-origin, like S3: the browser needs the CORS header to see the 204.
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.route('**/api/admin/video-text/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (path.endsWith('/overlays') && req.method() === 'POST') {
        const sent = JSON.parse(req.postData() ?? '{}');
        renderId = sent.renderId;
        return json({ uploads: sent.blockIds.map((blockId: string) => ({ blockId, url: 'https://tamil-web-media.s3.amazonaws.com/e2e-mock-upload/png', fields: { key: `k/${blockId}.png` }, key: `k/${blockId}.png` })) });
      }
      if (path.endsWith('/render') && req.method() === 'POST') return json({ status: 'queued' }, 202);
      if (path.endsWith(`/${ID}`) && req.method() === 'GET' && renderId) {
        return json({ project: { ...project(), render: { renderId, status: 'done', progress: null, outputKey: 'k/out.mp4', outputExpiresAt: new Date(Date.now() + 864e5).toISOString(), error: null, startedAt: new Date().toISOString(), updatedAt: new Date(Date.now() + 1000).toISOString() } } });
      }
      return route.fallback();
    });

    await openEditor(page);
    // A non-default font on two parts, so the font check covers the new faces too.
    await page.getByRole('group', { name: 'Title' }).getByLabel('Tamil font').selectOption('arima');
    await page.getByRole('group', { name: 'Credits' }).getByLabel('English font').selectOption('playfair-display');

    await page.getByRole('button', { name: 'Make video' }).click();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('make-video')).not.toContainText('did not load');

    // Title + 3 lyric lines + credits, each a PNG at the video's exact size.
    expect(pngs).toHaveLength(5);
    for (const p of pngs) expect([p.width, p.height]).toEqual([1280, 720]);

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('logo: the saved logo shows in its corner when ticked, moves by keys, and a corner puts it back', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    // A 1×1 solid red PNG stands in for the logo, served cross-origin like S3.
    const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const LOGO_URL = 'https://tamil-web-media.s3.amazonaws.com/e2e-mock-logo/logo.png';
    await page.route(LOGO_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: RED }));
    await page.route('**/api/admin/video-text/logo', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logo: { key: 'audio/mastering/video-text-logo/1_a.png', contentType: 'image/png', width: 1, height: 1, uploadedAt: new Date().toISOString(), url: LOGO_URL } }) })
        : route.fallback());
    const { seekTo } = await openEditor(page);
    await seekTo(30); // no text showing, so any pixel drawn is the logo

    const panel = page.getByTestId('logo-panel');
    await expect(panel.getByTestId('logo-thumb')).toBeVisible();
    expect(await opaqueIn(page, 0.8, 0.95, 0.8, 0.95)).toBe(0);
    await panel.getByLabel('Show the logo on this video').check();
    // Bottom right by default, 10% of the height: inside the 5% margin.
    await expect.poll(() => opaqueIn(page, 0.85, 0.95, 0.85, 0.95)).toBeGreaterThan(0);
    expect(await opaqueIn(page, 0.05, 0.15, 0.05, 0.15)).toBe(0);

    await page.getByLabel('Move text by dragging it on the picture').check();
    await page.getByTestId('move-logo').focus();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(panel.getByLabel("Logo: move down, % of the video's height")).toHaveValue('-5');

    await panel.getByRole('radio', { name: 'Top left' }).click();
    await expect.poll(() => opaqueIn(page, 0.05, 0.15, 0.05, 0.15)).toBeGreaterThan(0);
    expect(await opaqueIn(page, 0.85, 0.95, 0.85, 0.95)).toBe(0);
    await expect(panel.getByRole('button', { name: 'Reset to corner' })).toHaveCount(0);

    await expect.poll(() => patches.some((b) => JSON.parse(b).edits?.style?.logo?.corner === 'top-left'), { timeout: 15_000 }).toBe(true);
    const last = JSON.parse(patches[patches.length - 1]).edits.style.logo;
    expect(last).toMatchObject({ show: true, corner: 'top-left', offset: { x: 0, y: 0 } });
    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('tap to time while the song plays; fade, box and colour show in the preview', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    const { seekTo } = await openEditor(page);
    const video = page.locator('video');
    const sliders = page.getByRole('slider', { name: /^Lyric \d: / });

    // ---- Tap to time: start at 6 s, tap three lines and the end, while it plays.
    await seekTo(6);
    await page.getByRole('button', { name: 'Tap to time lyrics' }).click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    // Wait frame by frame (not expect.poll's growing intervals) so the tap lands on time.
    const tapAt = async (sec: number) => {
      await page.waitForFunction((t) => (document.querySelector('video') as HTMLVideoElement).currentTime >= t, sec, { polling: 'raf', timeout: 15_000 });
      await page.keyboard.press('Space');
    };
    await tapAt(7);
    await tapAt(8.5);
    await tapAt(10);
    await expect(page.getByRole('button', { name: 'Tap: last line ends' })).toBeVisible();
    await tapAt(11.5);
    await expect(page.getByRole('status').filter({ hasText: 'All lines timed' })).toBeVisible();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    // Each line starts within a moment of its tap, and they run back to back.
    const starts = await sliders.evaluateAll((els) => els.map((e) => Number(e.getAttribute('aria-valuenow'))));
    expect(starts[0]).toBeGreaterThanOrEqual(7);
    expect(starts[0]).toBeLessThan(7.6);
    expect(starts[1]).toBeGreaterThanOrEqual(8.5);
    expect(starts[2]).toBeGreaterThanOrEqual(10);
    await expect
      .poll(() => {
        const last = patches.at(-1);
        return last ? JSON.parse(last).edits.blocks.filter((b: { track: string }) => b.track === 'lyric').map((b: { startSec: number }) => b.startSec) : [];
      }, { timeout: 15_000 })
      .toEqual(starts);

    // ---- Fade: mid-fade the lyric is fainter than once fully in.
    const lyrics = page.getByRole('group', { name: 'Lyrics' });
    await lyrics.getByLabel('Fade in and out').check();
    /** Strongest alpha in the lower third of the overlay. */
    const peakAlpha = () =>
      page.evaluate(() => {
        const cv = document.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement;
        const ctx = cv.getContext('2d')!;
        const d = ctx.getImageData(0, Math.floor(cv.height * 0.66), cv.width, Math.floor(cv.height * 0.34)).data;
        let m = 0;
        for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]);
        return m;
      });
    await seekTo(starts[0] + 0.8); // fully in
    await expect.poll(peakAlpha, { timeout: 10_000 }).toBeGreaterThan(200);
    const full = await peakAlpha();
    await seekTo(starts[0] + 0.1); // a third of the way into the fade (the redraw follows the seek)
    // The block fades AS ONE image (like the render's ffmpeg fade): a third of
    // the way in, the most opaque pixel is about a third of full.
    await expect.poll(peakAlpha, { timeout: 10_000 }).toBeLessThan(full * 0.5);
    const mid = await peakAlpha();
    expect(mid).toBeGreaterThan(full * 0.2);
    expect(mid).toBeLessThan(full * 0.47);

    // ---- Box: a dark, mostly opaque area appears behind the lyric.
    const darkBoxPixels = () =>
      page.evaluate(() => {
        const cv = document.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, Math.floor(cv.height * 0.66), cv.width, Math.floor(cv.height * 0.34)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] < 30 && d[i + 1] < 30 && d[i + 2] < 30) n++;
        return n;
      });
    await seekTo(starts[0] + 0.8); // fully faded in, so the box is at its full 50%
    await expect.poll(peakAlpha, { timeout: 10_000 }).toBeGreaterThan(200);
    const before = await darkBoxPixels();
    await lyrics.getByLabel('Box behind text').check();
    await expect.poll(darkBoxPixels, { timeout: 10_000 }).toBeGreaterThan(before + 1000);

    // ---- Colour: yellow lyric text.
    await lyrics.getByRole('radiogroup', { name: 'Lyrics colour' }).getByRole('radio', { name: 'Yellow' }).click();
    const yellowish = () =>
      page.evaluate(() => {
        const cv = document.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, Math.floor(cv.height * 0.66), cv.width, Math.floor(cv.height * 0.34)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 140) n++;
        return n;
      });
    await expect.poll(yellowish, { timeout: 10_000 }).toBeGreaterThan(50);
    await page.screenshot({ path: 'test-results/video-text-tap-fade-box.png', fullPage: true });

    await expect
      .poll(() => {
        const last = patches.at(-1);
        return last ? JSON.parse(last).edits.style.tracks?.lyric : null;
      }, { timeout: 15_000 })
      .toEqual({ fade: true, box: true, color: 'yellow' });

    await page.setViewportSize({ width: 390, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 5_000 })
      .toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'test-results/video-text-tap-390.png', fullPage: true });

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('In and Out: I while the song plays, O after a seek; shaded, saved, Shift+I goes back, Clear removes them', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    const { seekTo } = await openEditor(page);
    const video = page.locator('video');
    const summary = page.getByTestId('cut-summary');
    await expect(summary).toHaveText(/exports the whole video/);
    const lastCut = () => {
      const last = patches.at(-1);
      return last ? JSON.parse(last).edits.cut : 'none';
    };

    // I typed into the lyrics is text, not a mark.
    const lyricsBox = page.getByLabel('Lyrics', { exact: true });
    await lyricsBox.focus();
    await page.keyboard.press('i');
    await expect(summary).toHaveText(/exports the whole video/);
    await lyricsBox.press('Backspace');
    await lyricsBox.blur();

    // Mark In while playing: the mark is the video's own time at the press, on a frame.
    await seekTo(4);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement).currentTime >= 5, null, { polling: 'raf', timeout: 15_000 });
    await page.keyboard.press('i');
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    await expect(summary).toHaveText(/exports 0:0[5-6]\.\d\d to 0:40\.00/);
    await seekTo(20);
    await page.keyboard.press('o');
    await expect(summary).toHaveText(/to 0:20\.00 \(/);
    await expect(page.getByTestId('cut-shade-in')).toBeVisible();
    await expect(page.getByTestId('cut-shade-out')).toBeVisible();
    await expect.poll(lastCut, { timeout: 15_000 }).toMatchObject({ outSec: 20 });
    const saved = lastCut() as { inSec: number; outSec: number };
    expect(saved.inSec).toBeGreaterThanOrEqual(5);
    expect(saved.inSec).toBeLessThan(6.5);
    expect(Math.abs(saved.inSec * 25 - Math.round(saved.inSec * 25))).toBeLessThan(0.03);

    // Shift+I goes to In.
    await page.keyboard.press('Shift+I');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(saved.inSec, 1);

    // Clear: whole video again, saved as no cut.
    await page.getByRole('button', { name: 'Clear In and Out' }).click();
    await expect(summary).toHaveText(/exports the whole video/);
    await expect(page.getByTestId('cut-shade-in')).toHaveCount(0);
    await expect.poll(lastCut, { timeout: 15_000 }).toBeNull();

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });

  test('size 1-100% of the height, and moving the title by dragging it on the picture; an alignment puts it back', async ({ page }) => {
    test.skip(Boolean(ffmpegMissing), ffmpegMissing || 'ffmpeg missing');
    const { writes, unexpected, patches } = await mockEditor(page);
    const { seekTo } = await openEditor(page);
    await seekTo(1); // only the title (0-5 s) is on screen
    await expect.poll(() => opaqueIn(page, 0.3, 0.7, 0.4, 0.6), { timeout: 15_000 }).toBeGreaterThan(0);
    const lastTitle = () => {
      const last = patches.at(-1);
      return last ? JSON.parse(last).edits.style.tracks?.title ?? {} : {};
    };

    // Size: 30% of the height makes the centred title much taller than at 7.5%.
    const title = page.getByRole('group', { name: 'Title', exact: true });
    const tallRows = () =>
      page.evaluate(() => {
        const cv = document.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        let rows = 0;
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 0) { rows++; break; }
        }
        return rows / cv.height;
      });
    const before = await tallRows();
    const sizeBox = title.getByLabel("Title size, % of the video's height");
    await sizeBox.fill('30');
    await sizeBox.press('Enter');
    await expect.poll(tallRows, { timeout: 15_000 }).toBeGreaterThan(before * 2.5);
    await expect.poll(() => lastTitle().heightPct, { timeout: 15_000 }).toBe(30);
    await sizeBox.fill('7.5');
    await sizeBox.press('Enter');

    // Move by dragging on the picture: switch on, drag the title box up and left.
    await page.getByLabel('Move text by dragging it on the picture').check();
    const handle = page.getByTestId('move-title');
    await expect(handle).toBeVisible();
    // The mouse can only drag what is on screen: ticking the switch may leave the picture scrolled off.
    await handle.scrollIntoViewIfNeeded();
    const pic = (await page.locator('video').boundingBox())!;
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 - pic.width * 0.3, hb.y + hb.height / 2 - pic.height * 0.3, { steps: 6 });
    await page.mouse.up();
    // The title has left the middle band and sits in the top-left area.
    await expect.poll(() => opaqueIn(page, 0, 1, 0.4, 0.6), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => opaqueIn(page, 0, 0.5, 0, 0.35), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => lastTitle().offset?.x ?? 0, { timeout: 15_000 }).toBeLessThan(-0.25);
    const moved = lastTitle().offset;
    expect(moved.x).toBeGreaterThan(-0.35);
    expect(moved.y).toBeLessThan(-0.25);
    expect(moved.y).toBeGreaterThan(-0.35);
    // The move fields show it, in % of the frame.
    expect(Number(await title.getByLabel("Title: move right, % of the video's width").inputValue())).toBeCloseTo(moved.x * 100, 0);
    await page.screenshot({ path: 'test-results/video-text-move-title.png', fullPage: true });

    // Picking Centre puts it exactly back: middle band again, offset cleared.
    await page.getByRole('radiogroup', { name: 'Title position' }).getByRole('radio', { name: 'Centre', exact: true }).click();
    await expect.poll(() => opaqueIn(page, 0.3, 0.7, 0.4, 0.6), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => lastTitle().offset, { timeout: 15_000 }).toEqual({ x: 0, y: 0 });
    await expect(title.getByRole('button', { name: 'Reset to aligned' })).toHaveCount(0);

    expect(writes, 'non-GET /api/ requests the mocks did not fulfil').toEqual([]);
    expect(unexpected, 'requests to the video-text API that the test did not mock').toEqual([]);
  });
});
