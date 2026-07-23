# Tamil vocal A/B — engine comparison run sheet

**Created:** 2026-07-22 · **Owner:** Raj · **Status:** ready to run, ~half a day

## Why this exists

Suno support confirmed (2026-07-21) a platform-wide model regression affecting
vocal quality and prompt adherence, with no ETA and no rollback offered.

Research the same week established that **no external evidence can answer
"which engine sings Tamil acceptably"**:

- No vendor publishing a language list includes Tamil. Lyria 3 lists Hindi and
  explicitly not Tamil; Mureka lists ten languages and no Indic at all;
  ElevenLabs Music, Suno and Udio publish no music language list whatsoever.
- No benchmark, paper or leaderboard evaluates any lyrics-to-song model on Tamil.
- The entire public first-person corpus is **one Medium post** (Mar 2024, Suno
  v2/v3 era).

So the only way to know is to measure. Running this produces better evidence
than anything currently on the public web.

## Before you start — do these two first

1. **Check Suno's model picker.** Secondary sources claim paid plans can select
   v4 / v4.5 / v5 / v5.5; Suno's own pricing page mentions only v5.5. This is
   **unverified and free to check**. If older models are selectable, pin one and
   the problem may simply be over — run the A/B anyway, but with much less
   urgency. (Also: Premier grants no model access that $8 Pro doesn't; the
   difference is credits and Studio.)
2. **Download your masters.** Unrelated to this test and more urgent than it.
   Reporting says the Warner settlement ships licensed models in 2026 that
   *retire* V3–V5.5 rather than supplement them, with no date. Riffusion deleted
   every user generation on 2026-02-20 after its acquisition. Don't leave the
   catalogue on someone else's server.

## The test verse — you supply it

**Use four lines of your own existing lyrics.** Do not let anything generate a
test verse: the lyrics are the part that is unambiguously yours and the legal
anchor for the whole catalogue, and a synthetic verse would also be a worse test
because you have no reference for how it *should* sound.

Pick a verse that contains, ideally in a few words:

| Feature | Look for | Why |
|---|---|---|
| Retroflex contrast | ழ, ள and ல in the same verse | The phonemes non-Tamil models collapse |
| Vowel length contrast | a குறில் / நெடில் pair | Meaning-bearing; models flatten it |
| Gemination | a doubled consonant | Meaning-bearing |
| A natural breath point | a line that must not be split | Engines breathe where the music suits |

Record which song and which lines in the brief notes so the run is repeatable.

## The matrix

One verse × 2 scripts × N engines. Keep **everything else fixed** — same style
prompt, same BPM, same requested voice — or you are measuring the wrong thing.

| Engine | Version to record | Notes |
|---|---|---|
| Suno | `suno v5.5` | The incumbent and the baseline |
| Suno (older) | e.g. `suno v4.5` | **Only if the picker offers it** |
| ElevenLabs Music | `elevenlabs music` | ~$6. Composition plan caps at 30 lines / 200 chars per line — a பல்லவி + அனுபல்லவி + 2 சரணம் needs splitting, and it is unclear whether 200 "chars" counts bytes or codepoints for Tamil Unicode. Watch for silent truncation. |
| Lyria 3 | `lyria 3` | $0.08. Google lists Hindi, not Tamil — expect Hindi-accented approximation. Worth one run to confirm rather than assume. |
| Mureka | `mureka v8` | Technically the best Suno replacement, **but** an active US class action attacks its ownership / royalty-free claims. Test for information; do not commit the catalogue to it on this evidence. |

**Two takes per cell.** One take tells you nothing about variance, and these
engines are stochastic.

## Scoring — blind

Score in `/admin/music-lab` → *Tamil pronunciation scoring*. Five axes, 0–4,
with anchors on hover. `blindLabels()` in `src/lib/tamil-vocal-rubric.ts` gives a
deterministic seeded shuffle so you can relabel the files A, B, C… before
listening and recover the mapping afterwards.

**Score blind.** You have a strong prior about which engine you like. Listening
while knowing the source measures the prior, not the audio.

The verdict is **gated on intelligibility** (retroflex + vowel length +
gemination), not on the composite. A take that sounds beautiful while saying the
wrong word is unusable, and a composite average would hide exactly that.

- `unusable` — intelligibility < 50
- `needs-work` — intelligibility < 75, or composite < 65
- `releasable` — otherwise

## Decision rule — write this down before you listen

Pre-registering the rule is what stops the result being argued backwards from
whichever engine you already preferred.

- **Any engine reaching `releasable` on both takes of the Tamil-script cell** is
  a genuine alternative. Verify its rights position before moving the catalogue.
- **Suno v5.5 still ranks top** → the regression is real but survivable. Stay,
  and use the prompt-adherence anchor (`buildStyleAnchor`) plus the Music Lab
  version tracking to work around it.
- **Every engine scores `unusable` on retroflex** → this is a Tamil-support
  problem across the whole field, not a Suno problem. Switching engines cannot
  fix it. Consider voice conversion (a human sings it; AI handles timbre), which
  is the only architecture with no phoneme blocker — and the only one that fits
  "AI augments the craft rather than performing it".
- **Tamil script beats romanized consistently** → make Tamil script the standing
  convention and record it.

## Recording the run

Create one brief for the test verse, then log every take against it with:

- `engine` + `settings.engineModel` — **spell the version identically each time**;
  it is normalised, but consistency keeps the buckets clean
- `promptText` — the exact style text submitted, including any hand-edits
- `lyricScript` — `tamil` or `romanized`
- `tamilVocal` — the five axes
- `verdict` + `failureReason` — log the failures too; they are the dataset

The insights panel needs **4 takes per bucket** before it reports a rate, which
the 2-takes-per-cell matrix reaches once a cell is run in both scripts.
