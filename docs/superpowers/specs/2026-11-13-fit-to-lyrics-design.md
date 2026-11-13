# Fit to the lyrics: Visual Story Studio design

**Date:** 2026-11-13. **Status:** design, waiting for Raj's approval. Nothing is built yet.
**Worked example:** பூவும் காற்றும் சேர்ந்த வாசம், story `vs_1794516369586_k2tfbxcf`, window 0:00–3:00,
13 HERO clips already made (Raj's own pictures, ages 1→12).

## 1. Why

Raj asked whether the story video still has to go through Premiere Pro, or whether every lyric line
needs its own clip, because "the current method doesn't sync the video to the lyrics". He's right
about the problem. Today every row is a whole number of seconds that Raj picks by hand or that
"Fit to the song" spreads evenly. In பூவும் every row is 14 s, so three of the twelve cuts fall in the
middle of a sung line (0:28 in line 2, 0:56 in line 8, 2:48 in line 36). Nothing in the studio knows
when the words are sung.

Raj's direction (2026-11-13): **it should work like Video Text.** The studio listens to the song and
its lyrics. It then cuts the rows on the lyrics, and writes each row's prompt (or makes its clip)
from that row's lyrics, the story so far, and the pictures Raj uploaded or picked.

**Success:** Raj makes a story video in the studio with every cut on a line start or in the music,
and each picture fitting the words sung over it. He adds the lyric text in Video Text as he does now.
He needs no Premiere and no clip per line.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Listen to the story's own song (the same worker and alignment as Video Text auto timing) and time
   Raj's pasted lyrics line by line.
2. Put the cuts on line starts or inside music breaks, never in the middle of a sung line.
3. Give each row the lyric lines sung over it, and show them in the row.
4. Write each row's video prompt from its lines, the lines around it, the story's style and cast, and
   the row's picture. Raj reads and edits every prompt before anything is paid for.
5. Work on a story whose clips are **already made** without new clips where possible (§5.2).

**Non-goals**
- Putting lyric text on the video. Video Text still does that, and the studio renders stay clean
  (standing rule: no overlays in studio renders).
- Lip sync. The no-lip-movement rule (#420) stays.
- Beat or tempo detection. The cut points are line starts and music breaks only.
- A new editor or timeline. Rows stay rows.

**Anti-goals (failure even if it "works")**
- Any Grok spend Raj did not press a button for. Timing and suggesting rows are free or nearly free.
  Writing prompts is a small Claude cost shown before it runs.
- Silently throwing away a made clip. If a fit would make a paid clip out of date, Raj sees that
  before he says yes.
- A machine word on screen or in a row's lyric field. The lines are Raj's text, byte for byte
  (`verifyRoundTrip`, the same contract as Video Text).

## 3. What Raj sees

A new **Lyrics** step in the pictures panel, next to "Fit to the song":

1. **Paste lyrics** (one line per line, blank line between verses, the same as Video Text). If a
   Video Text project has the same song, a "Use the lyrics from Video Text" button fills the box.
   That button is my call; it saves pasting.
2. **Listen to the song.** This runs the timing worker on the story's master audio. A 4-minute song
   takes a few minutes, the same as Video Text. The result is kept, so it runs once per song file.
   It shows "50 of 50 lines heard", as Video Text does.
3. **Fit the rows to the lyrics.** This shows the proposed rows **before** saving: start–end, length,
   the lines in each row, and what happens to each made clip ("trim 0.8 s", "plays at 94 % speed",
   "needs a new clip"). Raj chooses **Keep my rows** (§5.2, the default when clips exist) or
   **New rows from the lyrics** (§5.1). Nothing changes until he presses **Use these rows**.
4. **Write prompts from the lyrics.** This is optional and per row or for every row. Claude writes
   the video prompt from the row's lines, its picture and the story. Raj sees the price first (a few
   cents a row) and edits the result. Grok is still only called by the existing Make-the-video
   buttons.

Each row card shows its lyric lines in small text under the seconds ("♪ 9–14: முல்லை மலர் போலே …"),
or "♪ music" for a break.

## 4. How the timing works

- **Same machinery as Video Text.** `tamilagaval-lyric-timing` already accepts an audio key, and
  its role can read `audio/mastering/*` (checked 2026-11-13; the story's `audioKey` is under it).
  The words go to `audio/mastering/lyric-timing/vs/<vsId>/<audio base>.words.json`, keyed by the
  audio file, so editing the lyrics re-aligns for free. `timeLyricLines` and `linesAndVerses` are
  reused as they are. They move or get re-exported out of `src/lib/video-text/` so the studio does
  not import a Video Text module; the builder decides how.
- **Window.** Times are song times. The story keeps the lines that start inside
  `[windowStartSec, windowEndSec)` and subtracts `windowStartSec`.
- **Breaks.** A break is a gap of ≥ 4 s between one line's end and the next line's start, plus the
  intro before line 1 and the tail after the last line. A cut anywhere inside a break is fine. Inside
  singing, a cut may only land on a line start. The 4 s figure is my call: பூவும்'s longest gap inside a
  verse is 0.8 s and its shortest real break is 18.1 s, so anything from 2 to 10 would do.
- **Lead.** A cut lands on the frame at or just before the line's first sung word (25 fps). Whether
  to lead by a frame or two is left to the builder; look at it in a render.

## 5. How the rows are fitted

Both modes solve the same small problem exactly (dynamic programming over the allowed cut points, on
a 0.1 s grid inside breaks; the prototype takes about 2 s in Python for 3 minutes). The problem: N
rows that fill the window exactly, every cut allowed, every row 1–15 s, as close as possible to a
target length per row.

### 5.1 New rows from the lyrics

For a story without made clips, or when Raj asks. The fitter finds the fewest rows of ≤ 15 s, then
balances them. **பூவும், 0–3:00 → 16 rows** (13 with singing, 3 music):

| # | Time | Length | Lines |
|---|------|--------|-------|
| 1 | 0:00.0–0:12.1 | 12.1 | music |
| 2 | 0:12.1–0:24.2 | 12.1 | 1 |
| 3 | 0:24.2–0:34.5 | 10.4 | 2–3 |
| 4 | 0:34.5–0:47.9 | 13.3 | 4–6 |
| 5 | 0:47.9–0:58.3 | 10.5 | 7–8 |
| 6 | 0:58.3–1:09.8 | 11.5 | 9–13 |
| 7 | 1:09.8–1:20.8 | 11.0 | 14–16 |
| 8 | 1:20.8–1:31.7 | 10.9 | music |
| 9 | 1:31.7–1:42.6 | 10.9 | 17–19 |
| 10 | 1:42.6–1:54.3 | 11.7 | 20–24 |
| 11 | 1:54.3–2:05.1 | 10.8 | 25–26 |
| 12 | 2:05.1–2:15.9 | 10.8 | music |
| 13 | 2:15.9–2:26.8 | 10.9 | 27–28 |
| 14 | 2:26.8–2:38.5 | 11.7 | 29–33 |
| 15 | 2:38.5–2:49.9 | 11.4 | 34–36 |
| 16 | 2:49.9–3:00.0 | 10.1 | music |

Grok bills by the second. Today's 13 clips are 180 s. 16 rows, each rounded up to whole seconds
(§6), come to about 187 s, roughly 4 % more. A "shorter rows (1–2 lines
each)" choice gives about 26 rows for the same window. That is my call as an option, not the
default.

New rows take the scene of the row they replace, by time. New music rows start as STILL, so they
cost nothing until Raj changes them (my call).

### 5.2 Keep my rows (the default when any row has a made clip)

The row count and order stay the same. Only the cuts move. Each row's target is its own clip length.
A row shorter than its clip **trims** the clip's end. A row longer than its clip plays the clip
**slightly slower**, down to 88 % speed and no lower (my call: slower than that looks like slow
motion). Rows that cannot fit are marked "needs a new clip", and Raj sees that before saying yes.

**பூவும், Raj's 13 clips as they are → fits, no new clips, $0:**

| # | Time | Length | Lines | Clip |
|---|------|--------|-------|------|
| 1 | 0:00.0–0:14.9 | 14.9 | music | 14 s, plays at 94 % |
| 2 | 0:14.9–0:29.9 | 15.0 | 1–2 | 14 s, 94 % |
| 3 | 0:29.9–0:43.1 | 13.2 | 3–5 | trim 0.8 s |
| 4 | 0:43.1–0:58.3 | 15.2 | 6–8 | 92 % |
| 5 | 0:58.3–1:12.5 | 14.1 | 9–14 | 99 % |
| 6 | 1:12.5–1:26.4 | 13.9 | 15–16 | trim 0.1 s |
| 7 | 1:26.4–1:40.4 | 14.0 | 17–18 | as is |
| 8 | 1:40.4–1:54.3 | 13.9 | 19–24 | trim 0.1 s |
| 9 | 1:54.3–2:08.1 | 13.8 | 25–26 | trim 0.2 s |
| 10 | 2:08.1–2:22.0 | 13.9 | music | trim 0.1 s |
| 11 | 2:22.0–2:36.2 | 14.2 | 27–32 | 99 % |
| 12 | 2:36.2–2:49.9 | 13.7 | 33–36 | trim 0.3 s |
| 13 | 2:49.9–3:00.0 | 10.1 | music | 12 s, trim 1.9 s |

Trimming alone cannot fit this story. The clips total exactly 180 s, the same as the window, so any
cut that moves earlier must be paid back by a row that runs longer than its clip. With trim only,
**9 of the 13 rows would need a new clip** (about $18 of Grok at 720p). With the slow-down floor at
88 %, all 13 fit and the slowest row plays at 92 %.

**Chained rows.** If a row was made "Continue from…" the previous clip's last frame, trimming the
previous clip would make a visible jump at the seam. The fitter does not trim a clip that a chained
row continues from; it may only slow it. If that cannot fit, the row is marked "needs a new clip".
பூவும் has no chained rows.

## 6. Fractional seconds (data and render changes)

- `Shot.durationSec` becomes a number with up to one decimal place (zod: 0.1 steps, still 1–15, own
  clips up to 60). Old whole-number rows are unchanged. The Inspector and the row's seconds field
  accept tenths.
- **Grok clips are asked for in whole seconds:** `ceil(row seconds)`, which is still ≤ 15. The render
  trims the rest. The price shown is for the whole seconds asked for.
- **Out of date (changes #451's rule).** A clip is out of date only when the row needs it slower than
  88 %, or for a chained clip that would now be trimmed. A shorter row just trims. **Phase 1
  requirement:** the fitter uses each clip's real length. Clips made before 2026-11-13 have no stored
  length, so phase 1 includes an ffprobe backfill of `Candidate.durationSec` (or an ffprobe at fit
  time). A Grok clip shorter than asked would otherwise turn a planned trim into a freeze.
- **Render.** Each row's frame range comes from the running total, `round(startSec × 25)` to
  `round(endSec × 25)`, not from rounding each row on its own, so 16 rows of tenths never drift off
  the song. A slowed row uses a time stretch (`setpts`) instead of today's clone-pad freeze. Stills
  are unchanged. The render-time estimate counts the slowed frames.
- Draft and "Fit to the song" keep making whole seconds; nothing about them changes.

## 7. Lyrics on the row, and prompts from the lyrics

- **Stored:** `Shot.lyric?: { fromLine: number; toLine: number; text: string }`, where `text` is the
  lines joined by newlines, exactly as pasted, or absent for music. This **changes a rule in the
  2026-09-11 spec (§12 / line 732): "pasted lyrics … stored only as a hash"**. That was a precaution,
  not a requirement Raj set. Video Text already stores `lyricsText` in the same table, and attaching
  the line to the row is the point of this feature. Flagged for Raj; it is my call unless he says
  otherwise.
- **Prompt writing (Claude Sonnet, on the compose worker like Draft and Check):** per row, it sends
  the row's lines, the lines before and after, the story title, style and scene summary, the cast
  names and descriptions, the row's picture (first-frame image or chosen still, sent as an image),
  and the row's mode and seconds. It returns the video prompt only, and Raj's existing prompt is
  shown beside it until he accepts. The instructions repeat the studio's standing rules: no text on
  screen, no lip movement, keep the faces in the picture. It must not translate the lyrics into
  English text in the image. The Tamil lines are used for meaning only. Money uses the same
  reserve/settle as Check, bounded per row. This is the "listen, then generate based on the lyrics,
  context and the images" Raj asked for. The Grok call stays behind the existing buttons.
- Lyrics are **never** sent to Grok directly. Only the prompt Raj accepted goes there.

## 8. Constraints

- Every deploy and push needs Raj's yes; Raj runs `~/push.sh`. Workers deploy by hand (the compose
  worker for prompt writing; the master worker for the render change).
- One money rule everywhere: reserve before calling, settle once, show cost before any paid step.
- Row errors show in the row, not at the bottom of the panel.
- Branch from master; PR per phase.

## 9. Suggested order (builder may change)

1. Timing for a story + "Keep my rows" fit + fractional rows + render frame ranges + slowed clips.
   This alone fixes பூவும் at $0. Test: re-render பூவும் and compare the cuts against the line
   table.
2. "New rows from the lyrics" mode and lyric display on rows.
3. Prompts from the lyrics.

## 10. Left to the builder

- Grid points inside a break must be clamped to at most the next line's start. The prototype's 0.1 s
  grid rounded 2:21.96 up to 2:22.0, which is 0.02 s inside line 27. The §5.2 table shows that row
  as music by hand.
- The dynamic programming's exact cost function (the prototype uses the squared distance from each
  row's target), its grid, and tie-breaks.
- Where the shared lyric-timing helpers live; the route shape (likely
  `/api/admin/visual-story/[vsId]/lyric-timing` mirroring Video Text's GET / start / align).
- The time-stretch filter and its render-time cost figure.
- UI layout of the Lyrics step inside the pictures panel.

## 11. Open questions for Raj

1. Is storing the lyric lines on each row OK? (It changes the "hash only" rule in the original spec.)
2. Should rows be allowed to play their clip a little slower (to 88 %) so a made clip fits, or should
   they only trim? (Trim only means 9 of பூவும்'s 13 clips need remaking, about $18.)
3. Prompts from the lyrics (§7, your "listen, then make it from the lyrics, context and pictures")
   is phase 3, behind the timing fix. Do you want it sooner?
4. For new stories, should the default be fewer, longer rows (16 for பூவும்) or one to two lines a row
   (about 26)?

**Clock check:** the story's master WAV and the Video Text source MP4 are both exactly 246.0 s
(ffprobe, 2026-11-13). The Video Text video is the same master, so the line times in the tables
should hold on the story's audio. Phase 1 re-times on the WAV itself and confirms this before any
result is trusted.

Prototype numbers: `fit-dp.py` in the session scratchpad, using the saved timings from Video Text
project `be313bc9…` (50 of 50 lines).
