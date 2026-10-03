# Stem library and remix — design

**Date:** 2026-10-03
**Status:** approved in conversation, section by section; awaiting review of this written spec
**Scope:** stages 1 and 2 of the four-stage stems module. Stages 3 (karaoke and instrumental presets) and 4 (per-stem fixes such as EQ) are out of scope and get their own specs.

## Purpose

Raj generates songs with Suno (shown in the admin as *TamilAgaval Music*). Suno can export a song as separate **stems**: one WAV per part (vocals, drums, bass, strings and so on). Today those stems only pass through: `/admin/mastering/bulk` moves them into S3 so the dev box can work on them from the command line, as it did for two karaoke orders. Nothing in the admin lists, plays or edits them.

This module gives every saved master a **stem set** that can be stored, organised and heard in the browser, plus a **remix**: re-balance the stems, render a new mix, and send it through the existing mastering, video and shorts pipeline as a new master beside the original.

### What Raj chose

| Question | Choice |
| --- | --- |
| What to do with stems | All four: store and organise, re-balance and remix, karaoke and instrumentals, fix one part. |
| First spec | Stages 1 and 2: library and remix. |
| What a stem set attaches to | An existing **saved master**. |
| Where a remix goes | A **new master, beside the original**. The original is never touched. |
| How listening while mixing works | **Live mixer on light copies** (option A). |

### A constraint that shapes expectations

Suno's stems are **resynthesised approximations of each part, not extractions** (measured 2026-09-19 on a real song). The 11 stems summed came to −13.9 LUFS, LRA 4.6, +1.7 dBFS peak, against the source at −14.5 LUFS, LRA 2.1, −3.7 dBFS. Raj heard the summed version as degraded. So a remix is always **a new version**; it will not sound exactly like the original release. The mixer page says so plainly, and no part of this design assumes the stems add back up to the original.

## Section 1: What gets stored

### The stem-set record

A new item type in the existing single table `TamilWebContent`, one per saved master:

- `PK = STEMSET#<masterJobId>`, `SK = METADATA`. Keyed by the master's id, so "one set per master" is enforced by the key itself.
- `masterJobId` (the saved master it belongs to)
- `stems`: a list, in display order, of:
  - `key`: the S3 key of the full-quality WAV
  - `name`: shown and editable. The first guess comes from the filename (`2_Drums.wav` → "Drums": strip a leading number and separator, strip the extension).
  - `previewKey`: the listening copy, or null until it is ready
  - `previewError`: why a listening copy failed, or null
  - `durationSec`, `sampleRate`, `channels`, read by the worker from the file
- `mix`: the saved mix settings, one entry per stem key: `{ gainDb, muted }`. `gainDb` runs from −60 to +6; −60 and below plays as silence on the faders. A stem with no entry is 0 dB, unmuted.
- `remix`: the last render, or null: `{ key, renderedAt, mixUsed, notes, error }`. `mixUsed` is a copy of the settings it was rendered with. `notes` records anything adjusted, such as padding or resampling.
- `createdAt`, `updatedAt`

**Removing a stem** removes it from the list and its mix entry. The S3 objects are left in place (nothing in the mastering workspace is deleted by the app today). Removing a stem never touches the master or a rendered remix.

### Files

All under the mastering workspace, so the existing `isMasteringKey` guard, the presigned-upload rules and the worker's role all apply unchanged:

- `audio/mastering/stems/<masterJobId>/<uploadTimestamp>_<filename>.wav`: the full WAVs
- `audio/mastering/stems/<masterJobId>/preview/<same base name>.m4a`: the listening copies, AAC 128 kb/s stereo, about 5 MB for a 5-minute stem
- `audio/mastering/stems/<masterJobId>/remix/<timestamp>-remix.wav`: rendered remixes

The remix key must never match `isMasterKey` or `isKaraokeMasterKey`, because the master route refuses mastering outputs as sources. A test pins that.

### Uploading

- It reuses the existing presigned-POST upload route with a new upload kind, `stem`: WAV only, the same 500 MB cap enforced by S3's `content-length-range`, admin only (`requireAdmin` + `requireBearer`), and the key forced under that master's stem folder.
- The browser behaviour copies `BulkWavUpload`: drop many files at once, progress per file, one Cancel for the batch, and a per-row error with `role="alert"`.
- After each file lands, the page calls `POST /api/admin/stems/<masterJobId>/stems` with the key. That route adds the stem to the set (creating the set on first use) and Event-invokes the worker to make the listening copy.

## Section 2: The screens

### On the saved-master row

A **Stems** link beside Video, Short and Vertical:
- **Stems (N)** when the set has N stems;
- **Add stems** when it has none.

It is a plain link to the Stems page. The master list does not load stem sets. The row knows only whether one exists, from a `stemCount` field written onto the master job whenever its set changes.

### The Stems page: `/admin/mastering/stems/[masterJobId]`

Header: the song's title and a link back to Sound Engineering. The page title and subtitle come from `AdminLayoutClient`'s per-route map, like every admin page. It is not added to the sidebar menu; it is reached from a master's row.

1. **Upload area.** Drop the stem WAVs. Each file shows its progress, then *Preparing listening copy…*, then *Ready*.
2. **Stem list.** For each stem:
   - its name, editable inline;
   - length and sample rate;
   - **Remove**.

   If a stem's sample rate or length (to within 0.1 s) differs from the majority, a warning appears on that row, saying it will be resampled or padded when rendered.
3. **Mixer.**
   - One transport for the whole song: play/pause, a seek bar, and elapsed / total time.
   - Per stem: a level fader (−∞ to +6 dB, starting at 0, with a dB readout), **Mute** and **Solo**. When any stem is soloed, only soloed stems play.
   - Built on the Web Audio API: one `AudioBufferSourceNode` per listening copy, all started together through one `GainNode` per stem, so fader and mute changes are heard instantly.
   - **Reset** sets every stem to 0 dB, unmuted, with no solo.
   - Solo is a listening aid only. It is **not saved** and **not used by the render**.
   - The note under the mixer: *"A mix of the stems is a new version — it will not sound exactly like the original release."*
4. **Autosave.** Level and mute changes are saved about 400 ms after the last change, per set (the same pattern as the slideshow list, `saveSlides`). A failed save is shown on this page, next to the mixer.
5. **Actions:**
   - **Render remix** (Section 3);
   - **Master this remix** (after a render);
   - **Download stems**: one presigned link per stem, opened in turn.

Errors anywhere on this page render on this page, next to the control that caused them. Never only in the global banner.

## Section 3: Rendering the remix and handing it to mastering

### Render

`POST /api/admin/stems/<masterJobId>/remix` reads the set's saved `mix` (never trusting levels sent from the client) and Event-invokes the worker with the stem keys and their settings. The worker re-validates every key with `isMasteringKey` and under the set's folder.

The worker:

1. Downloads the full-quality WAVs, skipping muted stems entirely.
2. Probes each one (`ffmpeg -i` header): sample rate, channels, length.
3. Builds one ffmpeg command:
   - each input through `aresample=48000` (only when its rate differs), then `volume=<gainDb>dB` (only when not 0), then `apad` up to the longest length;
   - all inputs into `amix=inputs=N:normalize=0:duration=longest`.
   - ⚠️ **`normalize=0` is required.** By default `amix` divides each input by the number of inputs, so 11 stems at 0 dB would come out about 21 dB too quiet. A test pins the flag.
4. Writes **32-bit float WAV** at 48 kHz (`-c:a pcm_f32le`). The summed stems peaked at +1.7 dBFS in the September measurement. Float keeps anything above full scale intact, and mastering's loudness and true-peak passes then set the final level, exactly as they do for any source.
5. Uploads it to `…/remix/<timestamp>-remix.wav` and patches the set's `remix` with the key, `renderedAt`, `mixUsed` and `notes` (e.g. *"Strings resampled from 44.1 kHz; Bass padded by 0.3 s"*), or `error` on failure.

The page polls the set for `remix.renderedAt` / `remix.error` changing, the same way render and short polling work today. When done it shows **Remix ready**, with a play button that streams the WAV through a presigned link.

### Hand-off to mastering

**Master this remix** opens Sound Engineering with:
- the remix WAV as the source;
- the title pre-filled as *"<song> — remix"*;
- the target set to the original master's target.

**How:** the button links to `/admin/mastering?source=<remixKey>&title=<…>&target=<targetId>`. On load, Sound Engineering reads those parameters and calls the same setters **Edit & re-master** (`reopenMaster`) uses today: `setSourceKey`, `setSource`, `setMasterName` and `setTargetId`. A `source` that fails `isMasteringKey`, or that is a mastering output, is ignored with a visible note rather than loaded.

From there the flow is unchanged: master, save, then video, short and vertical. The result is a separate saved master. The original master and its stem set are not modified.

### Limits and cost (to be measured before relying on them)

- **Worker scratch:** about 11 × 85 MB = about 1 GB of stems plus the output, against 4 GB of ephemeral storage.
- **Time:** a sum of about 11 WAVs is expected to take well under a minute, against the 900 s ceiling.
- **Measurement:** both numbers are measured on the Lambda's ffmpeg 7.0.2 with the real stems from a September karaoke order, already in S3.

## Section 4: Testing, deployment and what's left out

### Tests, written first

- **Pure library functions:**
  - stem-name guessing from filenames;
  - the remix arguments: `normalize=0`, the volume only when non-zero, muted stems absent, `aresample` only on a mismatch, `apad` to the longest;
  - the length and sample-rate mismatch checks;
  - key builders, including the remix key never matching `isMasterKey`.
- **Routes:**
  - admin-only;
  - keys held to the master's stem folder;
  - the remix route uses the stored mix, not the request;
  - unknown master → 404.
- **Repository:**
  - the stem set round-trips through `fromDBItem`;
  - malformed entries are dropped;
  - updating the set also updates `stemCount` on the master.
- **Worker:**
  - the listening-copy pass;
  - the remix pass and its notes;
  - errors written to the set.
- **Screens:**
  - upload rows and states;
  - faders, mute, solo and reset;
  - autosave;
  - render and polling;
  - **Master this remix**, and the studio loading a `source` from the URL (and ignoring an invalid one);
  - errors rendered on the page (asserted as descendants of the page section, not merely present in the document).

### Real checks on ffmpeg 7.0.2 before hand-over

- Stems at 0 dB mix to exactly their sum: compare `astats` against a reference sum, and confirm no division and no clipping.
- A muted stem is absent from the output.
- A stem at a different sample rate, or of a different length, is handled as the notes say.
- Render time and scratch use on the full 11-stem song.

### Deployment

- **Site:** deploys on merge (Amplify).
- **Worker:** the listening-copy and remix passes need a **manual worker deploy**, on Raj's explicit yes, with the live zip backed up to `~/lambda-backups/` first.

### Delivered as two PRs

1. **Library:**
   - the record and repository;
   - the upload kind;
   - the stems routes;
   - the listening-copy pass;
   - the Stems page with upload, list, rename, remove and plain playback;
   - the row link.
2. **Mixer and remix:**
   - faders, mute, solo and autosave;
   - the remix render;
   - **Master this remix**.

### Out of scope

- **Stage 3, karaoke and instrumental presets** (vocals off, vocals quieter). These become small additions on top of the mixer.
- **Stage 4, per-stem fixes** (EQ, taming harshness, evening out level). Sound Engineering's rule today is *"loudness only — never EQ, compression or tone"*. Per-stem tone shaping would be the studio's first tone tool, a deliberate change Raj decides when that stage is designed.
- **Changes to the video, short or vertical renders.** A remix uses them unchanged once it is mastered.
