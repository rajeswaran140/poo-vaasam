# Portal Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish a Tamilagaval song release in the admin portal — master, render, encode, upload to YouTube — leaving only the two steps the Data API cannot perform.

**Architecture:** The Next.js route validates and enqueues; all long work runs in the existing `tamilagaval-master-worker` Lambda (900 s), which already holds the ffmpeg layer, the bucket access, and now the YouTube write token read from SSM. Pure planners in `src/lib/` decide what is legal and what arguments to use, so the route and the worker can never disagree; the worker only executes.

**Tech Stack:** Next.js 15.5 App Router, TypeScript 5.9, AWS Lambda (nodejs20), DynamoDB single table `TamilWebContent`, S3 `tamil-web-media`, ffmpeg, YouTube Data API v3, **jest** (not vitest).

**Spec:** `docs/superpowers/specs/2026-09-15-portal-release-pipeline-design.md`

## Global Constraints

- **jest, not vitest.** Never pipe a test run to `tail` — it swallows the exit code. Redirect to a file and `echo $?`.
- **`buildVideoArgs` must never contain `-filter_complex`.** Its absence is what keeps the render inside the 900 s Lambda timeout. A test pins this; do not weaken it.
- **Keep `VIDEO_FPS = 10`.** Measured: 2.6x faster for a file 24% smaller. Frame count is the cost, not file size.
- **The render reads `job.masterKey`, never `job.mp3Key`.** Feeding the 192k web MP3 into an upload stacks a lossy generation in front of YouTube's own.
- **Audio settings are not tunable:** `-c:a aac -b:a 384k -ar 48000`. This is the Premiere fix.
- **The `force-ssl` YouTube token never enters the Next.js app.** Only the worker reads it, from SSM at `/amplify/d3rkmepk4popv0/master/`.
- **The worker must never call `videos.insert` when `job.youtubeVideoId` is set.**
- **Uploads are always `privacyStatus: 'private'`.** The portal never publishes.
- Every admin route: `await requireAdmin(request)` then `requireBearer(request)`.
- Region `ca-central-1`; Lambda `tamilagaval-master-worker`; Amplify app `d3rkmepk4popv0`, branch `master`.
- Branch off `master` (the repo's default). Never commit to `master` directly.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/master-video.ts` (modify) | Pure render planner + ffmpeg args. Gains cover-aspect awareness and a quality target. |
| `worker/master-worker.ts` (modify) | Probes the cover, runs ffmpeg, and gains the `uploadToYoutube()` branch. |
| `src/lib/release-checklist.ts` (modify) | Air-time density comparison; `notChecked` findings. |
| `src/app/api/admin/youtube/release-check/route.ts` (modify) | Supplies the three snapshot fields it currently omits. |
| `src/lib/youtube-description.ts` (modify) | Gains `buildUploadDescription` — the single source for upload descriptions. |
| `src/lib/youtube-upload.ts` (create) | Pure publish planner. No I/O, so it tests without credentials. |
| `src/types/masterJob.ts` (modify) | Upload state fields. |
| `src/app/api/admin/music-lab/master/[jobId]/youtube/route.ts` (create) | Validates, writes `uploadStatus`, Event-invokes, returns 202. |
| `src/components/admin/MasteringStudio.tsx` (modify) | Re-render button fix, then the publish panel. |

**Tasks 1-4 are independently shippable** and fix live defects. Tasks 5-9 build the upload on top. If the work is split across PRs, split there.

---

### Task 1: Aspect-aware render filter and a quality target

**Files:**
- Modify: `src/lib/master-video.ts`
- Test: `__tests__/lib/master-video.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildVideoFilter(height: VideoHeight, coverAspect?: number): string`; `buildComposeArgs({ coverPath, framePath, height?, coverAspect? })`; `VIDEO_CRF = 16`; `VIDEO_GOP = 100`; `FRAME_FILL_ASPECT_TOLERANCE = 0.02`.

**Context:** `buildVideoFilter` currently computes `art = Math.round(height * 0.82)` — a **square** box — regardless of the cover's shape. A 16:9 cover therefore renders at 1181x1181 inside 2560x1440: 46% of the frame, floating on a blurred copy of itself. That is the "small thumbnail" defect. Square and portrait covers genuinely need the blurred backdrop, so the fix is a branch, not a replacement.

`buildVideoArgs` specifies no `-crf`, so it runs libx264's default 23 at `veryfast` — measured at **116 kbps** of video. Measured alternative: CRF 16 with `-g 100` gives 1.01 Mbps and costs +52 s (2 m 59.9 s to 3 m 54 s on a 5:30 master).

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/master-video.test.ts`, inside the existing `describe('frame geometry', ...)`:

```ts
  it('FILLS the frame for a 16:9 cover — no backdrop, no inset', () => {
    const f = buildVideoFilter(1440, 16 / 9);
    expect(f).toContain('scale=2560:1440:force_original_aspect_ratio=increase');
    expect(f).toContain('crop=2560:1440');
    // The 46% inset bug: a square art box has no business in a 16:9 render.
    expect(f).not.toContain('boxblur');
    expect(f).not.toContain('overlay');
  });

  it('uses lanczos and a mild unsharp, which cost nothing in a one-frame pass', () => {
    const f = buildVideoFilter(1440, 16 / 9);
    expect(f).toContain('flags=lanczos');
    expect(f).toContain('unsharp=');
  });

  it('keeps the blurred backdrop for a SQUARE cover, which genuinely needs one', () => {
    const f = buildVideoFilter(1440, 1);
    expect(f).toContain('boxblur');
    expect(f).toContain('overlay');
  });

  it('keeps the blurred backdrop for a PORTRAIT cover', () => {
    expect(buildVideoFilter(1440, 0.75)).toContain('boxblur');
  });

  it('falls back to the backdrop when the aspect is unknown, rather than guessing', () => {
    // An unprobed cover must not be assumed 16:9 — cropping the operator's
    // artwork is the one outcome he has rejected outright.
    expect(buildVideoFilter(1440)).toContain('boxblur');
  });

  it('treats a near-16:9 cover as 16:9 — real artwork is rarely exact', () => {
    // 1672x941 = 1.77683 vs 1.77778. This is the real cover from 2026-09-15.
    expect(buildVideoFilter(1440, 1672 / 941)).toContain('crop=2560:1440');
    expect(buildVideoFilter(1440, 1672 / 941)).not.toContain('boxblur');
  });
```

And inside `describe('the encode settings are the whole point', ...)`:

```ts
  it('sets an explicit quality target — the default CRF 23 measured 116 kbps', () => {
    const a = buildVideoArgs({ framePath: 'f.png', audioPath: 'a.wav', outPath: 'o.mp4' });
    expect(a[a.indexOf('-crf') + 1]).toBe(String(VIDEO_CRF));
    expect(a[a.indexOf('-g') + 1]).toBe(String(VIDEO_GOP));
  });

  it('stays on veryfast — a slower preset does not fit the 900s Lambda', () => {
    const a = buildVideoArgs({ framePath: 'f.png', audioPath: 'a.wav', outPath: 'o.mp4' });
    expect(a[a.indexOf('-preset') + 1]).toBe('veryfast');
  });
```

Add `VIDEO_CRF` and `VIDEO_GOP` to the import list at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/lib/master-video.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t.log
```

Expected: FAIL — `buildVideoFilter` takes one argument, `VIDEO_CRF` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/master-video.ts`, add the constants near `VIDEO_FPS`:

```ts
/**
 * Quality target for the picture. There was none before this, so the encode ran
 * libx264's default CRF 23 at `veryfast` and produced 116 kbps of video on a
 * 2560x1440 still — visibly soft, and rejected by eye on 2026-09-15.
 *
 * Measured on the real 5:30 master: CRF 16 with a 10-second GOP gives 1.01 Mbps
 * and costs 52 seconds (2m59.9s -> 3m54s). That is affordable against 900 s.
 * `-preset veryfast` stays: a slower preset is what does NOT fit.
 */
export const VIDEO_CRF = 16;
/** Keyframe every 10 s at 10 fps. The picture never changes; these are the only expensive frames. */
export const VIDEO_GOP = 100;

/**
 * How far from 16:9 a cover may sit and still be treated as 16:9.
 * 1672x941 (the 2026-09-15 cover) is 1.77683 against 1.77778 — 0.05% out.
 */
export const FRAME_FILL_ASPECT_TOLERANCE = 0.02;
```

Replace `buildVideoFilter` entirely:

```ts
/**
 * The filter graph. TWO shapes, chosen by the cover's own aspect ratio.
 *
 * ⚠️ THIS USED TO HAVE ONE SHAPE, AND IT WAS THE BUG. `art = height * 0.82`
 * fits any cover into a SQUARE box, whatever its aspect — so a 16:9 cover
 * rendered at 1181x1181 inside 2560x1440: 46% of the frame, floating on a
 * blurred copy of itself. It was written for square art and nothing checked.
 *
 *  - 16:9 within tolerance -> FILL the frame. increase+crop loses at most a row
 *    or two. lanczos because the artwork is usually smaller than the frame, and
 *    a mild unsharp to counter that upscale. Both run ONCE, in the compose pass,
 *    so they cost 0.18 s — see buildComposeArgs.
 *  - anything else -> the original blurred backdrop, which is correct for square
 *    and portrait art and is why this code was written that way.
 *
 * An UNKNOWN aspect takes the backdrop branch deliberately. Assuming 16:9 and
 * being wrong crops the operator's artwork, which is the one outcome he has
 * rejected outright ("do not mask").
 */
export function buildVideoFilter(height: VideoHeight, coverAspect?: number): string {
  const width = videoWidthFor(height);
  const target = 16 / 9;
  const fills =
    typeof coverAspect === 'number' &&
    Number.isFinite(coverAspect) &&
    coverAspect > 0 &&
    Math.abs(coverAspect - target) / target <= FRAME_FILL_ASPECT_TOLERANCE;

  if (fills) {
    return (
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:` +
      `flags=lanczos+accurate_rnd+full_chroma_int,` +
      `crop=${width}:${height},unsharp=5:5:0.55:5:5:0.0[v]`
    );
  }

  const art = Math.round(height * 0.82);
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=24:4,eq=brightness=-0.06[bg];` +
    `[0:v]scale=${art}:${art}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`
  );
}
```

Thread the aspect through `buildComposeArgs`:

```ts
export function buildComposeArgs(params: {
  coverPath: string;
  framePath: string;
  height?: VideoHeight;
  /** width/height of the cover, probed by the worker. Undefined = unknown. */
  coverAspect?: number;
}): string[] {
  const height = params.height ?? DEFAULT_VIDEO_HEIGHT;
  return [
    '-hide_banner', '-nostats',
    '-i', params.coverPath,
    '-filter_complex', buildVideoFilter(height, params.coverAspect),
    '-map', '[v]',
    '-frames:v', '1',
    '-y', params.framePath,
  ];
}
```

In `buildVideoArgs`, add the quality target immediately after `'-tune', 'stillimage',`:

```ts
    '-crf', String(VIDEO_CRF), '-g', String(VIDEO_GOP), '-keyint_min', String(VIDEO_FPS),
```

- [ ] **Step 4: Run the tests**

```bash
npx jest __tests__/lib/master-video.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t.log
```

Expected: PASS, including the pre-existing `THE ENCODE CARRIES NO FILTER` test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/master-video.ts __tests__/lib/master-video.test.ts
git commit -m "fix(render): fill the frame for 16:9 covers, and set a quality target"
```

---

### Task 2: Probe the cover in the worker and pass its aspect through

**Files:**
- Modify: `worker/master-worker.ts` (`renderVideo`)

**Interfaces:**
- Consumes: `buildComposeArgs({ coverPath, framePath, height, coverAspect })` from Task 1.
- Produces: nothing later tasks import.

**Context:** Task 1's branch is inert until something supplies `coverAspect`. The worker already downloads the cover to `coverPath`; it must read the real dimensions rather than assume them. The worker has an existing header-reading helper — `ffmpeg -i FILE` with no output prints the header and exits non-zero by design.

- [ ] **Step 1: Add the probe helper**

In `worker/master-worker.ts`, above `renderVideo`:

```ts
/**
 * Cover dimensions, as width/height. Undefined when they cannot be read.
 *
 * Undefined is a real answer, not a failure: buildVideoFilter treats an unknown
 * aspect as "use the blurred backdrop", which never crops the artwork. Guessing
 * 16:9 and being wrong would.
 */
function probeCoverAspect(coverPath: string): number | undefined {
  try {
    // `ffmpeg -i FILE` with no output prints the header and exits non-zero by
    // design — the same trick probeSource() already uses. Deliberately NOT
    // ffprobe: the Lambda layer is pinned by FFMPEG_PATH and is not guaranteed
    // to ship ffprobe, and a missing binary here would silently disable the
    // fill-frame branch for every render.
    const r = ff(['-hide_banner', '-i', coverPath]);
    const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // e.g. "Stream #0:0: Video: png, rgb24, 1672x941 [SAR 1:1 DAR 1672:941]"
    const m = log.match(/Video:.*?\s(\d{2,5})x(\d{2,5})/);
    if (!m) return undefined;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!w || !h) return undefined;
    return w / h;
  } catch {
    return undefined;
  }
}
```

`ff()` is the worker's existing ffmpeg wrapper (line ~121: `spawnSync(FFMPEG, args, …)`) and needs no new import.

- [ ] **Step 2: Use it in `renderVideo`**

Replace the compose call:

```ts
    const coverAspect = probeCoverAspect(coverPath);
    const composed = ff(buildComposeArgs({ coverPath, framePath, height, coverAspect }));
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tsc.log
```

Expected: EXIT=0.

- [ ] **Step 4: Verify the bundle still builds**

```bash
npm run build:master-worker > /tmp/b.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b.log
```

Expected: EXIT=0. **Do not deploy** — deployment is the operator's call.

- [ ] **Step 5: Commit**

```bash
git add worker/master-worker.ts
git commit -m "fix(worker): probe the cover's aspect so a 16:9 render fills the frame"
```

---

### Task 3: The render button must not vanish after one render

**Files:**
- Modify: `src/components/admin/MasteringStudio.tsx`

**Interfaces:** none crossing tasks.

**Context:** The library-row control is gated `{m.masterKey && !m.videoKey && ( … Render video … )}`. Once a video exists the button disappears, so a bad render can never be redone from the UI — which is how a 46%-inset video survived. `videoKeyFor` is deterministic, so a re-render overwrites the same key.

- [ ] **Step 1: Change the gate and the label**

Find the block gated on `m.masterKey && !m.videoKey` and change the condition to `m.masterKey` alone, with the label reflecting state:

```tsx
{m.masterKey && (
  <button
    type="button"
    onClick={() => openRenderFor(m)}
    className={/* keep the existing classes */ ''}
  >
    {m.videoKey ? 'Re-render' : 'Render video'}
  </button>
)}
```

Keep every other attribute (`onClick` handler name, class names, `disabled` logic) exactly as it is — only the condition and the label text change.

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"
npx next lint --file src/components/admin/MasteringStudio.tsx > /tmp/l.log 2>&1; echo "LINT=$?"; tail -5 /tmp/l.log
```

Expected: both 0.

- [ ] **Step 3: Run the component's tests**

```bash
npx jest MasteringStudio > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/MasteringStudio.tsx
git commit -m "fix(mastering): let a bad video render be redone"
```

---

### Task 4: Make the preflight checks real

**Files:**
- Modify: `src/lib/release-checklist.ts`
- Modify: `src/app/api/admin/youtube/release-check/route.ts`
- Test: `__tests__/lib/release-checklist.test.ts`

**Interfaces:**
- Produces: `VideoSnapshot.siblingReleases` entries gain an optional `scheduledStartTime`; `Finding.severity` gains `'not-checked'`.

**Context — three defects, all live:**

1. `premiere-window` and `release-density` need `uploadedAt`, `scheduledStartTime` and `siblingReleases`. The in-app route supplies **none** of them, so both silently skip and the portal shows a pass. `scripts/tamilagaval-release-preflight.ts` (lines ~86-96) supplies all three and is the reference.
2. `release-density` compares the new video's **air** time (`scheduledStartTime`) against siblings' `publishedAt`, which comes from the uploads playlist's `videoPublishedAt` — **upload** time. Two premieres airing 24 h apart but uploaded a week apart do not register. This is why nothing flagged the 2026-09-16 collision.
3. A check whose inputs are missing renders identically to one that passed. Under "warn but allow" that launders a known gap as a green tick.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/release-checklist.test.ts`:

```ts
describe('release-density compares air time to air time', () => {
  const base = (over: Partial<VideoSnapshot>): VideoSnapshot => ({
    videoId: 'NEW', title: 't', description: 'd', tags: ['a'], categoryId: '10',
    hasCustomThumbnail: true, isShort: false, playlistIds: [], captionTracks: [],
    ...over,
  });

  it('flags two premieres airing 24h apart even when uploaded a week apart', () => {
    const f = checkRelease(base({
      scheduledStartTime: '2026-09-17T11:45:00Z',
      siblingReleases: [{
        videoId: 'OTHER',
        publishedAt: '2026-09-10T00:00:00Z',        // uploaded a week earlier
        scheduledStartTime: '2026-09-16T11:45:00Z', // but AIRS 24h before
      }],
    }));
    expect(f.find((x) => x.id === 'release-density')).toBeTruthy();
  });

  it('does NOT flag a sibling uploaded nearby but airing weeks later', () => {
    const f = checkRelease(base({
      scheduledStartTime: '2026-09-17T11:45:00Z',
      siblingReleases: [{
        videoId: 'OTHER',
        publishedAt: '2026-09-17T09:00:00Z',        // uploaded 3h before
        scheduledStartTime: '2026-10-05T11:45:00Z', // airs 18 days later
      }],
    }));
    expect(f.find((x) => x.id === 'release-density')).toBeUndefined();
  });

  it('falls back to publishedAt for an already-aired sibling', () => {
    const f = checkRelease(base({
      scheduledStartTime: '2026-09-17T11:45:00Z',
      siblingReleases: [{ videoId: 'OTHER', publishedAt: '2026-09-17T00:00:00Z' }],
    }));
    expect(f.find((x) => x.id === 'release-density')).toBeTruthy();
  });
});

describe('a check that could not run says so, rather than passing', () => {
  it('reports release-density as not-checked when siblings are absent', () => {
    const f = checkRelease({
      videoId: 'NEW', title: 't', description: 'd', tags: ['a'], categoryId: '10',
      hasCustomThumbnail: true, isShort: false, playlistIds: [], captionTracks: [],
      scheduledStartTime: '2026-09-17T11:45:00Z',
    });
    const d = f.find((x) => x.id === 'release-density');
    expect(d?.severity).toBe('not-checked');
  });

  it('reports premiere-window as not-checked when uploadedAt is absent', () => {
    const f = checkRelease({
      videoId: 'NEW', title: 't', description: 'd', tags: ['a'], categoryId: '10',
      hasCustomThumbnail: true, isShort: false, playlistIds: [], captionTracks: [],
      isUpcoming: true, scheduledStartTime: '2026-09-17T11:45:00Z',
    });
    expect(f.find((x) => x.id === 'premiere-window')?.severity).toBe('not-checked');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest __tests__/lib/release-checklist.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t.log
```

Expected: FAIL — `'not-checked'` is not a `Severity`, and siblings carry no `scheduledStartTime`.

- [ ] **Step 3: Implement**

In `src/lib/release-checklist.ts`:

```ts
export type Severity = 'blocker' | 'gap' | 'note' | 'not-checked';
```

Widen the sibling shape:

```ts
  /**
   * Other releases on the channel, for the notification-density check.
   *
   * `publishedAt` is the uploads feed's `videoPublishedAt` — UPLOAD time.
   * `scheduledStartTime` is when an unaired premiere will AIR. Density is about
   * when subscribers are notified, so air time is the right clock; upload time
   * is only the fallback for a video that has already aired.
   */
  siblingReleases?: Array<{ videoId: string; publishedAt: string; scheduledStartTime?: string }>;
```

Replace the density block:

```ts
  if (v.scheduledStartTime && v.siblingReleases && v.siblingReleases.length > 0) {
    const at = Date.parse(v.scheduledStartTime);
    // ⚠️ AIR TIME, NOT UPLOAD TIME. This compared `publishedAt` (upload) against
    // `at` (air) until 2026-09-15, so two premieres airing 24h apart but
    // uploaded a week apart did not register — which is exactly what happened
    // on 2026-09-16 and why nothing flagged it.
    const near = v.siblingReleases.filter((r) => {
      if (r.videoId === v.videoId) return false;
      const when = Date.parse(r.scheduledStartTime ?? r.publishedAt);
      if (!Number.isFinite(when)) return false;
      return Math.abs(when - at) / 3_600_000 <= RELEASE_DENSITY_WINDOW_HOURS;
    });
    if (near.length > 0) {
      f.push({
        id: 'release-density',
        severity: 'gap',
        title: `${near.length} other release${near.length > 1 ? 's' : ''} within ${RELEASE_DENSITY_WINDOW_HOURS}h`,
        detail:
          `${near.map((r) => r.videoId).join(', ')}. YouTube rate-limits how often it notifies a ` +
          `channel's subscribers, and this channel runs on subscriber traffic — wPxNf0VKUKQ took 75% of ` +
          `its first-day views from that source. Releases stacked this closely split one notification ` +
          `budget between them.`,
      });
    }
  } else {
    f.push({
      id: 'release-density',
      severity: 'not-checked',
      title: 'Release density not checked',
      detail:
        'Needs the premiere time and the channel’s other releases. Without both this says nothing — ' +
        'which is not the same as saying the schedule is clear.',
    });
  }
```

And give `premiere-window` the same treatment — keep its existing body, then add:

```ts
  } else if (v.isUpcoming) {
    f.push({
      id: 'premiere-window',
      severity: 'not-checked',
      title: 'Premiere window not checked',
      detail: 'Needs both the upload time and the scheduled premiere time.',
    });
  }
```

In `src/app/api/admin/youtube/release-check/route.ts`, fetch the uploads feed and add the three fields to the snapshot, mirroring `scripts/tamilagaval-release-preflight.ts`:

```ts
    // Uploads feed, for the density check. `videoPublishedAt` is upload time;
    // scheduledStartTime for any unaired sibling is fetched alongside so density
    // can compare air time to air time.
    // (fetch shape shown below — this route uses fetch + &key=, not a helper)
    const siblingIds = (feed.items ?? [])
      .map((it: { contentDetails?: { videoId?: string } }) => it.contentDetails?.videoId)
      .filter(Boolean) as string[];
    const schedById = new Map<string, string>();
    for (const it of siblingDetail.items ?? []) {
      const s = it?.liveStreamingDetails?.scheduledStartTime;
      if (it?.id && s && !it?.liveStreamingDetails?.actualStartTime) schedById.set(it.id, s);
    }
    const siblingReleases = (feed.items ?? [])
      .map((it: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }) => ({
        videoId: it.contentDetails?.videoId as string,
        publishedAt: it.contentDetails?.videoPublishedAt as string,
        scheduledStartTime: schedById.get(it.contentDetails?.videoId as string),
      }))
      .filter((r: { videoId?: string; publishedAt?: string }) => r.videoId && r.publishedAt);
```

Then add to the `snapshot` object literal:

```ts
      uploadedAt: snippet.publishedAt,
      scheduledStartTime: live?.scheduledStartTime,
      siblingReleases,
```

**This route has no `yt()` helper** — it calls `fetch` directly against the API with an `&key=${key}` API key (line ~106). Follow that shape for both new calls, and add `liveStreamingDetails` to the existing videos request so `live` can be bound from it:

```ts
    const vRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,liveStreamingDetails&id=${videoId}&key=${key}`
    );
    // …existing parsing…
    const live = video?.liveStreamingDetails;
```

Then the two sibling calls, same `fetch(...&key=${key})` shape:

```ts
    const feedRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=UUZCuphXleq-mXVYgvqh-OlQ&maxResults=15&key=${key}`
    );
    const feed = feedRes.ok ? await feedRes.json() : { items: [] };
```

```ts
    const detailRes = siblingIds.length
      ? await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${siblingIds.join(',')}&key=${key}`)
      : null;
    const siblingDetail = detailRes?.ok ? await detailRes.json() : { items: [] };
```

A failed sibling fetch must leave `siblingReleases` empty rather than throw — an empty list makes the density check report **not-checked**, which is the honest outcome.

- [ ] **Step 4: Run the tests**

```bash
npx jest release-checklist release-check > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"
```

Expected: both 0. If any existing test asserts an exact finding count, update it — a `not-checked` finding is now emitted where a check used to be silent.

- [ ] **Step 5: Commit**

```bash
git add src/lib/release-checklist.ts src/app/api/admin/youtube/release-check/route.ts __tests__/lib/release-checklist.test.ts
git commit -m "fix(release-check): run the premiere checks, and compare air time to air time"
```

---

### Task 5: One builder for every upload description

**Files:**
- Modify: `src/lib/youtube-description.ts`
- Test: `__tests__/lib/youtube-description.test.ts`

**Interfaces:**
- Produces: `buildUploadDescription(parts: UploadDescriptionParts): string` and `interface UploadDescriptionParts { body: string; hashtags?: string[] }`.

**Context:** Descriptions are hand-assembled today, which is why a retired name keeps reappearing on new uploads (`project_description_template_leak`). One builder in code ends that. `CREDIT_BLOCK` and `stripForbiddenCreditLines` already exist and must be reused, not re-implemented.

Playlist IDs (verified 2026-09-15): All Songs `PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs`, Latest Songs `PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU`, Love Songs `PLLsCQ9NH4rLRQMADaAhuHN_VBTHpwZ-DW`.

- [ ] **Step 1: Write the failing tests**

```ts
import { buildUploadDescription, CREDIT_BLOCK } from '@/lib/youtube-description';

describe('buildUploadDescription', () => {
  const body = 'காதல் வந்து அரும்பியதே\n\nஇரு மனங்கள்...';

  it('keeps the operator’s own text verbatim', () => {
    expect(buildUploadDescription({ body })).toContain(body.trim());
  });

  it('carries the canonical credit block, so no upload can invent its own', () => {
    const out = buildUploadDescription({ body });
    for (const line of CREDIT_BLOCK.split('\n')) expect(out).toContain(line);
  });

  it('strips a retired credit line pasted into the body', () => {
    const out = buildUploadDescription({ body: 'Lyrics: Raj (Rajeswaran Thangarajah)\n\n' + body });
    expect(out).not.toContain('Rajeswaran Thangarajah)');
  });

  it('always includes subscribe and all three playlists', () => {
    const out = buildUploadDescription({ body });
    expect(out).toContain('sub_confirmation=1');
    expect(out).toContain('PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs');
    expect(out).toContain('PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU');
    expect(out).toContain('PLLsCQ9NH4rLRQMADaAhuHN_VBTHpwZ-DW');
  });

  it('stays inside YouTube’s 5000-character limit', () => {
    expect(buildUploadDescription({ body: 'x'.repeat(4000) }).length).toBeLessThanOrEqual(5000);
  });

  it('puts hashtags last, where YouTube expects them', () => {
    const out = buildUploadDescription({ body, hashtags: ['#TamilAgaval', '#TamilLoveSong'] });
    expect(out.trimEnd().endsWith('#TamilLoveSong')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest youtube-description > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: FAIL — `buildUploadDescription` is not exported.

- [ ] **Step 3: Implement**

```ts
/** Canonical playlist links. Verified against the live channel 2026-09-15. */
export const PLAYLIST_LINKS = {
  allSongs: 'PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs',
  latestSongs: 'PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU',
  loveSongs: 'PLLsCQ9NH4rLRQMADaAhuHN_VBTHpwZ-DW',
} as const;

export interface UploadDescriptionParts {
  /** The operator's own lyric and imagery text. Kept verbatim. */
  body: string;
  hashtags?: string[];
}

const YOUTUBE_DESCRIPTION_LIMIT = 5000;

/**
 * THE only place an upload description is assembled.
 *
 * Descriptions used to be hand-built in a text editor, which is why a retired
 * credit line kept reappearing on new uploads. Sweeping the catalogue chased the
 * leak; this closes it. `stripForbiddenCreditLines` runs on the operator's text
 * so a pasted old credit cannot survive, and CREDIT_BLOCK is the only
 * attribution the output can carry — pinned by an existing drift guard.
 */
export function buildUploadDescription(parts: UploadDescriptionParts): string {
  const body = stripForbiddenCreditLines(parts.body).trim();
  const tail = [
    CREDIT_BLOCK,
    '🌐 https://tamilagaval.com/',
    '🎼 உங்கள் பாடல் வரிகளுக்கு இசை வேண்டுமா? | Need music for your lyrics?\n' +
      'https://tamilagaval.com/music-composition?utm_source=youtube&utm_medium=description',
    '🔔 Subscribe\nhttps://www.youtube.com/@Tamilagaval?sub_confirmation=1',
    `▶️ அனைத்து பாடல்கள் | All Songs:\nhttps://www.youtube.com/playlist?list=${PLAYLIST_LINKS.allSongs}`,
    `⭐ சமீபத்திய பாடல்கள் | Recent Songs:\nhttps://www.youtube.com/playlist?list=${PLAYLIST_LINKS.latestSongs}`,
    `❤️ காதல் பாடல்கள் | Tamil Love Songs:\nhttps://www.youtube.com/playlist?list=${PLAYLIST_LINKS.loveSongs}`,
  ];
  const hashtags = (parts.hashtags ?? []).join(' ').trim();
  const out = [body, ...tail, hashtags].filter(Boolean).join('\n\n');
  // Trim the OPERATOR's text if anything must go — never the credit block or
  // the playlist links, which are the parts that must not vary.
  if (out.length <= YOUTUBE_DESCRIPTION_LIMIT) return out;
  const fixed = out.length - body.length;
  const room = Math.max(0, YOUTUBE_DESCRIPTION_LIMIT - fixed);
  return [body.slice(0, room).trimEnd(), ...tail, hashtags].filter(Boolean).join('\n\n');
}
```

- [ ] **Step 4: Run the tests**

```bash
npx jest youtube-description admin-docs > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: EXIT=0, including the existing `CREDIT_BLOCK` drift guard.

- [ ] **Step 5: Commit**

```bash
git add src/lib/youtube-description.ts __tests__/lib/youtube-description.test.ts
git commit -m "feat(youtube): one builder for every upload description"
```

---

### Task 6: Upload planner and job state

**Files:**
- Create: `src/lib/youtube-upload.ts`
- Modify: `src/types/masterJob.ts`
- Test: `__tests__/lib/youtube-upload.test.ts`

**Interfaces:**
- Consumes: `MasterJob` from `@/types/masterJob`.
- Produces:
  - `type UploadStatus = 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed'`
  - `type UploadRefusal = 'no-video' | 'not-saved' | 'no-title' | 'no-description' | 'already-uploaded' | 'in-flight'`
  - `type UploadPlan = { ok: true; videoKey: string; title: string; description: string; tags: string[]; categoryId: '10'; privacyStatus: 'private'; playlistIds: string[]; coverKey: string | null } | { ok: false; reason: UploadRefusal }`
  - `planUpload(job: MasterJob, input: { title: string; description: string; tags: string[]; playlistIds: string[] }): UploadPlan`
  - `uploadRefusalMessage(reason: UploadRefusal): string`
  - `MasterJob` gains `uploadStatus`, `uploadSessionUri`, `youtubeVideoId`, `uploadError`, `uploadedToYoutubeAt`.

- [ ] **Step 1: Add the job fields**

In `src/types/masterJob.ts`, import nothing new and append to `MasterJob`:

```ts
  /**
   * YouTube upload state. All null/absent on every job written before uploading
   * existed, so every consumer must treat them as optional.
   *
   * ⚠️ `uploadStatus` and `uploadSessionUri` exist so a RETRY IS SAFE. An upload
   * that succeeds while its status write fails would otherwise be re-inserted on
   * retry, producing a second public video — exactly the mess that had to be
   * cleaned up by hand on 2026-09-15 (Pif11nJ3Gzg, m9pfr-qWcgQ). The worker
   * refuses to insert when `youtubeVideoId` is set, and resumes
   * `uploadSessionUri` rather than opening a new session.
   */
  uploadStatus: 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed' | null;
  uploadSessionUri: string | null;
  /** Written the moment videos.insert returns, BEFORE thumbnail or playlists. */
  youtubeVideoId: string | null;
  uploadedToYoutubeAt: string | null;
  uploadError: string | null;
```

- [ ] **Step 2: Write the failing tests**

Create `__tests__/lib/youtube-upload.test.ts`:

```ts
/** @jest-environment node */
import { planUpload, uploadRefusalMessage, type UploadRefusal } from '@/lib/youtube-upload';
import type { MasterJob } from '@/types/masterJob';

const job = (over: Partial<MasterJob> = {}): MasterJob => ({
  ...({} as MasterJob),
  id: 'j1',
  status: 'done',
  savedAt: '2026-09-15T00:00:00.000Z',
  masterKey: 'audio/mastering/1_a_x-master-14LUFS.wav',
  videoKey: 'audio/mastering/1_a_x-master-14LUFS-1440p.mp4',
  coverKey: 'audio/mastering/1_a_cover.png',
  uploadStatus: null,
  uploadSessionUri: null,
  youtubeVideoId: null,
  uploadedToYoutubeAt: null,
  uploadError: null,
  ...over,
});

const input = {
  title: 'காதல் வந்து அரும்பியதே',
  description: 'body text',
  tags: ['Tamil love song'],
  playlistIds: ['PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs'],
};

describe('planUpload', () => {
  it('uploads PRIVATE and in the music category — the portal never publishes', () => {
    const p = planUpload(job(), input);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.privacyStatus).toBe('private');
      expect(p.categoryId).toBe('10');
      expect(p.videoKey).toBe(job().videoKey);
    }
  });

  it('refuses a job with no rendered video', () => {
    const p = planUpload(job({ videoKey: null }), input);
    expect(p).toEqual({ ok: false, reason: 'no-video' });
  });

  it('refuses an unsaved master, whose provenance expires in 24h', () => {
    expect(planUpload(job({ savedAt: null }), input)).toEqual({ ok: false, reason: 'not-saved' });
  });

  it('REFUSES A SECOND INSERT — this is what stops duplicate public videos', () => {
    const p = planUpload(job({ youtubeVideoId: 'abc123' }), input);
    expect(p).toEqual({ ok: false, reason: 'already-uploaded' });
  });

  it('refuses while an upload is already in flight', () => {
    expect(planUpload(job({ uploadStatus: 'uploading' }), input)).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('requires a title and a description', () => {
    expect(planUpload(job(), { ...input, title: '  ' })).toEqual({ ok: false, reason: 'no-title' });
    expect(planUpload(job(), { ...input, description: '' })).toEqual({ ok: false, reason: 'no-description' });
  });

  it('every refusal has actionable wording', () => {
    const all: UploadRefusal[] = ['no-video', 'not-saved', 'no-title', 'no-description', 'already-uploaded', 'in-flight'];
    for (const r of all) expect(uploadRefusalMessage(r).length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx jest youtube-upload > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/youtube-upload.ts`**

```ts
/**
 * Deciding whether a rendered video may be uploaded, and with what.
 *
 * Pure and I/O-free, like planRender: this is the one place the rules live, so
 * the enqueue route and the worker cannot disagree about what is legal. The
 * worker re-runs it on the event it receives rather than trusting the caller.
 */
import type { MasterJob } from '@/types/masterJob';

export type UploadStatus = 'idle' | 'queued' | 'uploading' | 'uploaded' | 'failed';

export type UploadRefusal =
  | 'no-video'
  | 'not-saved'
  | 'no-title'
  | 'no-description'
  | 'already-uploaded'
  | 'in-flight';

export interface UploadInput {
  title: string;
  description: string;
  tags: string[];
  playlistIds: string[];
}

export type UploadPlan =
  | {
      ok: true;
      videoKey: string;
      title: string;
      description: string;
      tags: string[];
      categoryId: '10';
      privacyStatus: 'private';
      playlistIds: string[];
      coverKey: string | null;
    }
  | { ok: false; reason: UploadRefusal };

/** YouTube's own limits. Exceeding either is a 400 from the API. */
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 5000;

export function planUpload(job: MasterJob, input: UploadInput): UploadPlan {
  // Ordered so the most decisive refusal wins: a job that already produced a
  // video must never reach the insert path, whatever else is wrong with it.
  if (job.youtubeVideoId) return { ok: false, reason: 'already-uploaded' };
  if (job.uploadStatus === 'uploading' || job.uploadStatus === 'queued') {
    return { ok: false, reason: 'in-flight' };
  }
  if (!job.videoKey) return { ok: false, reason: 'no-video' };
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (!input.title?.trim()) return { ok: false, reason: 'no-title' };
  if (!input.description?.trim()) return { ok: false, reason: 'no-description' };

  return {
    ok: true,
    videoKey: job.videoKey,
    title: input.title.trim().slice(0, TITLE_LIMIT),
    description: input.description.trim().slice(0, DESCRIPTION_LIMIT),
    tags: input.tags.filter((t) => t.trim()).map((t) => t.trim()),
    // Never configurable. 10 = Music; the portal uploads nothing else.
    categoryId: '10',
    // Never configurable. The Data API cannot create a Premiere, so publishing
    // from here would forfeit the premiere the operator always wants.
    privacyStatus: 'private',
    playlistIds: input.playlistIds.filter(Boolean),
    coverKey: job.coverKey ?? null,
  };
}

/** Operator-facing wording. Says what to DO wherever there is something. */
export function uploadRefusalMessage(reason: UploadRefusal): string {
  switch (reason) {
    case 'no-video':
      return 'Render the video before uploading it.';
    case 'not-saved':
      return 'Save this master before uploading its video.';
    case 'no-title':
      return 'Give the upload a title.';
    case 'no-description':
      return 'Write the description before uploading.';
    case 'already-uploaded':
      return 'This master is already on YouTube. Delete that video first if you need to replace it — a video file cannot be swapped in place.';
    case 'in-flight':
      return 'An upload is already running for this master.';
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx jest youtube-upload > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"; tail -20 /tmp/tsc.log
```

Expected: both 0. `tsc` may flag other files constructing a `MasterJob` literal without the new fields — add `uploadStatus: null, uploadSessionUri: null, youtubeVideoId: null, uploadedToYoutubeAt: null, uploadError: null` to those fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/youtube-upload.ts src/types/masterJob.ts __tests__/lib/youtube-upload.test.ts
git commit -m "feat(youtube): upload planner and retry-safe job state"
```

---

### Task 7: The worker uploads

**Files:**
- Modify: `worker/master-worker.ts`

**Interfaces:**
- Consumes: `planUpload`, `UploadPlan` from Task 6; `patch()` in the worker.
- Produces: `MasterEvent` gains `youtube?: { title: string; description: string; tags: string[]; playlistIds: string[] }`.

**Context:** Branch on `youtube` **before** the mastering guards, exactly as `render` does, so an upload can never re-master. SSM reads follow `src/lib/twitch/tokens.ts`. Parameters live at `/amplify/d3rkmepk4popv0/master/YOUTUBE_OAUTH_CLIENT_SECRET` and `.../YOUTUBE_DATA_REFRESH_TOKEN`; the client id is an Amplify environment variable, so pass it to the Lambda as `YOUTUBE_OAUTH_CLIENT_ID` rather than calling the Amplify API from the worker.

- [ ] **Step 1: Add the event shape and the branch**

Extend `MasterEvent`:

```ts
  /**
   * Upload an already-rendered video to YouTube. Handled before the mastering
   * guards, like `render`, so an upload can never re-master.
   */
  youtube?: { title: string; description: string; tags: string[]; playlistIds: string[] };
```

In the handler, beside the existing `render` branch:

```ts
  if (event.youtube) return uploadToYoutube(event.jobId, event.youtube, bucket);
```

- [ ] **Step 2: Implement `uploadToYoutube`**

```ts
/**
 * Upload a rendered video to YouTube as a PRIVATE draft, then read it back.
 *
 * ⚠️ WHY THIS RUNS HERE AND NOT IN THE WEB APP. The token this needs is
 * force-ssl scoped: it can delete videos and post comments on the channel. The
 * deployed Next.js app is public-facing and holds only readonly analytics
 * scope, and it stays that way. This function is private, already reads SSM,
 * and already has the MP4 on local disk.
 *
 * ⚠️ WHY IT REFUSES TO INSERT TWICE. A video file cannot be replaced on
 * YouTube, so a duplicate insert means a second video to find and delete by
 * hand. planUpload refuses when youtubeVideoId is set; the id is written the
 * MOMENT the insert returns, before the thumbnail or the playlists, so a later
 * failure can never orphan it.
 */
async function uploadToYoutube(
  jobId: string,
  spec: NonNullable<MasterEvent['youtube']>,
  bucket: string,
) {
  const job = await getJob(jobId);
  if (!job) return { ok: false };

  const plan = planUpload(job, spec);
  if (!plan.ok) {
    await patch(jobId, { uploadStatus: 'failed', uploadError: uploadRefusalMessage(plan.reason) });
    return { ok: false };
  }

  await patch(jobId, { uploadStatus: 'uploading', uploadError: null });

  const dir = mkdtempSync(join(tmpdir(), 'ytupload-'));
  const videoPath = join(dir, 'video.mp4');
  try {
    const token = await youtubeAccessToken();

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: plan.videoKey }));
    writeFileSync(videoPath, Buffer.from(await obj.Body!.transformToByteArray()));
    const size = statSync(videoPath).size;

    // Resume an interrupted session rather than opening a new one — opening a
    // new one is how a retry becomes a duplicate video.
    let sessionUri = job.uploadSessionUri ?? null;
    if (!sessionUri) {
      const meta = {
        snippet: {
          title: plan.title,
          description: plan.description,
          tags: plan.tags,
          categoryId: plan.categoryId,
          defaultLanguage: 'ta',
          defaultAudioLanguage: 'ta',
        },
        status: {
          privacyStatus: plan.privacyStatus,
          selfDeclaredMadeForKids: false,
          license: 'youtube',
          embeddable: true,
        },
      };
      const open = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(size),
            'X-Upload-Content-Type': 'video/mp4',
          },
          body: JSON.stringify(meta),
        },
      );
      if (!open.ok) {
        await patch(jobId, { uploadStatus: 'failed', uploadError: await quotaAwareError(open) });
        return { ok: false };
      }
      sessionUri = open.headers.get('location');
      if (!sessionUri) {
        await patch(jobId, { uploadStatus: 'failed', uploadError: 'YouTube did not return an upload session.' });
        return { ok: false };
      }
      await patch(jobId, { uploadSessionUri: sessionUri });
    }

    const put = await fetch(sessionUri, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4' },
      body: readFileSync(videoPath),
    });
    if (!put.ok) {
      await patch(jobId, { uploadStatus: 'failed', uploadError: await quotaAwareError(put) });
      return { ok: false };
    }
    const inserted = await put.json();
    const videoId = inserted?.id as string | undefined;
    if (!videoId) {
      await patch(jobId, { uploadStatus: 'failed', uploadError: 'YouTube accepted the upload but returned no video id.' });
      return { ok: false };
    }

    // FIRST write after the insert, before anything else can fail.
    await patch(jobId, {
      youtubeVideoId: videoId,
      uploadedToYoutubeAt: new Date().toISOString(),
      uploadSessionUri: null,
    });

    // Thumbnail and playlists are best-effort: the video exists, and failing
    // them must not mark the upload failed or invite a re-insert.
    const problems: string[] = [];
    if (plan.coverKey) {
      try {
        const cover = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: plan.coverKey }));
        const bytes = Buffer.from(await cover.Body!.transformToByteArray());
        const t = await fetch(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: bytes },
        );
        if (!t.ok) problems.push('thumbnail');
      } catch { problems.push('thumbnail'); }
    }
    for (const playlistId of plan.playlistIds) {
      try {
        const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }),
        });
        if (!r.ok) problems.push(`playlist ${playlistId}`);
      } catch { problems.push(`playlist ${playlistId}`); }
    }

    await patch(jobId, {
      uploadStatus: 'uploaded',
      uploadError: problems.length ? `Uploaded, but these did not apply: ${problems.join(', ')}.` : null,
    });
    return { ok: true, videoId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-worker] youtube upload failed:', message);
    await patch(jobId, { uploadStatus: 'failed', uploadError: message }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 3: Add the three helpers**

```ts
/**
 * A YouTube access token with WRITE scope, from SSM SecureString.
 * Never logged, never written to disk, never returned to the caller's caller.
 */
async function youtubeAccessToken(): Promise<string> {
  const prefix = process.env.YOUTUBE_SSM_PREFIX || '/amplify/d3rkmepk4popv0/master';
  const read = async (name: string) => {
    const r = await ssm.send(new GetParameterCommand({ Name: `${prefix}/${name}`, WithDecryption: true }));
    return r.Parameter?.Value ?? '';
  };
  const [secret, refresh] = await Promise.all([
    read('YOUTUBE_OAUTH_CLIENT_SECRET'),
    read('YOUTUBE_DATA_REFRESH_TOKEN'),
  ]);
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID ?? '';
  if (!secret || !refresh || !clientId) throw new Error('YouTube credentials are not configured.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Could not refresh the YouTube access token.');
  return j.access_token as string;
}

/**
 * Quota exhaustion needs its own wording. videos.insert costs 1600 units of a
 * 10,000/day default shared with the analytics routes, so a generic failure
 * message invites a retry that burns what is left.
 */
async function quotaAwareError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  if (res.status === 403 && /quota/i.test(body)) {
    return 'Daily YouTube upload quota exhausted. videos.insert costs 1600 of 10,000 units a day — wait for the Pacific-midnight reset rather than retrying.';
  }
  return `YouTube rejected the upload (HTTP ${res.status}).`;
}

/** Read a job back for the upload guards. */
async function getJob(jobId: string): Promise<MasterJob | null> {
  const r = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `MASTERJOB#${jobId}`, SK: 'METADATA' },
  }));
  return (r.Item as MasterJob) ?? null;
}
```

Add imports: `planUpload`, `uploadRefusalMessage` from `@/lib/youtube-upload` — the alias the worker already uses for `@/lib/mastering-storage` and `@/lib/master-mp3`; `GetCommand` from `@aws-sdk/lib-dynamodb`; `SSMClient`, `GetParameterCommand` from `@aws-sdk/client-ssm`, with `const ssm = new SSMClient({ region });`; `statSync` from `node:fs`.

**Also change the bundle to include the SSM client.** The worker builds with `--external:@aws-sdk/*`, so every AWS client must resolve from the Lambda runtime. The four it imports today (client-s3, client-dynamodb, lib-dynamodb, client-lambda) are proven to resolve; `@aws-sdk/client-ssm` is not, and a runtime-resolution failure appears as `MODULE_NOT_FOUND` in CloudWatch with **no build error** — the worst failure shape available. Replace the wildcard in `package.json`'s `build:master-worker` with the four proven externals, letting client-ssm bundle:

```
--external:@aws-sdk/client-s3 --external:@aws-sdk/client-dynamodb --external:@aws-sdk/lib-dynamodb --external:@aws-sdk/client-lambda
```

- [ ] **Step 4: Typecheck and bundle**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"; tail -20 /tmp/tsc.log
npm run build:master-worker > /tmp/b.log 2>&1; echo "BUILD=$?"; tail -20 /tmp/b.log
```

Expected: both 0. **Do not deploy.**

- [ ] **Step 5: Commit**

```bash
git add worker/master-worker.ts
git commit -m "feat(worker): upload a rendered video to YouTube as a private draft"
```

---

### Task 8: The upload route

**Files:**
- Create: `src/app/api/admin/music-lab/master/[jobId]/youtube/route.ts`
- Modify: `src/infrastructure/database/MasterJobRepository.ts` (add `markUploadQueued`)
- Test: `__tests__/api/admin/music-lab/youtube-route.test.ts`

**Interfaces:**
- Consumes: `planUpload`, `uploadRefusalMessage` (Task 6).
- Produces: `POST /api/admin/music-lab/master/[jobId]/youtube` → `202 { success: true, status: 'queued' }`.

**Context:** Model this on `src/app/api/admin/music-lab/master/[jobId]/render/route.ts` — same auth, same Event invoke, same 202. Amplify caps execution near 30 s and drops `after()`, so the route must not wait.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
import { POST } from '@/app/api/admin/music-lab/master/[jobId]/youtube/route';

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue(undefined),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('unauthorised', { status: 401 })),
}));
const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn(() => ({ send })),
  InvokeCommand: jest.fn((i) => i),
}));
const get = jest.fn();
const markUploadQueued = jest.fn().mockResolvedValue(undefined);
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn(() => ({ get, markUploadQueued })),
}));

const body = {
  title: 'காதல் வந்து அரும்பியதே',
  description: 'body',
  tags: ['Tamil love song'],
  playlistIds: ['PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs'],
};
const req = () => new Request('http://x/youtube', { method: 'POST', body: JSON.stringify(body) }) as never;
const ctx = { params: Promise.resolve({ jobId: 'j1' }) };

const okJob = {
  id: 'j1', status: 'done', savedAt: '2026-09-15T00:00:00Z',
  masterKey: 'audio/mastering/a-master-14LUFS.wav',
  videoKey: 'audio/mastering/a-master-14LUFS-1440p.mp4',
  coverKey: 'audio/mastering/a-cover.png',
  youtubeVideoId: null, uploadStatus: null, uploadSessionUri: null,
};

beforeEach(() => { send.mockClear(); markUploadQueued.mockClear(); });

it('enqueues and returns 202 without doing the work', async () => {
  get.mockResolvedValue(okJob);
  const res = await POST(req(), ctx);
  expect(res.status).toBe(202);
  expect(send).toHaveBeenCalledTimes(1);
});

it('marks the job queued so the UI can show it immediately', async () => {
  get.mockResolvedValue(okJob);
  await POST(req(), ctx);
  expect(markUploadQueued).toHaveBeenCalledWith('j1');
});

it('REFUSES a job already on YouTube, and does not invoke the worker', async () => {
  get.mockResolvedValue({ ...okJob, youtubeVideoId: 'abc' });
  const res = await POST(req(), ctx);
  expect(res.status).toBe(409);
  expect(send).not.toHaveBeenCalled();
});

it('404s an unknown job', async () => {
  get.mockResolvedValue(null);
  expect((await POST(req(), ctx)).status).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest youtube-route > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

```ts
/**
 * POST /api/admin/music-lab/master/[jobId]/youtube — upload an already-rendered
 * video to YouTube as a PRIVATE draft.
 *
 * WHY IT IS A JOB RATHER THAN A RESPONSE. Amplify managed compute caps
 * execution near 30 s and drops `after()`, so this Event-invokes the worker and
 * returns immediately, exactly as the render route does. The Studio polls the
 * existing status route — `youtubeVideoId` appears when the upload lands.
 *
 * WHY THE TOKEN IS NOT HERE. Uploading needs the force-ssl scope, which can
 * also delete videos and post comments. This app holds readonly analytics
 * scope and keeps it; only the private worker reads the write token from SSM.
 *
 * Nothing here publishes publicly. The upload is private, and the Data API
 * cannot create a Premiere — that stays a Studio action, permanently.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { planUpload, uploadRefusalMessage } from '@/lib/youtube-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const bodySchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(5000),
  tags: z.array(z.string()).max(60).default([]),
  playlistIds: z.array(z.string()).max(10).default([]),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ success: false, error: 'jobId required' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'A title and description are required.' }, { status: 400 });
  }

  try {
    const repo = new MasterJobRepository();
    const job = await repo.get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    // Every eligibility rule lives in the planner, so the route and the worker
    // cannot disagree. The worker re-runs it on the event it receives.
    const plan = planUpload(job, parsed.data);
    if (!plan.ok) {
      return NextResponse.json({ success: false, error: uploadRefusalMessage(plan.reason) }, { status: 409 });
    }

    // Queued BEFORE the invoke, so a double-click loses the race at the
    // planner's `in-flight` guard rather than starting two uploads.
    await repo.markUploadQueued(jobId);

    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(new InvokeCommand({
      FunctionName: MASTER_WORKER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ jobId, youtube: parsed.data })),
    }));

    return NextResponse.json({ success: true, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/music-lab/master/:jobId/youtube] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the upload.' }, { status: 502 });
  }
}
```

**`MasterJobRepository` has no generic `update()`** — it exposes `create`, `get`, `save`, `rename`, `recordArchive`, `recordPublish`, `markStuck`, `listSavedPage`, `listSaved`. Add one method, modelled exactly on `recordPublish`:

```ts
  /**
   * Mark an upload queued, so a second press of the button loses the race at
   * planUpload's `in-flight` guard rather than starting two uploads.
   *
   * No ttl clause — uploading only ever runs on a saved job, where save() has
   * already removed it.
   */
  async markUploadQueued(id: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: `MASTERJOB#${id}`, SK: 'METADATA' },
        updateExpression: 'SET #uploadStatus = :uploadStatus, #uploadError = :uploadError',
        expressionAttributeNames: { '#uploadStatus': 'uploadStatus', '#uploadError': 'uploadError' },
        expressionAttributeValues: { ':uploadStatus': 'queued', ':uploadError': null },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
```

The route calls `repo.markUploadQueued(jobId)`, and the test mocks `markUploadQueued` rather than `update`.

- [ ] **Step 4: Run the tests**

```bash
npx jest youtube-route > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"
```

Expected: both 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/music-lab/master/\[jobId\]/youtube/route.ts __tests__/api/admin/music-lab/youtube-route.test.ts
git commit -m "feat(api): enqueue a YouTube upload for a rendered master"
```

---

### Task 9: The upload panel

**Files:**
- Modify: `src/components/admin/MasteringStudio.tsx`

**Interfaces:**
- Consumes: `buildUploadDescription` (Task 5), `POST .../publish` (Task 8), `uploadStatus` / `youtubeVideoId` on the job (Task 6).

**Context:** One panel on the saved-master row. Follow the file's existing patterns for fetch, bearer header, and polling — do not invent new ones.

- [ ] **Step 1: Build the panel**

Four sections in order:

1. **Cover + render.** Existing controls, plus the composed frame shown as an `<img>` from the rendered video's poster or the cover itself, so a wrong picture is caught before upload.
2. **Metadata.** Title input; tags input; a `<textarea>` for the operator's Tamil lyric/imagery text. Below it, a read-only preview of `buildUploadDescription({ body, hashtags })` so the full text is visible before upload. The operator edits `body`, never the assembled tail.
3. **Preflight.** Calls the existing release-check route and lists findings grouped by severity. Render `not-checked` findings in a **visibly different, muted style** from a pass — never as a green tick. Nothing blocks the Upload button.
4. **Upload.** Posts to the upload route, then polls the status route until `uploadStatus` is `uploaded` or `failed`.

- [ ] **Step 2: Show what YouTube actually stored**

After `uploadStatus === 'uploaded'`, display the values read back from the API — duration, definition, thumbnail, tag count, language — not the values that were sent.

- [ ] **Step 3: State the two things it cannot do**

Directly under the result, always:

```tsx
<p>
  Two steps remain in YouTube Studio — the Data API cannot do either:
  set the <strong>Premiere</strong> date and time, and <strong>pin</strong> your comment.
</p>
<a href={`https://studio.youtube.com/video/${youtubeVideoId}/edit`} target="_blank" rel="noreferrer">
  Open in YouTube Studio
</a>
```

This is not optional copy. The panel must never imply a release is finished when it is not.

- [ ] **Step 4: Typecheck, lint, test**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"
npx next lint --file src/components/admin/MasteringStudio.tsx > /tmp/l.log 2>&1; echo "LINT=$?"
npx jest MasteringStudio > /tmp/t.log 2>&1; echo "JEST=$?"; tail -20 /tmp/t.log
```

Expected: all 0.

- [ ] **Step 5: Full suite**

```bash
npx jest > /tmp/full.log 2>&1; echo "FULL=$?"; grep -E '^(Test Suites|Tests):' /tmp/full.log
```

Expected: FULL=0. Baseline before this work: 467 suites, 5,563 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MasteringStudio.tsx
git commit -m "feat(mastering): render, check and upload a release from the portal"
```

---

## After the plan

Two things are **deliberately not in this plan** and remain the operator's call:

1. **Deploying the worker.** `npm run deploy:master-worker` pushes new code to the live Lambda. Nothing here runs it.
2. **`YOUTUBE_OAUTH_CLIENT_ID` on the Lambda.** The worker needs it as an environment variable. The function currently has only `DYNAMODB_TABLE_NAME`, `TAKES_BUCKET_REGION`, `TAKES_BUCKET` (verified 2026-09-15).

3. **An IAM grant — WITHOUT THIS THE UPLOAD FAILS AT RUNTIME.** Verified against the live account 2026-09-15: `tamilagaval-master-worker` runs as **`tamilagaval-compose-worker-role`**, whose `ssm:GetParameter` grant is scoped to exactly `/tamilagaval/prod/ANTHROPIC_API_KEY` and `/tamilagaval/prod/GEMINI_API_KEY`. The YouTube parameters are not covered, so `youtubeAccessToken()` gets AccessDenied.

   Add the two ARNs to the existing `read-compose-worker-secrets` inline policy:

   ```json
   {
     "Sid": "ReadYoutubeUploadSecrets",
     "Effect": "Allow",
     "Action": "ssm:GetParameter",
     "Resource": [
       "arn:aws:ssm:ca-central-1:975050319109:parameter/amplify/d3rkmepk4popv0/master/YOUTUBE_OAUTH_CLIENT_SECRET",
       "arn:aws:ssm:ca-central-1:975050319109:parameter/amplify/d3rkmepk4popv0/master/YOUTUBE_DATA_REFRESH_TOKEN"
     ]
   }
   ```

   **No `kms:Decrypt` statement is needed.** Both parameters are `SecureString` under `alias/aws/ssm` — the same key as the two the role already reads successfully with no KMS statement.

The first real upload should be watched, not trusted: confirm the video is private, the thumbnail landed, and the playlists applied, before relying on the panel's own report.
