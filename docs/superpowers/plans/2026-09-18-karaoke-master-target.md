# Karaoke as a first-class mastering target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A karaoke bed masters through the existing pipeline — gaining a job record, an archive copy and a delivery path — without its dynamics being touched.

**Architecture:** A new `normalizationMode` on the master request and job. `'loudness'` (the default) is today's two-pass loudnorm, unchanged. `'peak'` measures true peak and applies one gain to reach −1 dBTP: no loudnorm, no limiter, no compressor. Everything downstream — save, archive, MP3, delivery-links — works as it already does.

**Tech Stack:** Next.js 15 App Router, TypeScript, jest (NOT vitest), ffmpeg in `tamilagaval-master-worker` (nodejs20, ca-central-1).

**Spec:** `docs/superpowers/specs/2026-09-16-karaoke-master-target-design.md` — read it first; it carries the measurements that justify every decision here.

## Global Constants

Copy these values verbatim. They are the spec's, and each was measured.

- `PEAK_CEILING_DBTP = -1.0` — the house ceiling, and the level the Sevvanthi bed was already built to
- `MAX_PEAK_GAIN_DB = 12` — beyond this it is the wrong file, not a quiet one
- `KARAOKE_MP3_BITRATE = '320k'` — what `KARAOKE_DELIVERABLE` promises buyers
- Karaoke master key suffix: `-karaoke-1dBTP.wav`
- Output format: `-ar 48000 -c:a pcm_s24le`, identical to the loudness path

## Global Constraints

- **`'loudness'` output must stay byte-identical.** Any job that does not ask for `'peak'` runs exactly the code it runs today. The worker's existing ffmpeg call-sequence assertions must pass unchanged — never weaken one to accommodate a new branch.
- **⚠️ Do NOT extend `isMasterKey`.** It answers two questions: *"is this already a mastering output?"* (the re-master guard) and *"is this a valid source for a video / short / YouTube upload?"* (a positive requirement). Widening it would make karaoke beds eligible for YouTube renders — the opposite of the intent. Re-master guards become `isMasterKey(k) || isKaraokeMasterKey(k)`; render/short/upload guards keep `isMasterKey(k)` alone.
- **No loudnorm in the peak path.** Not with `linear=true`, not at any target. The spec's measurements show loudnorm reports `Dynamic` on this material at −14, −18 and −20 alike.
- **jest, not vitest.** Never pipe a test run to `tail` — it swallows the exit code. Redirect to a file and `echo $?`.
- **A gain of 0.00 dB is applied, not skipped.** The pass still runs so the output is a real file this pipeline wrote.

## File Structure

| File | Responsibility |
|---|---|
| **Create** `src/lib/master-peak.ts` | The peak path's pure layer: constants, key naming, gain arithmetic, ffmpeg args, refusals |
| **Create** `__tests__/lib/master-peak.test.ts` | Its tests |
| Modify `src/types/masterJob.ts` | `NormalizationMode`, `normalizationMode`, `peakGainDb` |
| Modify `src/infrastructure/database/MasterJobRepository.ts` | Create + hydrate the two fields |
| Modify `src/app/api/admin/music-lab/master/route.ts` | Accept and validate the mode; refuse `'peak'` + `referenceId` |
| Modify `worker/master-worker.ts` | The peak branch, and the widened re-master guard |
| Modify `src/lib/master-report.ts` | "peak-safe" and "gain applied" rows |
| Modify `src/components/admin/MasteringStudio.tsx` | The third target choice and what it hides |

---

## Task 1: The pure peak module

**Files:**
- Create: `src/lib/master-peak.ts`
- Test: `__tests__/lib/master-peak.test.ts`

**Interfaces — Produces:**
```ts
export type NormalizationMode = 'loudness' | 'peak';
export const PEAK_CEILING_DBTP = -1.0;
export const MAX_PEAK_GAIN_DB = 12;
export const KARAOKE_MP3_BITRATE = '320k';
export function karaokeMasterKeyFor(s3Key: string): string;
export function isKaraokeMasterKey(s3Key: string): boolean;
export function peakGainFor(measuredTruePeak: number): number;
export type PeakRefusal = 'unreadable-peak' | 'needs-too-much-gain';
export function planPeakGain(measuredTruePeak: number | null):
  | { ok: true; gainDb: number }
  | { ok: false; reason: PeakRefusal; needsDb?: number };
export function peakRefusalMessage(r: PeakRefusal, needsDb?: number): string;
export function buildPeakArgs(p: { inPath: string; outPath: string; gainDb: number }): string[];
export function isValidNormalizationMode(v: unknown): v is NormalizationMode;
```

- [ ] **Step 1: Write the failing test**

```ts
import {
  karaokeMasterKeyFor, isKaraokeMasterKey, planPeakGain, buildPeakArgs,
  isValidNormalizationMode, PEAK_CEILING_DBTP, MAX_PEAK_GAIN_DB,
} from '@/lib/master-peak';
import { isMasterKey } from '@/lib/loudness-measure';

describe('karaoke keys', () => {
  it('names the bed beside its source', () => {
    expect(karaokeMasterKeyFor('audio/mastering/1_a_song.wav'))
      .toBe('audio/mastering/1_a_song-karaoke-1dBTP.wav');
  });

  it('recognises its own output and nothing else', () => {
    expect(isKaraokeMasterKey('audio/mastering/x-karaoke-1dBTP.wav')).toBe(true);
    expect(isKaraokeMasterKey('audio/mastering/x-master-14LUFS.wav')).toBe(false);
  });

  /**
   * ⚠️ isMasterKey answers "is this a valid source for a video/short/upload?"
   * as well as "is this already a master?". If it starts matching karaoke keys,
   * karaoke beds become eligible for YouTube renders.
   */
  it('is NOT matched by isMasterKey', () => {
    expect(isMasterKey(karaokeMasterKeyFor('audio/mastering/x.wav'))).toBe(false);
  });
});

describe('the gain', () => {
  it('lifts a quiet bed to the ceiling', () => {
    expect(planPeakGain(-7.5)).toEqual({ ok: true, gainDb: 6.5 });
  });

  it('attenuates one that is over it', () => {
    expect(planPeakGain(0.5)).toEqual({ ok: true, gainDb: -1.5 });
  });

  it('applies 0.00 dB rather than refusing a bed already at the ceiling', () => {
    // The Sevvanthi bed measured exactly -1.0 dBTP. A no-op pass still runs,
    // so the output is a real file this pipeline wrote.
    expect(planPeakGain(PEAK_CEILING_DBTP)).toEqual({ ok: true, gainDb: 0 });
  });

  it('refuses a boost that means the wrong file was uploaded', () => {
    const r = planPeakGain(-1 - MAX_PEAK_GAIN_DB - 0.1);
    expect(r).toMatchObject({ ok: false, reason: 'needs-too-much-gain' });
  });

  it('refuses an unreadable peak rather than assuming one', () => {
    expect(planPeakGain(null)).toEqual({ ok: false, reason: 'unreadable-peak' });
  });
});

describe('the ffmpeg args', () => {
  const args = buildPeakArgs({ inPath: '/tmp/in.wav', outPath: '/tmp/out.wav', gainDb: 6.5 });

  it('is ONE gain change and nothing else', () => {
    expect(args[args.indexOf('-af') + 1]).toBe('volume=6.50dB');
    expect(args.join(' ')).not.toContain('loudnorm');
    expect(args.join(' ')).not.toContain('alimiter');
    expect(args.join(' ')).not.toContain('acompressor');
  });

  it('writes the same format as the loudness path', () => {
    expect(args[args.indexOf('-ar') + 1]).toBe('48000');
    expect(args[args.indexOf('-c:a') + 1]).toBe('pcm_s24le');
  });
});

describe('the mode', () => {
  it('accepts only the two real values', () => {
    expect(isValidNormalizationMode('loudness')).toBe(true);
    expect(isValidNormalizationMode('peak')).toBe(true);
    for (const v of ['karaoke', '', null, undefined, 0]) {
      expect(isValidNormalizationMode(v)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx jest __tests__/lib/master-peak.test.ts > /tmp/t.txt 2>&1; echo $?`
Expected: FAIL — `Cannot find module '@/lib/master-peak'`.

- [ ] **Step 3: Write `src/lib/master-peak.ts`**

Header comment must record WHY this exists: loudnorm reports `Normalization Type: Dynamic` on a karaoke bed at −14, −18 and −20 alike, even with `linear=true` requested, and misses the requested target by ~0.7 LU. Peak-only is the only option measured that leaves −20.2 LUFS / 6.4 LU untouched. Cite the spec.

```ts
export function planPeakGain(measuredTruePeak: number | null) {
  if (measuredTruePeak === null || !Number.isFinite(measuredTruePeak)) {
    return { ok: false as const, reason: 'unreadable-peak' as const };
  }
  const gainDb = Math.round((PEAK_CEILING_DBTP - measuredTruePeak) * 100) / 100;
  if (gainDb > MAX_PEAK_GAIN_DB) {
    return { ok: false as const, reason: 'needs-too-much-gain' as const, needsDb: gainDb };
  }
  return { ok: true as const, gainDb };
}

export function buildPeakArgs(p: { inPath: string; outPath: string; gainDb: number }): string[] {
  return [
    '-hide_banner', '-nostats', '-i', p.inPath,
    '-af', `volume=${p.gainDb.toFixed(2)}dB`,
    '-ar', '48000', '-c:a', 'pcm_s24le', '-y', p.outPath,
  ];
}
```

- [ ] **Step 4: Run the tests — expect PASS**
- [ ] **Step 5: Commit** — `feat(mastering): pure peak-normalisation layer for karaoke beds`

---

## Task 2: The job record carries the mode

**Files:**
- Modify: `src/types/masterJob.ts`, `src/infrastructure/database/MasterJobRepository.ts`
- Test: `__tests__/infrastructure/MasterJobRepository.test.ts` (extend)

**Interfaces — Consumes:** `NormalizationMode` from Task 1.

- [ ] **Step 1: Write the failing test** — a row created without the fields hydrates them as `null`; a row carrying `normalizationMode: 'peak'` and `peakGainDb: 6.5` hydrates them through; a row carrying a nonsense mode hydrates as `null` rather than passing it on.

- [ ] **Step 2: Run it, watch it fail**

- [ ] **Step 3: Add to `MasterJob`**

```ts
/** null ⇒ 'loudness' — every row written before this existed. */
normalizationMode: NormalizationMode | null;
/** The single gain applied in 'peak' mode. Null in 'loudness' mode. */
peakGainDb: number | null;
```

and in the repository's `create()` (`null`, `null`) and hydrate:

```ts
normalizationMode:
  item.normalizationMode === 'peak' || item.normalizationMode === 'loudness'
    ? item.normalizationMode : null,
peakGainDb: typeof item.peakGainDb === 'number' ? item.peakGainDb : null,
```

- [ ] **Step 4: Run — expect PASS. Run the FULL suite too:** adding required fields to `MasterJob` breaks every test fixture that builds one literally. Fix the fixtures; do not make the fields optional to avoid the work.
- [ ] **Step 5: Commit**

---

## Task 3: The route accepts the mode

**Files:**
- Modify: `src/app/api/admin/music-lab/master/route.ts`
- Test: `__tests__/api/admin-music-lab.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it('defaults to loudness, and the payload is unchanged', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'j1' });
  await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, target: -14 }));
  const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
  expect('normalizationMode' in payload).toBe(false);
});

it('passes peak through to the worker', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'j1' });
  await masterPOST(post('/api/admin/music-lab/master',
    { s3Key: SRC, target: -14, normalizationMode: 'peak' }));
  const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
  expect(payload.normalizationMode).toBe('peak');
});

it('400s an unknown mode, naming the two that exist', async () => {
  const res = await masterPOST(post('/api/admin/music-lab/master',
    { s3Key: SRC, target: -14, normalizationMode: 'karaoke' }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/loudness.*peak|peak.*loudness/);
});

/**
 * Matchering exists to move a track toward a reference's tonal and loudness
 * profile — the one thing this mode promises not to do. Refuse, do not prefer.
 */
it('400s peak together with a reference', async () => {
  const res = await masterPOST(post('/api/admin/music-lab/master',
    { s3Key: SRC, target: -14, normalizationMode: 'peak', referenceId: 'ref-1', matchingMethod: 'matched' }));
  expect(res.status).toBe(400);
  expect(MockInvoke).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement.** Spread the field only when `'peak'`, so a loudness enqueue stays byte-identical.
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

---

## Task 4: The worker's peak branch

**Files:**
- Modify: `worker/master-worker.ts`
- Test: `__tests__/worker/master-worker.test.ts` (extend)

**Interfaces — Consumes:** `planPeakGain`, `buildPeakArgs`, `karaokeMasterKeyFor`, `isKaraokeMasterKey`, `KARAOKE_MP3_BITRATE`.

- [ ] **Step 1: Write the failing test**

Select ffmpeg passes **by shape, not by index** — the suite already does this for the short, after adding a pass broke six positional assertions at once.

```ts
describe('peak mode — a karaoke bed', () => {
  const peak = { jobId: 'k1', s3Key: SRC_KEY, target: -14, normalizationMode: 'peak' };

  it('runs NO loudnorm, at any target', async () => {
    await handler(peak as never);
    expect(ffArgs().join(' ')).not.toContain('loudnorm');
  });

  it('measures, then applies ONE gain', async () => {
    await handler(peak as never);
    const gain = ffArgs().find((a) => a.join(' ').includes('volume='))!;
    expect(gain[gain.indexOf('-af') + 1]).toMatch(/^volume=-?\d+\.\d\ddB$/);
    expect(gain.join(' ')).not.toContain('alimiter');
  });

  it('stores the bed under its own key, never the loudness one', async () => {
    await handler(peak as never);
    const put = s3Send.mock.calls.map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => String(c.input.Key).endsWith('.wav'))!;
    expect(String(put.input.Key)).toMatch(/-karaoke-1dBTP\.wav$/);
    expect(String(put.input.Key)).not.toMatch(/LUFS/);
  });

  it('encodes the MP3 at 320k, which is what buyers are promised', async () => {
    await handler(peak as never);
    const mp3 = ffArgs().find((a) => a.join(' ').includes('libmp3lame'))!;
    expect(mp3[mp3.indexOf('-b:a') + 1]).toBe('320k');
  });

  it('records the gain it applied', async () => {
    await handler(peak as never);
    expect(typeof patched().peakGainDb).toBe('number');
    expect(patched().normalizationMode).toBe('peak');
  });

  it('refuses a bed needing an absurd boost, and stores nothing', async () => {
    // stub ebur128 to report a very quiet true peak
    const res = await handler(peak as never);
    expect(res).toMatchObject({ ok: false });
  });

  /** The re-master guard must cover karaoke output too. */
  it('refuses to re-master an existing karaoke bed', async () => {
    const res = await handler({ ...peak, s3Key: 'audio/mastering/x-karaoke-1dBTP.wav' } as never);
    expect(res).toMatchObject({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

/** ⚠️ The existing loudness assertions must pass UNCHANGED. */
it('loudness mode still runs its two loudnorm passes', async () => {
  await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
  expect(ffArgs().filter((a) => a.join(' ').includes('loudnorm'))).toHaveLength(2);
});
```

- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement.** Branch on `event.normalizationMode === 'peak'` after the edit pre-pass and before pass 1. Widen the re-master guard to `isMasterKey(k) || isKaraokeMasterKey(k)`. Leave the render/short/upload guards alone.
- [ ] **Step 4: Run — expect PASS, including every pre-existing worker test**
- [ ] **Step 5: Commit**

---

## Task 5: The report stops failing a karaoke bed

**Files:**
- Modify: `src/lib/master-report.ts`
- Test: `__tests__/lib/master-report.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — a job with `normalizationMode: 'peak'`, `afterLufs: -20.2`, `afterTp: -1.0` must NOT produce a failing "on target" row; it produces a passing **peak-safe** row. The "gain type" row is replaced by **gain applied**, showing `peakGainDb`. Integrated loudness and LRA appear with before/after and no verdict.
- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

---

## Task 6: The Studio offers it

**Files:**
- Modify: `src/components/admin/MasteringStudio.tsx`
- Test: `__tests__/components/admin/MasteringStudio.test.tsx` (extend)

⚠️ **The icon mock.** This suite mocks `lucide-react` with a fixed list. A new icon missing from it does not fail as a missing icon — React renders `undefined` and the whole component throws, taking every test in the file with it. Add any new icon to the mock first.

- [ ] **Step 1: Write the failing test**

```ts
it('offers a karaoke bed alongside -14 and -16', async () => {
  render(<MasteringStudio />); await uploadA();
  expect(screen.getByRole('button', { name: /Karaoke bed/i })).toBeInTheDocument();
});

it('sends normalizationMode peak when it is chosen', async () => { /* ... */ });

/** A bed is a deliverable, not a release. */
it('hides the YouTube render and upload panels for a karaoke master', async () => {
  // master in peak mode, reach the result panel
  expect(screen.queryByRole('button', { name: /Render video/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Make a short/i })).not.toBeInTheDocument();
});

it('hides the reference picker, which the route refuses anyway', async () => { /* ... */ });

it('downloads as a karaoke bed, not as a master', async () => {
  // downloadKey already takes the optional label argument
  expect(decodeURIComponent(String(req[0]))).toContain('(Karaoke bed -1 dBTP)');
  expect(decodeURIComponent(String(req[0]))).not.toContain('LUFS');
});
```

- [ ] **Step 2: Run, watch it fail**
- [ ] **Step 3: Implement**, including the deliverable note — *320 kbps MP3, no vocals, headroom for a live voice* — matching `KARAOKE_DELIVERABLE`.
- [ ] **Step 4: Run — expect PASS**

⚠️ **Found during Task 4 — the release pipeline will offer a dead-end button.**
`planRender` (`src/lib/master-video.ts:125-128`) gates on `status === 'done'`,
`savedAt` and `masterKey` — never on `isMasterKey` — so `pipelineFor` in
`src/lib/release-pipeline.ts:83` will offer **Render video** on a finished
karaoke job. The worker then refuses it (`isMasterKey(audioKey)` is false for a
bed; a Task 4 test pins that refusal), so the button is a dead end rather than a
hazard. Fix it here, in `planRender`/`planShort`, not in the component: refuse
`no-master` — or a new reason — when the job's `normalizationMode` is `'peak'`,
so the pipeline line and the buttons still cannot disagree.

- [ ] **Step 5: Commit**

---

## Task 7: Prove it on the real bed

**Files:** none — this is the acceptance test, run by hand.

⚠️ **The tests can all pass while the feature is wrong.** That happened twice in the week this was written: a control that rendered in no reachable place, and a tempo estimator off by a factor of two, both with green suites. Verification is running it on real audio.

- [ ] **Step 1: Deploy the worker** — `npm run deploy:master-worker`. It does NOT ride along with Amplify.
- [ ] **Step 2: Master `~/albums/karaoke/sevvanthi/karaoke-clean.wav` in peak mode through the portal**
- [ ] **Step 3: Measure the output**

```bash
ffmpeg -hide_banner -nostats -i <output>.wav -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary:/,$p'
```

**Expected — unchanged from the input:**

| | value |
|---|---|
| Integrated | **−20.2 LUFS** |
| LRA | **6.4 LU** |
| True peak | **−1.0 dBTP** |

The bed was already built to −1.0 dBTP, so the gain is 0.00 dB and a correct implementation returns it untouched. **Any movement in LRA means something compressed it and the feature is wrong.**

- [ ] **Step 4: Check the MP3 is 320 kbps** — `ffmpeg -i <output>.mp3` should report `320 kb/s`.
- [ ] **Step 5: Check the report** reads peak-safe rather than a failed master, and that the row offers no video or short.
- [ ] **Step 6: Commit** any fixes the real run surfaces.

---

## Out of scope

Stem separation in the portal · video, short or YouTube upload from a bed · a "keep loudness but also hit a target" hybrid (the measurements show loudnorm cannot do it linearly on this material) · destination presets as a general abstraction — worth doing *after* this, once a second mode has shown what the abstraction needs.
