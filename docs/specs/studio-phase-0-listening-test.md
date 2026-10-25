# Composition Studio Phase 0: listening test (design)

**Date:** 2026-10-25
**Status:** Raj made the three choices on 2026-10-25: **candidate A**, the **basic-pitch draft** input, and **three instruments**. Awaiting review of this written spec. Nothing is built until it is merged.
**Scope:** Phase 0 of the Composition Studio only. It answers one question: *do shippable, freely licensed samples, played in the browser, sound good enough to be worth building Phases 1–3?* The Phase 1 data model, API and UI are out of scope.

## Purpose

The feasibility assessment (a private Claude Doc, linked from the PR) found the studio is buildable on the current stack. It also found that output quality depends on the **instrument samples**, not the code. Phase 0 tests that cheaply before any studio code exists:

1. Render a few lines of one existing Tamilagaval melody in the browser, on three instruments, from samples we are allowed to ship.
2. Raj compares each render **blind** against the same part of the song's Suno stem, loudness-matched.

**Pass:** both of these hold:
- Raj rates the render acceptable (defined in *Rating and verdict*) for **at least 2 of 3 instruments**.
- The page plays on the **deployed** admin under the **production** security headers, with zero CSP violations.

**Fail:** Modules 1–3 wait for better samples, not more code. The exit report says which instrument failed and why.

### Constraints carried from the brief

- No new AWS service, no worker deploy, no change to `master-worker`.
- Desktop Chrome only.
- `COMPOSITION#<id>/METADATA` is not touched. Phase 0 writes nothing to DynamoDB.
- Everything built here is throwaway. A cleanup PR removes it after the exit report (see *Cleanup*).

### A note on what this public document leaves out

This repo is public. The spec names candidate songs only as **A, B and C**, and does not describe any song's arrangement. The titles behind A to C are given to Raj directly, never on GitHub. The exit report in the private assessment doc records the song that was used. Melody transcriptions (note data) also live in the private S3 workspace, never in the repo.

## Section 1: Melody choice

### What exists today

The brief assumed songs with `STEMSET#` records in the stem library. **There are none yet.** The stem library shipped in #387/#388 but no stem set has been uploaded. The only Suno multitrack exports in S3 are two raw batches uploaded for the September karaoke orders, as plain workspace files under `audio/mastering/`.

Suno names stems by family (`Woodwinds`, `Strings`, `Percussion`), not by instrument. This spec treats a `Woodwinds` stem as the flute reference and a `Strings` stem as the violin reference. Raj can override either.

Activity was measured on 2026-10-25 with ffmpeg `silencedetect` (seconds of sound above the threshold; the rest is silence):

| Candidate | Woodwinds stem | Strings stem | Percussion stem | Usable lines |
| --- | --- | --- | --- | --- |
| **A** (2026-09-18 batch, 11 stems) | 161 s at −45 dB; long phrases at 0–32 s, 76–100 s, 191–220 s, 296–317 s | 38 s at −45 dB, 55 s at −60 dB; one 9 s phrase (27–36 s), one 6 s phrase (122–128 s), the rest 2–4 s fills | 390 s, plays through | Flute: plenty. Violin: two short phrases and one fill. Percussion: plenty. |
| **B** (2026-09-14 batch, 9 stems) | none | 10 s at −45 dB, 13 s at −60 dB | 285 s | Percussion only. Not a three-instrument candidate. |
| **C** (new export) | depends on the song | depends on the song | depends on the song | Raj picks a song with a sustained string line and exports its multitracks from Suno (Studio → Export → Multitracks), then uploads them through `/admin/mastering/bulk`. About 10 minutes of his time. |

### Recommendation

**A.** It is the only existing batch that covers all three instruments. The violin side is thin: two phrases of 6–9 s and one 4 s fill. That is enough to hear whether a sampled violin holds up, but not a long melodic line. If Raj thinks the violin test needs a longer line, he can use **A for flute and percussion and C for violin**. That costs one export, and the method below is unchanged.

Raj confirms before anything is cut.

### The lines

A **line** is one phrase cut from the stem. Proposed for candidate A (final spans are chosen at a zero crossing near these times):

| Instrument | Line | Span (approx.) |
| --- | --- | --- |
| Flute | F1 | 0–14 s |
| Flute | F2 | 76–90 s |
| Flute | F3 | 191–205 s |
| Violin | V1 | 27–36 s |
| Violin | V2 | 122–128 s |
| Violin | V3 | 217–221 s |
| Percussion | P1 | 8 bars from the first verse |
| Percussion | P2 | 8 bars from an interlude |

## Section 2: Instruments and sample sources

Only sources whose licence allows redistribution, including commercially, qualify, because a browser sampler ships its samples to the browser. The assessment's **Do not use** list applies in full:
- nothing under GPL, AGPL or LGPL (for example webaudiofont);
- no non-commercial licence (for example the Saraga data, or madmom's models).

| Pack id | Source | Articulation | Licence | Attribution required | Approx. size |
| --- | --- | --- | --- | --- | --- |
| `fluidr3-flute` | FluidR3_GM, MIDI.js web build (gleitz/midi-js-soundfonts) | GM flute | Font: MIT (Frank Wen). Rendered web build: CC BY 3.0, per the repo README | Yes (CC BY 3.0) | 3 MB |
| `fluidr3-violin` | same | GM violin | same | Yes | 3 MB |
| `vsco2-flute` | VSCO 2 CE (sgossner/VSCO-2-CE) | `Woodwinds/Flute/susvib` | CC0 | No (credited anyway) | 25 MB WAV |
| `vsco2-violin` | VSCO 2 CE | `Strings/Solo Violin/Arco Vib` | CC0 | No (credited anyway) | 74 MB WAV |
| `vcsl-frame-drum` | VCSL (sgossner/VCSL) | `Membranophones/Struck Membranophones/Frame Drum` | CC0 | No (credited anyway) | to be measured |
| `vcsl-darbuka` | VCSL | `…/Darbuka` | CC0 | No (credited anyway) | to be measured |

### What VCSL does not have

The full VCSL tree was listed on 2026-10-25. It has **no tabla, no mridangam, and no other Indian drum.** The nearest hand drums are frame drum, darbuka, conga and bongos. Frame drum and darbuka are tested as the two percussion sources.

Expect percussion to be the weakest instrument. The test measures **how far off** a non-Indian hand drum is, not whether it matches. A percussion fail is still useful: it says Indian percussion needs recorded or commissioned samples, which the assessment already lists as a decision.

### Excluded

`Tabla.sf2` in the same gleitz repository is excluded. The repo's MIT licence covers the repo, not that third-party font, and the README states no licence or origin for it. It can be reconsidered only if its origin and licence are traced.

### Provenance note

Each pack folder holds a `PROVENANCE.md` with:
- source repository and commit;
- the exact source paths;
- licence and attribution text;
- any conversion done (WAV → 48 kHz FLAC, lossless, to halve the size).

The exit report repeats the attribution lines. If any of these samples is used later, the same attribution goes on the release.

### Storage

Packs are uploaded from the dev box with the AWS CLI to `audio/mastering/studio-samples/<packId>/`. This prefix is under `audio/mastering/`, which gives it three protections:

- The bucket policy statement `DenyCloudFrontOnMasteringWorkspaceAndReferences` blocks CloudFront from it. Checked 2026-10-25: an existing `audio/mastering/` object returns **403** through `d2cdoh43143xxa.cloudfront.net`. The acceptance checks repeat this against a real pack file.
- `isMasteringKey` already accepts it, so the existing presigned play route serves it with no new route.
- The workers' IAM role (`music-lab-s3-takes`) already covers it. Phase 0 needs no IAM change.

Each pack has a `pack.json` that lists its samples (note → file) and repeats the licence. The page fetches `pack.json` and every sample through `GET /api/admin/mastering/download?mode=play&key=…`: admin-only, presigned, short-lived. The bucket's CORS already allows `https://tamilagaval.com` and the Amplify domain to `GET`.

## Section 3: Melody input

Each line needs a note list whose timing matches the stem. The A/B player switches between the two clips **at the same instant**, so a render that drifts from the stem by even a fraction of a beat makes the comparison meaningless. **Time alignment decides this choice.**

| Option | How | Alignment | Cost |
| --- | --- | --- | --- |
| **1. Hand-entered JSON** | Someone listens to the stem and types notes and durations. | Poor. Typed timing must then be nudged to the stem by ear, note by note. | Raj's ear-time, about 1–2 h per instrument. I cannot transcribe by ear. |
| **2. basic-pitch draft, then corrected** *(recommended)* | Run Spotify's `basic-pitch` (Apache-2.0) on each stem line on the dev box, in an isolated venv like `~/venv-demucs`. It writes MIDI with times measured from the stem itself. I convert it to the line's `notes.json`, then correct it against a `librosa.pyin` pitch track of the same stem: wrong octaves, split or merged notes, ghost notes. | Exact by construction: times come from the stem. | About 1 GB venv on the dev box, seconds to run, and 1–2 h of my correction time in total. Raj's time is zero until he listens. |

**Percussion is different.** basic-pitch does not transcribe drums. For P1 and P2:
- detect onsets with `librosa.onset` (ISC licence);
- sort each hit into **low** or **high** stroke by spectral centroid;
- map low and high to the pack's two most fitting samples.

Exact stroke names (for example *tha*, *dhi*, *thom*) are beyond Phase 0. The test is whether the **sound** passes, and a crude stroke map is enough to hear that.

**Gamaka.** The pyin pitch track also gives the stem's real pitch movement. For one flute line (F1) and one violin line (V1), a second render applies that movement, smoothed, as `detune` automation. This tests directly whether pitch curves on samples sound mechanical. Note: smplr's per-note `detune` is fixed for the whole note. Gamaka notes therefore play through a small custom voice: an `AudioBufferSourceNode` with `detune.setValueCurveAtTime`, using the same decoded buffers. That smplr cannot do this is itself a finding for Phase 1.

**Format (throwaway).** `notes.json` is `{ lineId, durationSec, notes: [{ t, dur, midi, vel, detuneCurve? }] }`. Times are seconds from the line's start. This is **not** the Phase 1 schema, and nothing else reads it.

Transcriptions go to `audio/mastering/studio/phase0/lines/<lineId>/notes.json`, next to that line's stem cut, `stem.wav`. The stem cut is made on the dev box with ffmpeg:
- 48 kHz, 16-bit;
- 20 ms fade in and out;
- the exact span recorded in `manifest.json`.

## Section 4: Playback and rendering

- **Libraries:**
  - `tone@15.1.22` (MIT): clock, Transport, `Tone.Reverb`, `Tone.Offline`.
  - `smplr@1.1.0` (MIT, no runtime dependencies): sample playback.
  - Both are pinned exact.
- **One AudioContext.** smplr instruments are created on `Tone.getContext().rawContext`, so live playback runs on one context.
- **Live play.** Each line has a **Play live** button. It schedules the line on Tone's Transport through smplr. This is the path that exercises Tone's clock Worker under the CSP (Section 6).
- **Render (bounce).** `Tone.Offline` renders each line at **48 kHz, stereo**, to exactly the stem cut's `durationSec`, so both clips have the same length.
  - smplr instruments are rebuilt on the offline context from **already-decoded buffers**. smplr 1.x accepts a `BaseAudioContext` and pre-decoded `buffers`, so nothing is fetched twice.
  - The result is encoded as a 16-bit PCM WAV in the browser.
- **Reverb.** Suno's stems carry their own reverb, and a dry sample against a wet stem is an unfair test. Every render gets the same `Tone.Reverb`: a convolution reverb, decay 2.0 s, wet 0.2. The settings are fixed in code and noted in the exit report.
  - **Not allowed:** Tone's AudioWorklet-based nodes (`FeedbackCombFilter`, `Freeverb`, `JCReverb`, `BitCrusher`), and smplr's `Reverb`, which loads a Dattorro AudioWorklet. They load their processors from a `blob:` URL that the production `script-src` rightly blocks. Avoiding them keeps `script-src` untouched.
- **What gets rendered.** One render per line per source:
  - flute: 3 lines × 2 sources;
  - violin: 3 lines × 2 sources;
  - percussion: 2 lines × 2 sources;
  - plus 2 gamaka variants (F1, V1, VSCO source).

  That is **18 renders**.
- **Bundle isolation.** Tone and smplr are loaded with a dynamic `import()` inside the Phase 0 component only. Public routes must not grow. See the acceptance checks.

## Section 5: Where it runs

- **Page:** `src/app/(admin)/admin/music-lab/studio-test/page.tsx`. It sits under `/admin`, so it is gated like every admin page. Every API call it makes goes through routes that call `requireAdmin` (+ `requireBearer` on writes). It is not added to the sidebar menu. Raj opens it from a link in the PR and the exit report.
- **Component:** `src/components/admin/music/StudioPhase0.tsx`, with pure helpers in `src/lib/studio-phase0/`: WAV encoding, trial shuffling, and gamaka curve smoothing.
- **Existing routes reused, unchanged:**
  - `GET /api/admin/mastering/download?mode=play`: presigned reads of packs, manifest, notes and stem cuts;
  - `POST /api/admin/mastering/upload` (kind `audio`): upload each render WAV into the mastering workspace. The filename is `studio-phase0-<trialId>.wav`, so the key is easy to recognise. Nothing in the app lists `audio/mastering/` from S3: Sound Engineering and its pickers list saved jobs from DynamoDB, and the only S3 listing is the references prefix. So the renders appear in no admin list;
  - `POST /api/admin/music-lab/measure`: integrated loudness of each render and stem cut, through the existing `measure-fn` Lambda. Its role already reads `audio/mastering/*`.
- **One new route:** `GET` and `PUT /api/admin/music-lab/studio-phase0/results`.
  - It reads and writes one JSON object at the fixed key `audio/mastering/studio/phase0/results.json`. The bucket is versioned, so every save is kept.
  - Admin-only, and `PUT` also requires a bearer token.
  - The body is validated with zod, and capped at 256 KB.
  - The route accepts no key from the client.
- **No DynamoDB writes.**

### Flow on the page

1. **Load.**
   - Fetch `manifest.json`, then every pack and every `notes.json`.
   - Show load progress.
   - Show any failure inline, next to the step that failed, not only in the global banner.
2. **Prepare trials.**
   - Render all 18 clips.
   - Upload each render.
   - Measure render and stem cut.
   - One progress row per trial, with its error in that row.
3. **Listen** (Section 7). The ratings autosave to the results route after every trial.
4. **Summary.** After the last trial the page reveals every A/B mapping and shows the per-instrument verdict table, ready to copy into the exit report.

## Section 6: Security headers

### Findings (from reading the pinned packages, 2026-10-25)

| Package | What it does | What the production CSP does to it today |
| --- | --- | --- |
| Tone 15.1.22, `Ticker` | Builds its clock as `new Worker(blob:…)`. It falls back to a `setTimeout` clock if construction throws. | There is no `worker-src`, so it falls back to `script-src 'self' 'unsafe-inline' …`, which has no `blob:`, so the Worker is **blocked**. At best, Tone silently drops to the timeout clock, which Chrome throttles in background tabs. At worst, the violation is reported asynchronously, the fallback never runs, and the Transport never ticks. |
| Tone 15.1.22, `ToneAudioWorklet` | `audioWorklet.addModule(blob:…)` | Governed by `script-src`, so blocked. Avoided by design (Section 4). |
| smplr 1.1.0, `Reverb` | `audioWorklet.addModule(blob:…)` | Same; avoided. |
| smplr 1.1.0, other code | Uses `URL.createObjectURL` only for a download helper. No `eval`, `new Function`, WebAssembly or Worker. | No effect. |
| Either package | No WebAssembly anywhere. | `wasm-unsafe-eval` is **not needed**. |

### The change

- Add `worker-src 'self' blob:` for `/admin` only. Nothing else changes: not `script-src`, not `wasm-unsafe-eval`, not COOP/COEP, not `Permissions-Policy`. Phase 0 records nothing, so `microphone=()` stays.
- **How it is scoped:**
  - `buildContentSecurityPolicy(nodeEnv, { scope: 'admin' })` returns the current policy plus that one directive.
  - The public policy is built by the same function with the default scope, so its string is unchanged.
  - `next.config.ts` adds an `/admin/:path*` entry **after** the existing `/:path*` entry. In Next.js, a later matching entry that sets the same header key overrides the earlier one.
- **Tests (jest):**
  - The public policy string is pinned **byte for byte** to today's value.
  - The admin policy equals the public policy plus `; worker-src 'self' blob:`.
  - The `headers()` output is checked: `/admin/...` gets the admin policy, while `/`, `/songs` and `/content/x` get the public one.

### Verifying on the deployed site

Before and after the deploy, run `curl -sI "https://tamilagaval.com/<path>?cb=<unique>"` for `/`, `/songs`, a `/content/<id>` page and `/stories`. Then diff the `content-security-policy`, `permissions-policy`, `strict-transport-security`, `x-frame-options`, `referrer-policy` and `x-content-type-options` lines.
- The diff must be **empty**.
- The `?cb=` value is unique per request so CloudFront cannot return a cached copy.
- The same curl on `/admin/music-lab/studio-test` must show the added directive.

The **CSP behaviour** check runs only on the deployed site. `next dev` adds `'unsafe-eval'` and drops `upgrade-insecure-requests`, so a dev-server pass proves nothing. **Load the page with a full page load.** A CSP applies to the page that was loaded, and Next's client-side navigation fetches no new headers. Arriving from `/login` (which returns with `router.push`) or from a public page leaves that page's CSP in force, without `worker-src`. So the page checks, before loading anything, that a `blob:` Worker can start. If it cannot, it shows *"Reload this page"* and stops, instead of failing later in a way that looks like a library bug.

The page installs a `securitypolicyviolation` listener that lists every violation on the page itself. Acceptance means **zero** violations:
- after **Play live** has run every line;
- after **Prepare trials** has rendered all 18 clips.

## Section 7: Blind A/B method

**Player.** The existing `MasteringComparePlayer` is used as-is, except for one optional prop, because its button labels (*"A · Before (source)"*, *"B · After (master)"*) and its true-levels note (*"the master … will sound louder"*) would give the answer away:

- `labels?: { a: string; b: string; levelNote?: string }`: when set, the buttons read *A* and *B*, and the note under the buttons is neutral.
- Unset, the player is **exactly** as it is today. It is shared with Sound Engineering, so a test pins the defaults.
- Loudness matching stays on by default and uses the measured LUFS of both clips (`matchGains`). The true-levels toggle is hidden in blind mode.

**Randomising and hiding.**

- **Trial order:** Before the first trial, a Fisher–Yates shuffle orders the 18 trials. It is seeded from `crypto.getRandomValues`, and the seed is stored in the results.
- **Side assignment:** For each trial, a fresh random bit decides whether the render is A or B. It is stored in the results but **not shown** until the trial's ratings are saved.
- **What the page shows during a trial:** only *Trial n of 18*, the instrument family (it is audible anyway), and the player. It never shows the source, the line id, the file name or the key. Upload keys are not rendered on the page.
- **Correcting a rating:** Once saved, a trial reveals which side was the render. That trial can no longer be re-rated blind. A correction is recorded as a new rating with `revised: true`, and the first rating is kept.

**What Raj records per trial.** Raj rates **both** clips on the same scale. The Suno stem is the anchor:

| Score | Meaning |
| --- | --- |
| 1 | Unusable |
| 2 | Clearly synthetic, would not ship |
| 3 | **Acceptable**: would ship in a mix |
| 4 | Good |
| 5 | Cannot fault it |

He also records:
- **Which one is Suno?** A, B, or can't tell;
- an optional one-line note.

### Rating and verdict

- A **render line passes** when its render scores **≥ 3**.
- A line is **excluded** when Raj scores its Suno stem **below 3**: the reference itself is not acceptable there. Exclusions are listed in the report.
- An **instrument + source passes** when at least half of its remaining lines pass. With 3 lines that means 2. With 2 lines it means both.
- An **instrument passes** when **either** of its sources passes. The report records which source passed. FluidR3 (about 3 MB) against VSCO (about 25–75 MB) is the real Phase 1 sample-size decision.
- **Gamaka** variants do not count toward the verdict. The report sets each one beside its straight render of the same line: same, better or worse.
- **Phase 0 passes** when at least 2 of 3 instruments pass **and** the deployed checks in Section 6 are clean.
- The "Which one is Suno?" hit rate is reported for information. A hit rate near chance, with renders scoring at least 3, is the strongest possible result.

## Section 8: Cost

| Item | Estimate |
| --- | --- |
| S3: packs (~0.2–0.3 GB as FLAC), stem cuts and renders (~0.1 GB). Doubled by the same-region DR replication. | under US$0.02 a month |
| `measure-fn`: about 26 short invocations (18 renders + 8 stem cuts), plus re-runs | under US$0.05 |
| Amplify builds: spec PR, plan PR, 1–2 implementation PRs, cleanup PR (~US$0.09 each) | about US$0.45 |
| Data transfer to Raj's browser (~0.5 GB once) | about US$0.05 |
| **Total** | **under US$1**, inside the brief's US$1–3 |

No new service, no paid API, no worker deploy.

## Section 9: Exit report

When Raj has finished, a **Phase 0 results** section is added to the feasibility assessment doc. It is a short section:

- **Song and lines:** the song (by title, since the doc is private), each line's span, and the reverb settings.
- **Ratings table:** one row per trial, with instrument, source, line, render score, Suno score, the Suno guess and the note.
- **Per-instrument verdict:** which source passed, if any.
- **Gamaka result:** for F1 and V1.
- **Header check:** the curl diff (expected empty) and the violation count (expected 0).
- **Overall verdict:** pass or fail, and what it changes in the roadmap:
  - If it passes, Phase 1 planning starts with the source that passed as the default pack.
  - If it fails, the failing instrument's sample source becomes the blocking decision.
- **Attribution lines:** for the packs used.

`results.json` stays in S3 as the raw record.

## Acceptance checks

1. Every pack has a `PROVENANCE.md`, and no pack file is reachable through CloudFront: `curl` on a real pack key through `d2cdoh43143xxa.cloudfront.net` returns 403.
2. `npm ls` shows only `tone@15.1.22` and `smplr@1.1.0` as new direct dependencies. Neither package, nor anything they pull in, is GPL, AGPL, LGPL or non-commercial.
3. The jest suite passes, including the CSP pins and the player's default-labels test.
4. The `next build` route table shows **no change in First Load JS** for public routes against `master`.
5. The deployed header diff on public pages is empty. The admin page carries `worker-src 'self' blob:`.
6. On the deployed admin, in desktop Chrome, on a **hard load** of the page:
   - all lines play live;
   - all 18 renders complete;
   - the page lists **zero** CSP violations.
7. Raj completes all 18 trials, and `results.json` contains them.

## Delivery

- **Spec PR:** this document. Merging it is approval.
- **Plan PR:** the task breakdown, written after merge.
- **Execution:**
  - **Dev box (no repo code):** sample packs, stem cuts, transcriptions and `manifest.json`, uploaded with the AWS CLI;
  - **One implementation PR:** the CSP scope, the player's `labels` prop, the page, the helpers and the results route, all test-first.
- **Raj's listening session:** about 40 minutes for 18 trials.
- **Timing:** about 2 working days from plan approval to Raj's listening session.

### Cleanup

After the exit report, a cleanup PR removes:
- the page and component;
- the helpers;
- the results route;
- the two dependencies.

It keeps:
- the player's `labels` prop, which is small and tested;
- the `/admin` CSP scope, **only if** Phase 1 is approved. Otherwise it reverts too.

The S3 folders (`studio-samples/`, `studio/phase0/`) stay. They are small, and Phase 1 would reuse the packs. Raj can ask for them to be deleted.

## Out of scope

- The Phase 1 schema (`STUDIO`, `STUDIOVER#`), the project JSON, the piano roll and the Transport UI.
- Any change to `master-worker`, `compose-worker` or other workers, and any worker deploy.
- Safari, Firefox and mobile.
- Recording, the microphone and `Permissions-Policy`.
- Commissioning or recording Indian instrument samples. That is the decision a percussion fail would lead to.
- Publishing anything. No Phase 0 audio leaves the private workspace.

## Decisions for Raj

**Answered 2026-10-25:**
1. Candidate A.
2. Option 2, the basic-pitch draft.
3. No fourth instrument.

The questions as they were asked:

1. **Melody.**
   - **A** (recommended);
   - **A for flute and percussion, with C for violin** (needs one Suno multitrack export of a song with a longer string line);
   - or another song he prefers.
   - The chosen song's `Woodwinds` and `Strings` stems become the flute and violin references, unless Raj says either doesn't suit. The blind trials would expose a mismatch anyway.
2. **Melody input.** Option 2, a basic-pitch draft corrected by me (recommended), or option 1, hand-entered.
3. **A fourth instrument?**
   - VSCO 2 CE also has clarinet, oboe and bassoon. VCSL has more percussion.
   - Neither has an Indian melodic instrument (veena, nadaswaram, bansuri). No freely licensed, shippable source for those was found.
   - Each extra instrument adds about 6 trials, about 15 minutes of listening.
