# Composition Studio Phase 0 (Listening Test) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a throwaway admin page that renders 8 lines of one existing song on 3 instruments from shippable samples. Raj rates 18 blind, loudness-matched A/B trials against the Suno stem, and the page records the results.

**Architecture:**
- **Dev box (no repo code):** sample packs, stem cuts, note data and a manifest go into the private mastering workspace with the AWS CLI.
- **The page**, `/admin/music-lab/studio-test`:
  - loads them through the existing presigned play route;
  - renders each trial with Tone.js + smplr through `Tone.Offline`;
  - uploads and measures each render through the existing upload and measure routes;
  - runs the trials in `MasteringComparePlayer` in a new blind mode;
  - saves ratings to one S3 JSON through one new route.
- **Headers:** `/admin` gets `worker-src 'self' blob:`. Public headers stay byte-identical.

**Tech Stack:**
- Next.js 15 / React 19, TypeScript, zod 4.
- `tone@15.1.22`, `smplr@1.1.0`.
- jest + @testing-library/react.
- Dev box: ffmpeg 6, Python venv with `basic-pitch` and `librosa`.

**Spec:** `docs/specs/studio-phase-0-listening-test.md` (merged in #396). Raj's choices: candidate A, the basic-pitch draft, three instruments.

## Global Constraints

- No new AWS service, no worker deploy, no change to `master-worker` or any worker. No DynamoDB writes. `COMPOSITION#<id>/METADATA` is not touched.
- Desktop Chrome only.
- Exactly two new direct dependencies, pinned exact: `tone@15.1.22` and `smplr@1.1.0`. Nothing GPL, AGPL, LGPL or non-commercial anywhere in their tree.
- Do **not** use worklet-based nodes: Tone's `FeedbackCombFilter`, `Freeverb`, `JCReverb` or `BitCrusher`, or smplr's `Reverb`. Reverb is `Tone.Reverb`, `decay: 2.0`, `wet: 0.2`, the same for every render.
- Renders are 48 kHz, stereo, 16-bit PCM WAV, exactly the stem cut's `durationSec` long.
- All Phase 0 S3 data lives under `audio/mastering/studio/phase0/`. Packs live under `audio/mastering/studio-samples/<packId>/`.
- Pack ids exactly: `fluidr3-flute`, `fluidr3-violin`, `vsco2-flute`, `vsco2-violin`, `vcsl-frame-drum`, `vcsl-darbuka`.
- Line ids exactly: `F1 F2 F3` (flute), `V1 V2 V3` (violin), `P1 P2` (percussion). Gamaka variants: `F1` and `V1` on the VSCO pack only. That makes **18 trials**.
- Rating scale: 1 Unusable · 2 Clearly synthetic, would not ship · 3 **Acceptable**, would ship in a mix · 4 Good · 5 Cannot fault it.
- Public repo: no song title, arrangement description or note data in any committed file, test fixture or commit message. Fixtures use invented keys and notes.
- Every admin mutation route calls `requireAdmin` **and** `requireBearer`. `__tests__/api/admin-auth-coverage.test.ts` enforces this.
- Errors render next to the step or row that caused them. Never only in the global banner.
- Tone and smplr load only through dynamic `import()` from the Phase 0 component.
- Run jest locally with `NODE_OPTIONS=--no-experimental-strip-types` (Node 22 on the dev box).

## Review Focus

1. **The page is reached by client-side navigation from `/login`**, which keeps the public CSP. The Worker probe must fail closed with *"Reload this page"* before anything loads. Pinned in Task 6.
2. **The page is reloaded or closed partway through the trials.** Reopening resumes from `results.json` with the same order and sides. Saved trials stay revealed, and nothing re-randomises. Pinned in Tasks 3 and 6.
3. **A rated trial is changed.** The first rating is kept, and the new one is appended with `revised: true`. Pinned in Tasks 3 and 4.
4. **A measure call fails for one trial (502).** The error shows in that trial's row, the other trials still prepare, and **Retry** re-measures only that trial. Pinned in Task 6.
5. **Raj scores a line's Suno stem below 3.** The line is excluded and listed, not counted as a render failure. If an instrument + source has no lines left, it has *no verdict*, not a fail. Pinned in Task 3.

---

### Task 1: `/admin`-scoped CSP

**Files:**
- Modify: `src/config/csp.ts`, the `buildContentSecurityPolicy` signature and its docblock
- Modify: `next.config.ts`, `headers()`: a new entry after the `'/:path*'` entry
- Test: `__tests__/config/csp.test.ts` (extend), `__tests__/config/next-admin-csp.test.ts` (new)

**Interfaces:**
- Produces:
  - `buildContentSecurityPolicy(nodeEnv?: string, opts?: { scope?: 'public' | 'admin' }): string`, with `scope` defaulting to `'public'`;
  - `export const adminContentSecurityPolicy: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/config/csp.test.ts — new describe block
const PUBLIC_PROD_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.amazonaws.com https://d2cdoh43143xxa.cloudfront.net https://i.ytimg.com https://inputtools.google.com; media-src 'self' blob: https:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; upgrade-insecure-requests";

describe('admin scope (Composition Studio Phase 0)', () => {
  it('leaves the public production policy byte-identical', () => {
    expect(buildContentSecurityPolicy('production')).toBe(PUBLIC_PROD_CSP);
    expect(buildContentSecurityPolicy('production', { scope: 'public' })).toBe(PUBLIC_PROD_CSP);
  });
  it('adds exactly one directive for /admin', () => {
    expect(buildContentSecurityPolicy('production', { scope: 'admin' }))
      .toBe(`${PUBLIC_PROD_CSP}; worker-src 'self' blob:`);
  });
  it('never adds blob: or wasm-unsafe-eval to script-src', () => {
    const admin = buildContentSecurityPolicy('production', { scope: 'admin' });
    expect(directive(admin, 'script-src')).not.toMatch(/blob:|wasm-unsafe-eval/);
  });
});
```

`__tests__/config/next-admin-csp.test.ts` (`@jest-environment node`), modelled on `next-public-cache.test.ts`:
- `it.each(['/admin', '/admin/music-lab/studio-test'])`: the **last** `headers()` entry whose `source` matches the path and sets `Content-Security-Policy` has the admin policy. Use `path-to-regexp`'s `match` the way Next does, or a source → regex helper local to the test.
- `it.each(['/', '/songs', '/content/abc', '/stories', '/login'])`: that last matching entry has the public policy.
- The admin entry sets **only** `Content-Security-Policy`, so `Permissions-Policy` and the rest still come from `/:path*` alone.

- [ ] **Step 2: Run them and see them fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/config/csp.test.ts __tests__/config/next-admin-csp.test.ts`
Expected: FAIL, because the admin scope and the entry do not exist yet.

- [ ] **Step 3: Implement**

`csp.ts`: when `scope === 'admin'`, append `"worker-src 'self' blob:"` as the final directive. The docblock records why: Tone's `Ticker` clock is `new Worker(blob:…)`, it is scoped to `/admin` only, and worklets are deliberately avoided.

`next.config.ts`: add `{ source: '/admin/:path*', headers: [{ key: 'Content-Security-Policy', value: adminContentSecurityPolicy }] }` as the **last** entry, with a comment that order matters because the later entry wins for the same key. Also match bare `/admin` (the `:path*` matcher matches zero segments; the test proves it).

- [ ] **Step 4: Run the whole config folder and the full suite**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/config && npx tsc --noEmit`
Expected: PASS, and tsc clean.

- [ ] **Step 5: Commit**

`git commit -m "feat(csp): allow blob: workers on /admin only, for the studio listening test"`

---

### Task 2: Blind mode for `MasteringComparePlayer`

**Files:**
- Modify: `src/components/admin/MasteringComparePlayer.tsx`: `Props`, the radiogroup labels at about lines 508–513, the level note at about 518–524, and the match toggle at about 321–329
- Test: `__tests__/components/mastering-compare-blind.test.tsx` (new; copy the AudioContext mocking from `__tests__/components/mastering-player-resources.test.tsx`)

**Interfaces:**
- Produces: the optional prop `labels?: { a: string; b: string; levelNote?: string }`.
  - When set: the buttons read `labels.a` and `labels.b`. The note under the buttons is `labels.levelNote ?? 'Levels matched. Switch A/B while it plays.'`. The *Match loudness* toggle is not rendered, and matching is forced on. `matchedKey` is ignored.

- [ ] **Step 1: Write the failing tests**
  - `renders today's labels when labels is unset`: the buttons are named `A · Before (source)` and `B · After (master)`, and the *Match loudness* checkbox is present.
  - `blind labels replace the source/master wording`: with `labels={{ a: 'A', b: 'B' }}`, no text matching `/source|master|louder/i` is in the component, and there is no *Match loudness* checkbox.
  - `blind mode keeps loudness matching on`: with `beforeLufs=-20` and `afterLufs=-14`, the gain applied to side B is `matchGains(-20, -14).master`. Mock `AudioContext` as the existing player tests do, or assert through the gain-setting effect.

- [ ] **Step 2: Run them and see them fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/mastering-compare-blind.test.tsx __tests__/components/mastering-player-stops.test.tsx`
Expected: the two blind tests FAIL.

- [ ] **Step 3: Implement the prop.** With `labels` unset, the component's output is unchanged.

- [ ] **Step 4: Run the tests and see them pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(mastering): optional blind labels on the compare player"`

---

### Task 3: Phase 0 model: manifest, trials, results, verdict

**Files:**
- Create: `src/lib/studio-phase0/model.ts`
- Test: `__tests__/lib/studio-phase0/model.test.ts`

**Interfaces:**
- Produces:
  - **Constants:**
    - `PHASE0_PREFIX = 'audio/mastering/studio/phase0/'`
    - `MANIFEST_KEY = PHASE0_PREFIX + 'manifest.json'`
    - `RESULTS_KEY = PHASE0_PREFIX + 'results.json'`
  - **Types:**
    - `type Instrument = 'flute' | 'violin' | 'percussion'`
    - `interface LineSpec { lineId: string; instrument: Instrument; stemKey: string; notesKey: string; durationSec: number; spanStartSec: number }`
    - `interface PackSpec { packId: string; instrument: Instrument; packKey: string }` (`packKey` points to the pack's `pack.json`)
    - `interface Manifest { version: 1; lines: LineSpec[]; packs: PackSpec[] }`
    - `interface Note { t: number; dur: number; midi: number; vel: number; detuneCurve?: number[] }` (`detuneCurve` is in cents, evenly spaced across `dur`)
    - `interface LineNotes { lineId: string; durationSec: number; notes: Note[] }`
    - `interface Trial { trialId: string; lineId: string; instrument: Instrument; packId: string; gamaka: boolean }` (`trialId = \`${lineId}-${packId}${gamaka ? '-gamaka' : ''}\``)
    - `interface Rating { renderScore: 1|2|3|4|5; sunoScore: 1|2|3|4|5; guess: 'A' | 'B' | 'unsure'; note: string; revised: boolean; at: string }`
    - `interface TrialRecord { renderSide: 'A' | 'B'; renderKey: string | null; renderLufs: number | null; stemLufs: number | null; ratings: Rating[] }`
    - `interface Results { version: 1; seed: string; order: string[]; trials: Record<string, TrialRecord> }`
  - **Functions:**
    - `manifestSchema`, `lineNotesSchema`, `resultsSchema` (zod)
    - `parseManifest(raw: unknown): { ok: true; value: Manifest } | { ok: false; error: string }`
    - `buildTrials(m: Manifest): Trial[]`
    - `newSession(trials: Trial[], seedHex: string): Results`
    - `addRating(r: Results, trialId: string, rating: Omit<Rating, 'revised' | 'at'>, now: Date): Results`
    - `isRevealed(r: Results, trialId: string): boolean`
    - `verdict(r: Results, trials: Trial[]): Verdict`, where `Verdict = { byPack: Record<string, { instrument: Instrument; pass: boolean | null; lines: Array<{ lineId: string; renderScore: number; sunoScore: number; excluded: boolean }> }>; byInstrument: Record<Instrument, { pass: boolean | null; passedWith: string[] }>; gamaka: Array<{ lineId: string; straight: number | null; gamaka: number | null }>; suno: { hits: number; total: number }; phase0Pass: boolean }`

- [ ] **Step 1: Write the failing tests** (fixtures use invented keys such as `audio/mastering/studio/phase0/lines/F1/stem.wav`)
  - `buildTrials returns 18 trials for the Phase 0 manifest`: 3 flute lines × 2 flute packs, 3 violin × 2, 2 percussion × 2, plus `F1-vsco2-flute-gamaka` and `V1-vsco2-violin-gamaka`. All trial ids are unique.
  - `newSession is deterministic for a seed and is a permutation`: the same seed gives the same `order` and sides. `order` sorted equals the trial ids sorted. Two different seeds give a different order.
  - `newSession sides are not all equal` for the fixture seed. Sides come from the same seeded PRNG: mulberry32 over the first 8 hex digits of `seedHex`.
  - `isRevealed is false until the first rating, then true`.
  - `addRating marks every rating after the first as revised and keeps the first`.
  - `verdict: a line passes at renderScore ≥ 3`. `instrument+source passes with 2 of 3 lines, or both of 2`. `a line with sunoScore < 3 is excluded`. `a pack with every line excluded has pass null`.
  - `verdict: an instrument passes if either pack passes, and passedWith lists which`.
  - `verdict: gamaka trials never count toward byPack`.
  - `verdict: phase0Pass needs ≥ 2 of 3 instruments passing`.
  - `suno hits count guess === the side that was NOT the render`.
  - `parseManifest rejects a stemKey outside PHASE0_PREFIX, durationSec ≤ 0 and an unknown instrument`.
  - `resultsSchema rejects a score outside 1–5 and a note over 200 characters`.

- [ ] **Step 2: Run them and see them fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/studio-phase0/model.test.ts`
Expected: FAIL, because the module does not exist yet.

- [ ] **Step 3: Implement `model.ts`.** Shuffle with Fisher–Yates using the seeded mulberry32. Then draw one bit per trial in the shuffled order for its side: `< 0.5` means `'A'`. These must be pure functions with no `Date.now()` and no `crypto` inside them; the caller passes the seed and `now`.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(studio-phase0): trial model, blind session and verdict rules"`

---

### Task 4: Results route

**Files:**
- Create: `src/app/api/admin/music-lab/studio-phase0/results/route.ts`
- Test: `__tests__/api/admin-studio-phase0-results.test.ts`

**Interfaces:**
- Consumes: `RESULTS_KEY` and `resultsSchema` (Task 3); `S3Operations.getFile` and `S3Operations.uploadFile`; `requireAdmin`, `requireBearer` and `authErrorResponse`.
- Produces:
  - `GET` returns `{ success: true, results: Results | null }`. The value is `null` when the object does not exist (`NoSuchKey`).
  - `PUT` takes a `Results` body and returns `{ success: true }`.

- [ ] **Step 1: Write the failing tests** (mock `S3Operations` as the other admin route tests do)
  - `GET is admin-only` (401 without auth); `PUT needs a bearer token`.
  - `GET returns null when results.json does not exist yet`.
  - `GET returns the parsed results`.
  - `PUT writes exactly RESULTS_KEY with contentType application/json`. Any `key` field in the body is ignored.
  - `PUT rejects an invalid body with 400` (score 6) and `rejects a body over 256 KB with 413`.
  - `PUT refuses to drop a rating`: when stored results have more ratings for a trial than the body, it returns 409. This guards a stale tab overwriting newer ratings.

- [ ] **Step 2: Run them and see them fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/api/admin-studio-phase0-results.test.ts __tests__/api/admin-auth-coverage.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the route**
  - `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.
  - Measure the body size from `request.text()` before `JSON.parse`.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS, including the auth-coverage test.

- [ ] **Step 5: Commit**

`git commit -m "feat(studio-phase0): admin route storing listening-test results in S3"`

---

### Task 5: Audio helpers: WAV encoding, gamaka curves, the audio engine

**Files:**
- Create:
  - `src/lib/studio-phase0/wav.ts`
  - `src/lib/studio-phase0/gamaka.ts`
  - `src/lib/studio-phase0/engine.ts`
- Modify: `package.json` / `package-lock.json` (`npm install --save-exact tone@15.1.22 smplr@1.1.0`)
- Test:
  - `__tests__/lib/studio-phase0/wav.test.ts`
  - `__tests__/lib/studio-phase0/gamaka.test.ts`
  - `__tests__/lib/studio-phase0/engine.test.ts`

**Interfaces:**
- Consumes: `Note`, `LineNotes`, `Trial` and `PackSpec` (Task 3).
- Produces:
  - `encodeWav16(channels: Float32Array[], sampleRate: number): Uint8Array`
  - `smoothCurve(cents: number[], window: number): number[]`, a centred moving average that keeps the array length and the first and last values.
  - `curveForNote(note: Note): Float32Array | null`, which is `null` when there is no `detuneCurve` or it has fewer than 2 points.
  - `interface PackFile { kind: 'soundfont'; file: string; licence: string; attribution: string } | { kind: 'sampler'; samples: Record<string, string>; licence: string; attribution: string }`. A sampler's keys are MIDI note numbers as strings; for percussion they are `'low'` and `'high'`.
  - `type FetchKey = (key: string) => Promise<ArrayBuffer>`
  - `loadPack(spec: PackSpec, fetchKey: FetchKey, ctx: BaseAudioContext): Promise<LoadedPack>`. It decodes once, and `LoadedPack` holds `AudioBuffer`s keyed as in `PackFile`.
  - `noteToSample(pack: LoadedPack, midi: number): { buffer: AudioBuffer; detuneCents: number }`: the nearest sample by MIDI number, with cents to correct the pitch.
  - `percussionSample(pack: LoadedPack, midi: number): AudioBuffer`: MIDI below 60 is `'low'`, otherwise `'high'`. The dev-box transcription writes 48 for low and 72 for high.
  - `renderLine(line: LineNotes, pack: LoadedPack, trial: Trial): Promise<Float32Array[]>`, using `Tone.Offline` at 48 kHz stereo for exactly `line.durationSec`.
  - `playLive(line: LineNotes, pack: LoadedPack, trial: Trial): Promise<() => void>`. It runs on the shared context through `Tone.getTransport()` and returns a stop function.

**Engine rules (decisions the implementer cannot infer):**
- `engine.ts` imports `tone` and `smplr` **only** through `await import()` inside its functions. It must never have a static import.
- **Straight notes** play through smplr's `Sampler` on the target context, built with `buffers` set to the pre-decoded `AudioBuffer`s keyed by MIDI number (`SamplerBuffers` accepts `AudioBuffer` values) so nothing is fetched twice.
- **Gamaka notes** (`trial.gamaka && curveForNote(note)`) play through one `AudioBufferSourceNode` from `noteToSample`, with `detune.setValueCurveAtTime(curve + detuneCents, t, dur)` and a 10 ms linear gain fade in and out.
- **Every voice** routes through one `Tone.Reverb({ decay: 2.0, wet: 0.2 })`, and the reverb's `ready` promise is awaited before scheduling.
- **Velocity** maps linearly: gain = `vel / 127`.

- [ ] **Step 1: Write the failing tests**
  - `encodeWav16 writes a 44-byte RIFF header`: check `'RIFF'`, `'WAVE'`, `fmt ` PCM=1, 2 channels, 48000 Hz, byte rate 192000, block align 4, 16 bits, `data` size = frames × 4.
  - `encodeWav16 interleaves L/R and clips to ±1`: input [1.5, -1.5] encodes as [32767, -32768].
  - `smoothCurve keeps length and endpoints, and flattens a single spike`.
  - `curveForNote returns null without a curve`.
  - `noteToSample picks the nearest sample and returns the cents gap`: samples at 60 and 64, note 63, gives 64 and −100.
  - `percussionSample maps 48 to low and 72 to high`.
  - `engine.ts has no static import of tone or smplr`: read the source and assert no `/^import .* from ['"](tone|smplr)['"]/m`.

- [ ] **Step 2: Run them and see them fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/studio-phase0`
Expected: the new files FAIL.

- [ ] **Step 3: Install the dependencies and implement the three modules.** Then check licences: list the tree with `npm ls --all tone smplr`, and read the `license` field of each package's `node_modules/<pkg>/package.json`. Every entry must be MIT, ISC, BSD or Apache-2.0.

- [ ] **Step 4: Run the tests and typecheck**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/lib/studio-phase0 && npx tsc --noEmit`
Expected: PASS, and tsc clean.

- [ ] **Step 5: Commit**

`git commit -m "feat(studio-phase0): WAV encoder, gamaka curves, Tone+smplr render engine"`

---

### Task 6: The page

**Files:**
- Create:
  - `src/app/(admin)/admin/music-lab/studio-test/page.tsx`: a thin shell, `export const dynamic = 'force-dynamic'`, `metadata.title = 'Studio listening test'`.
  - `src/components/admin/music/StudioPhase0.tsx`
  - `src/lib/studio-phase0/client.ts`
- Modify: `src/app/(admin)/AdminLayoutClient.tsx`: add a title and subtitle for the route to the per-route map, not the sidebar.
- Test: `__tests__/components/StudioPhase0.test.tsx`, `__tests__/lib/studio-phase0/client.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `adminFetch`; `uploadToWorkspace(file, onProgress, signal)` from `@/lib/mastering-upload-client`.
- Produces (in `client.ts`):
  - `fetchKey: FetchKey`: GET `/api/admin/mastering/download?mode=play&key=…`, then `fetch(url)` and `arrayBuffer()`. It throws with the route's `error`.
  - `measureLufs(key: string): Promise<number>`: POST `/api/admin/music-lab/measure` with `{ s3Key: key }`, returning `metrics.lufs`.
  - `loadResults(): Promise<Results | null>` and `saveResults(r: Results): Promise<void>`, against the Task 4 route.
  - `workerProbe(): Promise<boolean>`: build `new Worker(URL.createObjectURL(new Blob(['postMessage(1)'])))`, then resolve `true` on the message, or `false` on a synchronous throw, an `error` event, or no message within 1 s.

**Screen (in order):**
1. **Probe.** When `workerProbe()` is false, show only: *"This page needs a fresh load to get its security settings. Reload this page."* with a **Reload** button (`location.reload()`). Load nothing else.
2. **Load.** Fetch the manifest, every `pack.json` and its samples, and every `notes.json`, with one progress line per item. An error shows in its own line.
3. **Lines.** A **Play live** / **Stop** button per line × pack, labelled with the line id and pack id. This section is for checking playback and the CSP, not for judging, so ids may show here.
4. **Prepare trials.** One row per trial, in shuffled order, labelled *Trial n*:
   - steps: render → upload as `studio-phase0-<trialId>.wav` → measure render and stem;
   - status and error stay **in that row**, with a **Retry** for the failed step;
   - results save after each row completes.
5. **Listen.** Show *Trial n of 18*, the instrument family, and `MasteringComparePlayer` with `labels={{ a: 'A', b: 'B' }}`:
   - `sourceKey` is the A file and `masterKey` the B file, chosen by `renderSide`;
   - `beforeLufs` and `afterLufs` follow the same order.
   - **Below the player:** a 1–5 radiogroup each for *A* and *B*, *Which one is Suno?* (A / B / Can't tell), a note limited to 200 characters, and **Save**.
   - **Save** maps the A and B scores to `renderScore` and `sunoScore` via `renderSide`, calls `addRating`, then `saveResults`.
   - **After saving**, the trial is revealed: *"A was the render (VSCO 2 CE)"*. It shows **Change rating**, which records a revised rating.
6. **Summary.** When every trial has a rating, show the `verdict()` tables, every A/B mapping, and the CSP violation count.

**Violation listener:** `document.addEventListener('securitypolicyviolation', …)` is set up on mount. It lists `violatedDirective` and `blockedURI` in a visible panel, so a count of 0 is visible too.

**Resume:** on load, `loadResults()`. If results exist, reuse their `seed`, `order` and sides, and skip trials whose `renderKey` and both LUFS are set. Only when no results exist does it make a seed (`crypto.getRandomValues(new Uint8Array(8))` as hex) and call `newSession`.

- [ ] **Step 1: Write the failing tests** (mock `client.ts`, `engine.ts` and the player; assert inside the page section, not just on `document`)
  - `shows only the reload prompt when the worker probe fails, and never fetches the manifest`.
  - `a failed measure shows its error in that trial's row, other rows complete, and Retry re-measures only that trial`.
  - `during a trial nothing names the source, line id, pack id or key`: the text in the listen section has no `/fluidr3|vsco|vcsl|F1|V1|P1|studio-phase0-|audio\/mastering/i` before Save.
  - `Save maps A/B scores through renderSide`: with renderSide `'B'`, A=4 and B=2 save as renderScore 2 and sunoScore 4.
  - `after Save the trial is revealed and Change rating records revised: true`.
  - `reopening with saved results resumes the same order and does not call newSession`.
  - `client.workerProbe resolves false when new Worker throws`, in `client.test.ts`.

- [ ] **Step 2: Run them and see them fail**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest __tests__/components/StudioPhase0.test.tsx __tests__/lib/studio-phase0/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the page, component and `client.ts`.** Load the engine with `await import('@/lib/studio-phase0/engine')` inside handlers.

- [ ] **Step 4: Run the full gate**

Run: `NODE_OPTIONS=--no-experimental-strip-types npx jest && npx tsc --noEmit && npx eslint .`
Expected: all green.

- [ ] **Step 5: Check the bundles.** Run `npx next build` on `master` and on the branch, and save each route table. In both, the **First Load JS** for `/`, `/songs`, `/content/[id]` and `/stories` must be identical. Any difference is a bug: find the static import.

- [ ] **Step 6: Commit and open the implementation PR**

`git commit -m "feat(studio-phase0): blind listening-test page at /admin/music-lab/studio-test"`. Merge on Raj's yes; merging deploys the site, with no worker deploy.

---

### Task 7: Dev-box data (no repo code)

Runs in `~/studio-phase0/` on the dev box. It can run alongside Tasks 1–6. Nothing from this task is committed: the note data and the song identity stay private.

- [ ] **Step 1: Packs.**
  - Shallow-clone or sparse-checkout only the needed folders:
    - `sgossner/VSCO-2-CE`: `Woodwinds/Flute/susvib`, `Strings/Solo Violin/Arco Vib`;
    - `sgossner/VCSL`: `…/Frame Drum`, `…/Darbuka`.
  - Download `gleitz/midi-js-soundfonts` `FluidR3_GM/flute-mp3.js` and `violin-mp3.js`.
  - Convert WAVs with `ffmpeg -i in.wav -ar 48000 -c:a flac out.flac`.
  - **Mapping:** map each sample to MIDI from its filename; for percussion pick one `low` and one `high` hit by rule, not by ear: the lowest and highest spectral centroid among the open hits.
  - **Per pack:** write `pack.json` (shape `PackFile`, Task 5) and `PROVENANCE.md`, with source repo + commit SHA, source paths, licence and attribution text, and the conversion.
  - **Check:** every `pack.json` passes a one-off zod parse via `npx tsx`, against the Task 5 type.

- [ ] **Step 2: Stem cuts.** For the 8 lines (spans in spec Section 1, snapped to the nearest zero crossing within ±50 ms), cut from candidate A's raw stems with `ffmpeg -ss <start> -t <dur> -af "afade=t=in:d=0.02,afade=t=out:st=<dur-0.02>:d=0.02" -ar 48000 -c:a pcm_s16le stem.wav`. Percussion lines P1 and P2 are 8 bars, from the beat grid `librosa.beat.beat_track` finds.
- [ ] **Step 3: Transcribe.**
  - **Install:** `python3 -m venv ~/venv-basic-pitch && ~/venv-basic-pitch/bin/pip install basic-pitch librosa`, isolated like `~/venv-demucs`.
  - **Melodic lines:** run `basic-pitch` on each melodic `stem.wav`, convert the MIDI to `notes.json` (`LineNotes`), then correct it against `librosa.pyin`:
    - fix octave errors (|Δ| = 12);
    - merge notes split by vibrato (same pitch, gap < 40 ms);
    - drop notes < 60 ms with vel < 30.
  - **Gamaka curves (F1, V1):** set `detuneCurve` from pyin's f0 relative to the note's MIDI pitch, in cents, sampled at 50 Hz.
  - **Percussion:** `librosa.onset.onset_detect` with `backtrack=True`. Classify each onset by spectral centroid against the line's median: below means `midi 48`, otherwise `72`. Velocity comes from onset strength, scaled to 30–127.
- [ ] **Step 4: Manifest and upload.**
  - Write `manifest.json` (shape `Manifest`) and validate it with `parseManifest` via `npx tsx`.
  - Upload:
    - `aws s3 cp --recursive packs/ s3://tamil-web-media/audio/mastering/studio-samples/ --region us-east-1`;
    - the lines and manifest go to `s3://tamil-web-media/audio/mastering/studio/phase0/`.
- [ ] **Step 5: Verify.**
  - `curl -s -o /dev/null -w '%{http_code}' https://d2cdoh43143xxa.cloudfront.net/audio/mastering/studio-samples/vsco2-flute/pack.json` prints `403`.
  - `aws s3 ls --recursive …/studio-samples/ --summarize` shows the total size, recorded for the exit report.

---

### Task 8: Deployed verification, listening session, exit report

- [ ] **Step 1: Headers before.** Before the implementation PR merges, for `P` in `/ /songs /content/<any live id> /stories`:

```
curl -sI "https://tamilagaval.com${P}?cb=$(date +%s%N)" | grep -iE '^(content-security-policy|permissions-policy|strict-transport-security|x-frame-options|referrer-policy|x-content-type-options):' | sort > before${P//\//_}.txt
```

- [ ] **Step 2: Headers after.** After the deploy, the same command writes `after*.txt`, and `diff` on each pair is empty. On a signed-in hard load of `/admin/music-lab/studio-test`, the document's response headers in Chrome DevTools → Network show `worker-src 'self' blob:`. Unauthenticated curl only sees the middleware's redirect to `/login`.
- [ ] **Step 3: In-browser.** Hard-load the deployed page in desktop Chrome:
  - every line × pack plays live;
  - all 18 trials prepare;
  - the violation panel reads 0.

  Then reach the page from `/login` and confirm the reload prompt appears.
- [ ] **Step 4: Raj listens.** Send him the link. Ask him to open it in a fresh tab, with a full load. About 40 minutes. Do not change the page while he tests.
- [ ] **Step 5: Exit report.** Read `results.json`, and add the **Phase 0 results** section to the assessment doc (https://claude.ai/artifact/1qcdrq4n3xVfj4nsnLYy6h):
  - the song and spans;
  - reverb settings;
  - the ratings table;
  - per-instrument verdict and passing source;
  - gamaka comparison;
  - Suno hit rate;
  - header diff and violation count;
  - overall verdict and what it changes;
  - attribution lines.
- [ ] **Step 6: Cleanup PR** (after the report). Remove:
  - the page;
  - `StudioPhase0.tsx`;
  - `src/lib/studio-phase0/`, with their tests;
  - the results route;
  - both dependencies.

  Keep:
  - the player's `labels` prop;
  - the `/admin` CSP scope, only if Phase 1 is approved; otherwise revert Task 1 too.

  The S3 data stays unless Raj asks for it to be deleted.
