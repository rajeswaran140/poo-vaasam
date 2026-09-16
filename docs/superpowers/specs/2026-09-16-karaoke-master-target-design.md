# Karaoke as a first-class mastering target — design

**Status:** proposed
**Date:** 2026-09-16
**Author:** Raj + Claude

## The problem

Karaoke is the only thing Tamilagaval sells, and it is the only audio format
that lives entirely outside the mastering pipeline. The Sevvanthi bed was built
by hand with ffmpeg on `crowvault-ide-server`: there is no `MASTERJOB#` record,
nothing in Saved masters, no archive copy, and no provenance. If the file is
lost, or a buyer asks for a re-delivery in six months, there is nothing to go
back to.

It was done by hand for a good reason. Running a karaoke bed through the
mastering pipeline pushes it to −14 LUFS, which removes the headroom a live
voice needs and compresses the bed. The `karaoke-from-stems` admin doc already
names the fix: *"a 'keep current loudness' target in the mastering pipeline:
peak-normalise to −1 dBTP, no loudness matching."*

## Evidence

Measured on `~/albums/karaoke/sevvanthi/karaoke-clean.wav` (the bed as built),
2026-09-16:

| | Integrated | LRA | True peak |
|---|---|---|---|
| **The bed as built** | −20.2 LUFS | **6.4 LU** | −1.0 dBTP |
| Peak-only to −1 dBTP | −20.2 LUFS | **6.4 LU** | −1.0 dBTP |
| loudnorm → −18, `linear=true` | −17.3 | 6.2 | −0.9 |
| loudnorm → −20, `linear=true` | −19.3 | 6.2 | −1.0 |
| loudnorm → −14 (what shipped) | −14.0 | **5.8** | — |

Three findings decide the design:

1. **loudnorm reports `Normalization Type: Dynamic` even when `linear=true` is
   requested** — at −14, −18 and −20 alike. There is no integrated target at
   which the current pipeline leaves a bed's dynamics alone. The obvious cheap
   fix ("just master karaoke at −18") does not work.
2. **loudnorm misses the target it is given** on this material: asked for −18 it
   delivered −17.3; asked for −20, −19.3.
3. **The bed was built at exactly −1.0 dBTP**, so peak-only normalisation is a
   no-op on it and preserves −20.2 LUFS / 6.4 LU byte-for-byte. A bed that is
   already correct must come out unchanged, and peak-only is the only option
   tested that does.

A second defect surfaced while measuring. `buildMp3Args` defaults to
`MP3_BITRATE = '192k'`, but `KARAOKE_DELIVERABLE` promises buyers **"320 kbps
MP3"** and the hand-made Sevvanthi file is 320 kbps. Karaoke run through the
pipeline as it stands today would quietly deliver 192k against a published
promise.

## Goals

- A karaoke bed masters through the same pipeline as everything else, producing
  a job record, an archive copy, and a delivery path.
- Its dynamics and integrated loudness are **untouched**. Only peak level moves.
- The delivered MP3 is 320 kbps, matching what buyers are told.
- Nothing about the existing loudness path changes — byte-identical output for
  every job that does not ask for the new mode.

## Non-goals

- **Stem separation in the portal.** The operator produces the bed (Suno stems,
  or an instrumental generation) and uploads a finished WAV, exactly as with any
  other source. Separation stays on the box.
- **A video or YouTube upload for karaoke.** A bed is a deliverable, not a
  release. The render and upload panels must not appear for it.
- **A vertical short from a karaoke bed.** Same reason.
- **Changing the −14/−16 loudness path in any way.**

## The model

Add one field, `normalizationMode`, to the master request and the job record:

```ts
export type NormalizationMode = 'loudness' | 'peak';
```

- `'loudness'` — the existing two-pass loudnorm to an integrated target. The
  default everywhere, so an omitted field means today's behaviour.
- `'peak'` — measure true peak, apply one gain change to land at the ceiling,
  touch nothing else.

`target` stays a number and keeps its `-14` default, so the request shape is
unchanged. In `'peak'` mode it is **recorded and never acted on**: it does not
name the file (`karaokeMasterKeyFor` ignores it), it is not a loudnorm argument,
and the report shows it only as part of the request that was made. The ceiling
is what matters. It is kept rather than made optional so that one field does not
have to become conditional across the route, the job record and the worker
event.

### Why a mode rather than a magic target value

Encoding "karaoke" as a sentinel target (e.g. `target: 0`) would pass
`isValidTarget`, thread silently through `masterKeyFor`, and produce a file
named `-master-0LUFS.wav` that nothing could tell apart from a mistake. A named
mode is checkable at every boundary and reads correctly in the job record.

## Constants

```ts
/** Ceiling for a peak-normalised bed. The house ceiling everywhere else, and
 *  the level the Sevvanthi bed was already built to. */
export const PEAK_CEILING_DBTP = -1.0;

/** A bed needing more boost than this is the wrong file, not a quiet one. */
export const MAX_PEAK_GAIN_DB = 12;

/** Buyers are promised 320 kbps — see KARAOKE_DELIVERABLE in src/lib/karaoke.ts. */
export const KARAOKE_MP3_BITRATE = '320k';
```

## Key naming, and the guard that must not be shared

```ts
export function karaokeMasterKeyFor(s3Key: string): string {
  const stem = s3Key.replace(/\.[a-z0-9]+$/i, '');
  return `${stem}-karaoke-1dBTP.wav`;
}

export function isKaraokeMasterKey(s3Key: string): boolean {
  return /-karaoke-1dBTP\.wav$/i.test(s3Key);
}
```

⚠️ **`isMasterKey` must NOT be extended to match karaoke keys.** It currently
answers two different questions at once:

1. *"Is this already a mastering output?"* — the re-master guard, in
   `src/app/api/admin/music-lab/master/route.ts:65` and
   `worker/master-worker.ts`.
2. *"Is this a valid source for a video / short / YouTube upload?"* — the
   positive requirement in `renderVideo`, `renderShort` and `uploadToYoutube`.

Extending it would satisfy (1) correctly and break (2) by making karaoke beds
eligible for YouTube renders — the opposite of the non-goals above. So:

- **Re-master guards** become `isMasterKey(k) || isKaraokeMasterKey(k)`. A
  karaoke bed must not be re-mastered either.
- **Render / short / upload guards** keep `isMasterKey(k)` alone, unchanged.

`mp3KeyFor` needs no change: it swaps `.wav` for `.mp3` and works on any master
key.

## Route contract

`POST /api/admin/music-lab/master` gains one optional field:

```
{ s3Key, target=-14, normalizationMode?: 'loudness' | 'peak', edit?, join?, ... }
```

- Absent or `'loudness'` → today's behaviour exactly.
- `'peak'` → validated, stored on the job, passed to the worker.
- Any other value → 400, naming the two accepted values.

Reference matching (`referenceId` / `matchingMethod`) is **refused together with
`'peak'`**: matchering exists to move a track's tonal and loudness profile
toward a reference, which is the one thing this mode promises not to do. A
request carrying both is a 400, not a silent preference.

## Worker behaviour

Two passes, mirroring the loudness path's shape so the code reads the same way.

**Pass 1 — measure.** `ebur128=peak=true` over the edited source, output
discarded. Yields true peak, integrated loudness and LRA. All three are stored;
only the peak is acted on.

**Pass 2 — one gain change.**

```
gain = PEAK_CEILING_DBTP - measuredTruePeak
filter = `volume=${gain.toFixed(2)}dB`
```

No `loudnorm`, no limiter, no compressor. Output is `-ar 48000 -c:a pcm_s24le`,
identical to the loudness path's pass 2 (`worker/master-worker.ts:1153`).

**Refusals:**

| Condition | Message |
|---|---|
| true peak unreadable | `the bed's peak level could not be measured` |
| `gain > MAX_PEAK_GAIN_DB` | `this file needs +N dB to reach the ceiling — check it is the right bounce` |
| source is already a master or a karaoke bed | the existing re-master refusal |

A gain of `0.00 dB` is **applied, not skipped**. The pass still runs, so the
output is a real 24-bit file written by this pipeline rather than a copy, and
the job record describes something that actually happened.

## Job record

New fields on `MasterJob`, all null for every existing row:

```ts
normalizationMode: NormalizationMode | null;  // null ⇒ 'loudness' (pre-feature)
peakGainDb: number | null;                    // the single gain applied
```

`afterLufs`, `afterTp`, `beforeLufs`, `beforeLra`, `afterLra` are populated as
usual. They are measurements, and measurements are always worth having — what
changes is that nothing *judges* them in this mode.

## Report and verdicts

`src/lib/master-report.ts` and the studio's verdict copy currently score a
master against its target. A karaoke bed at −20.2 LUFS would read as a failed
master forever.

In `'peak'` mode:

- The "on target" row becomes **"peak-safe"**: pass when `afterTp <= -1.0`.
- The "gain type" row (linear vs dynamic) is replaced by **"gain applied"**,
  showing `peakGainDb`. There is no normalization type, because no loudnorm ran.
- Integrated loudness and LRA are shown as **information, not verdicts**, with
  the before/after pair so it is visible that they did not move.

## UI

In the Mastering Studio, the target control gains a third choice alongside
−14 and −16:

> **Karaoke bed** — keeps the level, peak-safe to −1 dBTP

Selecting it:

- Hides the reference-matching picker (refused server-side anyway).
- Hides the **Render for YouTube** and upload panels entirely, and the library
  row's Render/Make-short buttons for karaoke rows.
- Changes the download filename suffix from `(Master -14 LUFS)` to
  `(Karaoke bed -1 dBTP)`. `downloadKey` already takes an optional label
  argument for exactly this (added for the vertical short), so this is a call
  site, not a change.
- Shows the deliverable note: *320 kbps MP3, no vocals, headroom for a live
  voice* — the same three claims `KARAOKE_DELIVERABLE` makes to buyers.

## MP3

`buildMp3Args` already takes a bitrate argument. The worker passes
`KARAOKE_MP3_BITRATE` in `'peak'` mode and `MP3_BITRATE` otherwise.

The peak-safety check in `master-mp3.ts` (192k encoding is peak-neutral on this
material) was measured at 192k. 320k is a *higher* bitrate and therefore encodes
closer to the source, so the existing conclusion holds a fortiori — but the
delivered MP3's true peak is measured and recorded either way, as it is today.

## Delivery

No change required. Once a karaoke bed has a job record and a saved master, the
existing delivery-links flow presigns it like anything else. That is the whole
point of the feature: karaoke stops being a special case at the delivery step
because it stopped being one at the mastering step.

## Testing

Pure layer (`src/lib/`), where most of this belongs:

- `karaokeMasterKeyFor` / `isKaraokeMasterKey` round-trip, and do **not** match
  loudness-master keys, and are **not** matched by `isMasterKey`.
- Gain arithmetic: `-1.0 - (-1.0) = 0.00`, `-1.0 - (-7.5) = 6.50`, and a
  required gain above 12 dB refuses.
- The peak-mode filter string contains `volume=` and contains neither
  `loudnorm` nor any compressor.
- A request carrying both `'peak'` and a `referenceId` is refused.

Worker:

- `'peak'` runs exactly two ffmpeg passes and no loudnorm.
- The MP3 pass is invoked with `320k` in peak mode and `192k` otherwise.
- `'loudness'` mode's ffmpeg call sequence is **unchanged** — pinned against the
  existing assertions, which must not be weakened.

Route:

- Absent `normalizationMode` produces a byte-identical payload to today.
- `'peak'` threads through to the worker event.
- An unknown mode 400s; `'peak'` + `referenceId` 400s.

Regression:

- Master `karaoke-clean.wav` in peak mode and assert the output measures
  −20.2 LUFS / 6.4 LU / −1.0 dBTP — i.e. unchanged. This is the acceptance test
  for the whole feature.

## Out of scope, recorded so it is not re-litigated

- Stem separation in the portal.
- Video, short, or YouTube upload from a karaoke bed.
- A "keep loudness but also hit a target" hybrid — the measurements show
  loudnorm cannot do it linearly on this material.
- Destination presets as a general abstraction. Worth doing *after* this, once
  a second mode has shown what the abstraction actually needs.
