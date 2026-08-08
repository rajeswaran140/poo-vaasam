/**
 * In-app admin documentation registry. Plain markdown strings rendered by the
 * /admin/docs viewer (parsed via src/lib/markdown-blocks.ts — no runtime DB, no
 * external dep). Add a new guide here and it appears in the portal. Keep
 * `updatedAt` current when you edit a doc.
 */

export interface AdminDoc {
  slug: string;
  title: string;
  category: string;
  updatedAt: string; // YYYY-MM-DD
  body: string;
}

export const ADMIN_DOCS: AdminDoc[] = [
  {
    slug: 'prompt-preflight-testing',
    title: 'Tamilagaval Pre-flight — How to test',
    category: 'Composer',
    updatedAt: '2026-06-22',
    body: `# Testing the Tamilagaval pre-flight

The Tamilagaval pre-flight vets a style prompt + lyrics **before** you spend a generation credit. It lives inside the composer, so you test it by composing.

## Setup
1. Open **Music Director** in the sidebar (\`/admin/compose\`).
2. If you were logged in from a previous day, log out and back in once for a fresh token.
3. The AI-critic key is configured in production, so both layers work.

## Test 1 — Happy path
1. Paste clean **Tamil lyrics with section tags** (e.g. \`[பல்லவி]\` / \`[சரணம்]\` or \`[Verse]\` / \`[Chorus]\`).
2. **Compose** (button, or Cmd/Ctrl+Enter) and wait for the brief.
3. Under each card in **"Tamilagaval prompts"** you should see a readiness panel: a **Ready** badge + a **score /100** + any findings with fixes.

## Test 2 — Make the linter fire
The linter checks your pasted lyrics + the generated style prompt. Paste these and re-compose:

| Paste this | Expected finding |
|---|---|
| Plain lyrics with no section tags | "No section tags…" |
| A line with an emoji (❤️) | "Lyrics contain emoji…" |
| Tamil + full English sentences mixed | "mix Tamil with substantial English…" |
| A very long lyric (60+ lines) | "may exceed a single render" |

Each finding shows a concrete fix after the "—".

## Test 3 — AI critic
1. On any variant, click **AI critic** (the ✨ button).
2. Wait ~5–15s for the live Claude call.
3. You should get a **verdict** (ready / risky / not ready) + a one-line summary + semantic issues with fixes.
4. On any error it shows "⚠️ Critic failed" and never breaks the page.

## What to report
- Does the badge + score render under every variant?
- Do the findings + fixes make sense?
- Does the AI critic return a sensible critique in reasonable time?
- Anything off — layout, dark mode, or a wrong finding.
`,
  },
  {
    slug: 'prompt-preflight-how-it-works',
    title: 'Tamilagaval Pre-flight — How it works',
    category: 'Composer',
    updatedAt: '2026-06-24',
    body: `# How the Tamilagaval pre-flight works

The music generator has no API and every generation costs a credit, so this raises your first-try odds **before** you generate. Two layers:

## 1. Deterministic linter (free, instant)
Runs on every composer result with zero cost. It flags structural credit-wasters:

- **STYLE_TOO_LONG / STYLE_HAS_LYRICS** — style box over the cap, or lyrics leaking into it (the generator sings the style box too).
- **STYLE_GENRE_CONFLICT** — e.g. EDM + carnatic → mush.
- **STYLE_VAGUE** — missing tempo / instrument / vocal / mood cues.
- **LYRICS_NO_STRUCTURE** — no \`[Verse]\` / \`[Chorus]\` tags.
- **LYRICS_TOO_LONG / LYRICS_MANY_LINES** — won't fit one render.
- **LYRICS_MIXED_LANG / LYRICS_EMOJI** — mispronunciation / the generator vocalising emoji.

Each finding carries a **fix**. The badge is **Ready** only when there are no errors.

## 2. AI critic (on demand)
The ✨ button runs a Claude pass for **semantic** risks the linter can't see — style↔lyric mood mismatch, unsingable phrasing, ambiguous direction — and returns a verdict + concrete fixes.

## The workflow it enables
Compose → read the readiness panel → fix the flagged issues (or pick the best-scoring variant) → only then paste into the generator. You spend credits on a **vetted** prompt instead of trial-and-error.

> The **attempt log** is now live — see the **Music Lab** guide. After you generate, log each attempt's outcome there so you learn what works over time.
`,
  },
  {
    slug: 'music-lab-logging-generations',
    title: 'Music Lab — Logging generations',
    category: 'Music Lab',
    updatedAt: '2026-06-24',
    body: `# Music Lab — turn every generation into data

Most people delete the SUNO takes that didn't work. **Music Lab** keeps them. Every attempt — keeper *or* failure — gets logged against its brief with the audio, the settings you used, scores, a verdict, and what went wrong. Over time that becomes a private dataset: which **emotion × raga × voice** combinations actually land, and why the rest don't.

Open **Music Lab** in the sidebar (\`/admin/music-lab\`).

## When to log
Right after a SUNO (or other engine) run comes back. SUNO has no API, so there's no automatic capture — logging is a quick manual step you do per take.

## How to log an attempt
1. **Pick the brief** the take came from (the dropdown lists your saved briefs from Music Director). Don't have one? Compose + **Save brief** first.
2. Fill the **Log a generation** form:
   - **Engine** — suno (or lyria / udio / other).
   - **Style variant** — which of the brief's Tamilagaval prompts you used (pre-filled from the brief).
   - **Audio** — upload the MP3 (or paste an http(s) URL). Optional — you can rate before the file is back.
   - **Settings** — the knobs you used: *weirdness* (0–100), *style influence* (0–100), and a free-text *engine/model* tag (e.g. \`suno v4.5\`).
   - **Scores** — rate **melody / vocals / lyrics / mix** 0–10. Score only what you can judge; blanks are fine.
   - **Verdict** — \`success\`, \`partial\`, or \`failed\`.
   - **Primary issue** — when it's not a success, what mainly broke (vocal delivery, mixing, pronunciation, arrangement…).
   - **Notes** — the most valuable field. Be specific: *"excellent flute intro, weak chorus transition, robotic vocals."*
3. **Log generation.** It appears immediately in the **Attempts** list (newest first) under that brief, with its verdict badge and audio player.

## Two things to know
- **You score the audio, not the AI.** An LLM can't *listen* to an MP3, so melody/vocals/mix are your call. The machine's job (later) is to find patterns across what you logged.
- **Capture first, insights later.** The "this raga + voice succeeds 70% of the time" rollups need volume to be meaningful. Log consistently now so the dataset is there when it's worth analysing.

## What's coming (Phase 2/3)
- **Find similar** + an AI report on *why your failures cluster* (e.g. "vocal_delivery fails when tempo > 130").
- Tagging great moments by timestamp → a reusable **intro / chorus / bridge** library, and reference exports for LYRIA.

> The point isn't any single song — it's that 500 logged attempts become a Tamil-music asset no one else has.
`,
  },
  {
    slug: 'music-lab-mastering',
    title: 'Music Lab — mastering a song for loudness',
    category: 'Music Lab',
    updatedAt: '2026-07-23',
    body: `# Master a song for loudness

Streaming platforms (YouTube, Spotify, Apple) normalise every track to about **-14 LUFS** — a song that's too quiet gets pushed up (hiss with it), one that's too loud gets squashed. **Mastering** here brings a finished stereo song to that streaming target — **-14 LUFS integrated, -1 dBTP true-peak** — so the whole catalogue sits at a consistent, safe level.

> ## Read this first: the current catalogue does not need this
> Measured 2026-07-23, every song already lands on target **at source** — the 11 served MP3s sit between **-14.03 and -14.89 LUFS**, and their WAV masters between **-13.58 and -14.68**. True peaks are all **-2.7 to -4.1 dBTP**, nowhere near the -1 ceiling. SUNO is already delivering at streaming level.
>
> So the largest correction available anywhere in the catalogue is **0.68 LU** — below the ~1 dB threshold where a loudness change becomes audible. Running this on the existing songs is a **no-op you can hear no difference in**, and that is the correct result, not a failure.
>
> **What it is still worth using for:** a future song that comes back off-target, a non-SUNO or externally-recorded source, or when you need one guaranteed peak-safe 24/48 WAV to hand to Premiere / a distributor. Reach for it when a measurement says a song is off — not as a routine step on every release.

## What it does — and does NOT
- **Does:** a two-pass \`loudnorm\` (measure, then correct) to -14 LUFS / -1 dBTP, written as a 24-bit / 48 kHz WAV. Level + peak only. Validated to +/-1 LU against reference ffmpeg.
- **Does NOT:** EQ, compression, saturation, stereo widening, de-essing. This is **loudness mastering, not tonal/creative mastering** — it changes a song's *level*, never its *tone*. For a flagship song that needs tonal work, send that one to a mastering service or engineer.
- Works on a **finished stereo file** — it is not mixing (no stems/multitrack).

## Start from a WAV, not the MP3
Master the **lossless source**, not the 192 kbps MP3 the site serves. Mastering a lossy MP3 only fixes its level while baking the compression artefacts in — mastering cannot recover what MP3 encoding already discarded. So:
- **New song:** export the **WAV from SUNO** (its *Premier* plan — nothing to do with Premiere Pro), upload *that* to \`tamil-web-media\`, and point \`s3Key\` at the WAV.
- **Older song:** its WAV master is in the \`tamilagaval-audio-masters\` bucket (Glacier Instant Retrieval — no restore wait). **The worker cannot read that bucket** — its IAM role grants S3 only on \`tamil-web-media\`. Copy the WAV across first (both buckets are \`us-east-1\`, so this is a fast server-side copy):
  \`\`\`bash
  aws s3 cp "s3://tamilagaval-audio-masters/audio/poem-music/SONG.wav" \\
            "s3://tamil-web-media/audio/masters-staging/SONG.wav"
  \`\`\`
  then master \`audio/masters-staging/SONG.wav\`.
- The master **output is itself a WAV** (24-bit / 48 kHz) — ideal to bring straight into a video editor with no generation loss.

## Before you start
- The song's audio must already be an **object in \`tamil-web-media\`**. You need its **key** — the path after the bucket, e.g. \`audio/poem-music/en-mannavane.wav\`. If a song plays on the site, its \`audioUrl\` is the CDN domain + this key.
- You must be **logged into the admin portal** — the mastering endpoints are admin-gated.

## How to run it — use the Sound Engineering page
> **There is a UI for this now: [/admin/mastering](/admin/mastering).** Drop in the WAV, pick -14 (Spotify/YouTube) or -16 (Apple), press Master, and download the result. It shows the before/after loudness on screen, so nothing below is needed for normal use. The job keeps running if you navigate away and re-attaches when you come back.
>
> The rest of this section is the manual API path, kept for scripting and debugging.

**1. Start the job.** Logged into \`/admin\`, open the browser dev-console and run:
\`\`\`js
// Your Cognito ID token — the same one adminFetch sends.
const token = localStorage.getItem(
  Object.keys(localStorage).find(k => k.endsWith('.idToken'))
);
const r = await fetch('/api/admin/music-lab/master', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ s3Key: 'audio/masters-staging/YOUR-SONG.wav', target: -14 }),
}).then(x => x.json());
console.log(r); // { success: true, jobId: '...', status: 'queued' }
\`\`\`
The job is rejected with a 400 if \`target\` is not a number in **[-70, -5]**, or if \`s3Key\` is already a mastering output (re-mastering a master compounds the correction).

**2. Poll until done** (runs off-request, up to ~15 min; usually well under a minute):
\`\`\`js
const job = await fetch('/api/admin/music-lab/master/' + r.jobId, {
  headers: { Authorization: 'Bearer ' + token },
}).then(x => x.json());
console.log(job.status, job.masterKey, job.beforeLufs, job.afterLufs);
\`\`\`
- The enqueue response says \`queued\`; the stored job starts at \`processing\` and moves to \`done\` (or \`error\`).
- When \`done\`: \`masterKey\` is the new file, written beside the original as **\`<name>-master-14LUFS.wav\`** (the target is in the name, so a -14 and a -16 master of the same song don't overwrite each other).

**3. Verify — no download needed.** The worker re-measures its own output, so the job itself is the evidence: \`afterLufs\` should read your target within ~0.1 LU and \`afterTp\` should sit at or below -1. \`beforeLufs\`/\`beforeTp\` are what it measured going in. Your original is never overwritten.

## Full pipeline — master -> Premiere -> YouTube
Mastering is step one of getting a song onto YouTube at consistent quality:
1. **SUNO WAV -> master** here -> \`<name>-master-14LUFS.wav\` (-14 LUFS / -1 dBTP).
2. **Download** that WAV from S3 (\`aws s3 cp\` or the S3 console).
3. **Premiere Pro:** import the WAV as the audio track, edit the picture, then **export with PCM or high-bitrate AAC audio and NO loudness normalisation / added gain.**
4. **Upload** to YouTube.

**The one rule that makes it worth doing: master ONCE, then never re-touch the loudness.** If Premiere's Essential Sound "Auto-Match to -14" is on, or the export adds gain, it re-processes and cancels the master. Pass the audio through untouched, 48 kHz.

**Why bother, since YouTube normalises anyway?** YouTube turns every upload to about -14 LUFS on playback regardless. Mastering to -14 first means YouTube leaves your track **alone** instead of turning it down and flattening it — and it gives you one clean, peak-safe (-1 dBTP) master that is *also* ready for Spotify (-14) and Apple (-16), where you upload audio, not video. Master for a controlled multi-platform source, not to chase YouTube.

## Test run — already done (2026-07-23)
The pipeline was proved end-to-end on **தூக்கணாங்குருவி போல**, the catalogue's furthest-off-target song:

| | Integrated | True peak | Format |
|---|---|---|---|
| WAV source | -14.68 LUFS | -3.62 dBTP | 48 kHz stereo |
| After master | **-14.00 LUFS** | -2.94 dBTP | 24-bit / 48 kHz |

Lands exactly on target, peak-safe, linear normalisation (dynamics untouched). The Lambda's output was **bit-identical** to the same ffmpeg chain run locally, so the deployed worker is doing precisely what it claims.

It is also a **0.68 LU change you cannot hear** — which is the honest headline. The machinery is correct; the catalogue simply doesn't need it yet.

## If you want to run it on another song
1. Pick a song; get a **WAV** into \`tamil-web-media\` (stage it from the masters bucket per above).
2. Note its current loudness — a take logged in Music Lab shows the measured LUFS badge (\`hot\` / \`quiet\` / on-target). Only a genuinely off-target song will change audibly.
3. Run steps 1-2 above; wait for \`done\`.
4. Check \`afterLufs\` == your target. Then listen to both — the master should sound the same, only at a steadier level.

> Rule of thumb: a song already near -14 LUFS barely changes — that's correct, not a failure. The win is on the quiet and hot outliers, and right now you have none.`,
  },
  {
    slug: 'streaming-distribution-spotify',
    title: 'Spotify & streaming — get the catalogue discoverable',
    category: 'Distribution',
    updatedAt: '2026-07-23',
    body: `# Spotify & streaming — get the catalogue discoverable

Streaming is the best-fit channel for a niche, loyal audience: people discover you through **playlists** and *return* through **follows, library saves, and radio** — the returning-listener loyalty the YouTube feed structurally won't give. It also rewards careful mastering (YouTube just re-normalizes over it). Right now it's your biggest untapped reach.

## Where you stand (audit, 2026-07-23)
- Artist: **TamilAgaval** — one consistent profile (good — no fragmentation across duplicates).
- **1 follower**; monthly listeners too low to display.
- **Not claimed / unverified** — no badge, bio, or photo.
- **One song** live (நீ சிரிச்ச நேரம் தான்), showing as both a Single and an Album — verify with the distributor it isn't uploaded twice.

The profile exists but is **invisible** — even your YouTube fans can't find or follow it. That's a funnel leak, not a dead end.

## Priority actions (all free, in order)
1. **Claim Spotify for Artists** — the single biggest lever. Gets the verified badge, bio, photo, Artist Pick, and access to **editorial playlist pitching** (submit **7+ days BEFORE** a release goes live). Without it you're invisible to Spotify's discovery engine. Do this first.
2. **Verify the single-vs-album duplicate** with your distributor and consolidate to one canonical release if it's really two.
3. **Publish the catalogue** — one song is the whole gap. The distributor is set up; ~20+ mastered songs sit only on YouTube. Getting them onto streaming is the reach play.
4. **Cross-link YouTube -> Spotify** on every video and on the site (block below) — converts existing fans into followers, which is how "1 follower" starts climbing.

## Loudness targets for the streaming master
- Spotify / Amazon / YouTube: **-14 LUFS** integrated.
- Apple Music: **-16 LUFS**.
- True-peak ceiling **-1 dBTP** on all — matters for lossy-codec (AAC / Ogg) inter-sample overshoot.
Master to the platform target (or -14 as a safe default), and hold -1 dBTP everywhere.

## Cross-link block — paste into every YouTube description
\`\`\`
🎧 Also on streaming:
Spotify: https://open.spotify.com/artist/4g3qEBWfbh8SXdk8QjhUg0
Apple Music: [your Apple Music artist link]
\`\`\`
Also add a "Listen on Spotify" link on tamilagaval.com so the site converts too.

## Reference links
- Artist profile: https://open.spotify.com/artist/4g3qEBWfbh8SXdk8QjhUg0
- First single: https://open.spotify.com/track/6rcEtnhENEpRxDVigeVgZY

> The goal isn't streaming *revenue* (negligible, ~$0.003-0.005/stream) — it's REACH and returning-listener formation. One claimed profile carrying the full catalogue does more for loyal-audience growth than anything the YouTube Shorts feed offers.`,
  },
  {
    slug: 'suno-instrument-palette',
    title: 'Instrument palette for SUNO prompts',
    category: 'Composer',
    updatedAt: '2026-06-26',
    body: `# Instrument palette for SUNO prompts (Tamil composition)

A working catalogue of instruments to draw on when writing the **style prompt** for a Tamilagaval song. SUNO responds best to plain **English instrument names + a mood adjective** ("soulful bamboo flute", "driving folk drum"). Pick a small, coherent ensemble per song — usually **one lead + one or two support + a rhythm core + a drone/pad** — and name each with its role.

## How SUNO reads instruments
- **Recognised by name** — use as-is: flute, bamboo flute, violin, cello, sitar, tabla, harmonium, acoustic / nylon / electric guitar, mandolin, piano, strings, saxophone, harp, synth, drums.
- **Describe instead of naming** — SUNO is unreliable on the Carnatic / Tamil term, so give the family + texture:

| You want | Prompt it as |
|---|---|
| Mridangam | "South Indian classical hand drum" / "double-headed tabla-like drum" |
| Nadaswaram | "South Indian double-reed wind, shehnai-like, bright and reedy" |
| Veena | "Indian classical plucked strings, sitar-like with gamaka glides" |
| Thavil | "loud festive folk barrel drum" |
| Ghatam | "clay-pot hand percussion" |
| Kanjira | "small frame drum / tambourine" |
| Parai / Thappu | "driving folk frame drum" |
| Udukai | "hourglass talking drum" |
| Morsing | "jaw-harp twang" |
| Konnakol | "rhythmic vocal percussion (spoken syllables)" |

- Keep it to **2–4 named instruments** — piling on ten muddies the mix. Add a **tempo/BPM** and a one-word **production feel** (organic, cinematic, lo-fi, retro-film).

## By family

**Plucked & bowed strings (melody, warmth)** — Veena (lead/countermelody), Sitar, Carnatic violin (gamaka-heavy, soulful), Cello (sorrow), Acoustic/Nylon guitar (intimate), Carnatic mandolin (bright lead), Santoor (shimmer), Sarangi (vocal-like ache), Tanpura (drone), Harp + lush string section (cinematic).

**Winds (the Tamil melody soul)** — Bamboo/Carnatic flute (love, longing, pastoral — the most-reached-for lead), Nadaswaram (temple, wedding, grandeur), Shehnai, Carnatic saxophone (smooth film), Clarinet, Ney / pan flute (lonely, breathy).

**Percussion (rhythm core)**
- **Classical:** Mridangam, Kanjira, Ghatam, Morsing.
- **Folk / festive:** Thavil (with nadaswaram), Dholak / Dhol, Parai, Thappu / Thappattam, Udukai.
- **Modern:** full drum kit, cajon, congas / bongos, claps, shakers, finger cymbals (jalra), 808 / trap kit for fusion.
- **Vocal:** Konnakol.

**Keys & harmony** — Harmonium (devotional / film), Piano (ballad, cinematic), Rhodes / electric piano (warm modern), Organ, Synth pads & strings (contemporary bed).

**Bass & low end** — Acoustic / electric bass, Synth bass, Sub / 808 (modern fusion).

**Texture & atmosphere** — Tanpura / shruti-box drone, ambient pads, swells, temple bells / chimes, vinyl-crackle lo-fi, reverb-washed plucks.

## Mood → ensemble starting points

| Emotion / style | Suggested palette |
|---|---|
| Romantic melody (காதல்) | bamboo flute lead, veena/violin countermelody, nylon guitar, soft hand-drum + clay-pot, tanpura, string pad |
| Sad / longing | solo Carnatic violin or cello, sparse piano, ney, tanpura, light frame drum |
| Folk / village (கிராமம்) | nadaswaram + thavil, dhol, parai, udukai, shakers, hand claps — earthy, fast |
| Devotional / serene | harmonium, nadaswaram, temple bells, tanpura, gentle mridangam, choir pad |
| Mother / tender (தாய் பாசம்) | piano, nylon guitar, soft strings, bamboo flute, brushed percussion |
| Motivational / uplifting | string section, drum kit, dhol accents, electric guitar, piano, anthemic build |
| Modern indie / film fusion | acoustic guitar + synth pads, 808 bass, lo-fi drums, flute or violin hook over it |

## Writing it into a prompt — example
> South Indian romantic melody, ~80 BPM, female voice. Soulful bamboo flute lead, Indian classical plucked strings (veena-like) countermelody, gentle nylon guitar, soft South-Indian hand-drum and clay-pot percussion, tanpura drone, warm string pad. Organic, cinematic, intimate.

Tie the palette to the brief's **emotion + raga + voice** — the instruments are the colour on top of that structure. Log which palettes land in **Music Lab** so your go-to ensembles become data.
`,
  },
  {
    slug: 'lyric-critic-coach-draft',
    title: 'Lyric Critic — coach your own draft',
    category: 'Composer',
    updatedAt: '2026-06-29',
    body: `# Lyric Critic — coach your own draft

The **Lyric Critic** (\`/admin/compose/critique\`) reads a lyric **you wrote** and gives honest, specific feedback to sharpen it. It is the *augment-your-craft* tool: it **never writes or rewrites** your lyric — it coaches. The words stay yours.

> Not the same as the **✨ AI critic** inside Music Director. That one vets a *SUNO style prompt* before you spend a credit. This one critiques *your Tamil lyric* as a piece of writing.

## When to use it
On a draft you're still shaping — before you take it into Music Director / SUNO. Run a song you know cold first, to calibrate whether its eye is useful to you.

## How to use it
1. Open **Lyric Critic** in the sidebar.
2. Paste **your own draft** into the box (Tamil; section tags like \`பல்லவி\` / \`சரணம்\` help it reason about structure but aren't required).
3. *(Optional)* Tap **focus** chips — meter, imagery, vocabulary, emotion, originality, structure — to weight the read, and add a **note** for anything specific you want looked at.
4. Click **Critique my draft**.
5. **Give it a minute or two.** A full-ballad critique is a deep read that runs in the background (~1–2 min) — the feedback appears when it's ready. Keep the tab open; it polls for you. (It runs off-platform precisely so a long read can't time out.)

## What you get back
- **Overall** — an honest few-sentence read of the draft as a whole.
- **Strengths** — what's already working, and the lines that earn it.
- **Lines that go slack** — specific lines **quoted verbatim** + *why* each weakens the song. Never a replacement line; the fix is yours to make.
- **Word ideas** — alternative Tamil words to *consider* (a thesaurus, not an edit).
- **Questions** — sharp prompts to push your own thinking.

## How to read it (important)
It's a **sparring partner, not a judge** — fluent but fallible:
- Treat confident claims — especially **etymology** or "this is a cliché" — as *"check this,"* not verdicts. You know the language and your own voice better than it does.
- A flagged "emotional plateau" may be an intentional, steady mood — your call.
- The highest-value notes are usually the **meter / repeated-ending** patterns (hard to spot in your own work) and the question *"is there one image that could only belong to this song?"*

## If it errors
On a failure it shows a message and never breaks the page — just try again. A persistent failure usually means the AI key is unset (the page shows an "AI not configured" banner when so).
`,
  },
  {
    slug: 'upload-cadence-timing',
    title: 'Upload cadence & timing — when to publish',
    category: 'Publishing',
    updatedAt: '2026-07-18',
    body: `# When to upload — cadence, best days & times

Data-backed publishing guide for the Tamilagaval channel. The **day/time** figures are from the trailing 12 weeks (pulled 2026-07-06) — re-check periodically. For the release *system* (queue, lane sequencing, playlist routing) see **Release calendar & queue**.

## Cadence — TESTING themed-day 3–4/week (experiment, from 2026-07-20)
- **This is under test, not settled.** The earlier "~1/week" call was too strong — it over-read a **surge-confounded** correlation (the 14-in-9-days stretch coincided with the surge unwinding, which was happening anyway; cadence was never proven to be the cause). Running a **6–8-week experiment** instead.
- **The schedule under test:** 3–4 well-spaced releases per week on themed days — **Mon Love · Wed Parent · Fri Nature/Philosophy/Heritage · Weekend strong** — **never two on the same day** (same-day/back-to-back bursts are still out; well-spaced daily is a different thing).
- **The hypothesis:** different categories pull **different audience slices**, which may offset the channel-level notification/suggested budget a higher cadence spends. Whether it does is exactly what we're measuring.
- **Measure WEEKLY aggregates, not single uploads** — per-song views/subs/watch-time + weekly channel totals vs the **settled baseline** (recent settled week ≈ 30.7k views · 1,442 watch-hrs · +84 net-subs, W ending 2026-07-18; NOT the surge-inflated 4-wk avg of ~52k/2,119/+194). Control confounds (season, algo experiments, competition, song variance).
- **Revert trigger:** net-subs/week AND watch-time both down for **2+ consecutive weeks** vs the settled baseline → step back toward 2/week. Monthly gut-check: *"more subs + watch-time overall than last month?"* Objective = catalogue-building, not single-upload max. Results land in the weekly Cadence-experiment readout.

## Best days
Average daily views by weekday (trailing 12 weeks):

| Wed | Tue | Mon | Sun | Sat | Fri | Thu |
|--:|--:|--:|--:|--:|--:|--:|
| 1,954 | 1,761 | 1,580 | 1,547 | 1,308 | 1,289 | 939 |

- **Publish on Wednesday / Tuesday** (strongest); Sunday and Monday are also good.
- **Avoid Thursday** — clearly the weakest day (~half the views, and worst for new subscribers too).

## Best time
- Audience is **~93% India + Sri Lanka** (both UTC+5:30), so target **IST**, not your local time.
- Publish **~5–7 PM IST** (≈ 11:30–13:30 UTC) — so it is live and gathering early signal just before the 8–10 PM India music-watching peak (YouTube favours publishing ~1–2 hrs ahead of peak).
- Use Studio → **Schedule** to pin the exact IST time even while you are on Canada time.
- The exact hourly heatmap is **Studio-only** (Studio → Audience → "When your viewers are on YouTube") — the API cannot return it; the day + timezone guidance above aligns with it.

## Sequencing a batch
- **Lead with your strongest song** — early algorithmic impressions compound while the channel is in its breakout window.
- **Alternate emotion / style** between consecutive drops (do not put two slow melodies back-to-back) so they pull different audience slices instead of competing.

## During YPP review
- **New, distinct songs are encouraged** — an active channel releasing originals is a positive signal. Keep uploading these on the cadence above.
- **Hold duplicate / alternate-version uploads** (e.g. a folk "Version 2" of an existing song) until after approval, to avoid any near-duplicate concern during the review.

## Related — instrumentals
Per-song instrumental versions currently **underperform** (about 1/6 the views of the vocal, ~24% retention, near-zero search discovery) and do not reach the search-driven relaxing/study audience. Not a per-song priority — if pursued, they need a dedicated playlist + long-compilation lane, not scattered uploads.
`,
  },
  {
    slug: 'reach-eelam-tamil-community',
    title: 'Reach the Eelam Tamil community — distribution kit',
    category: 'Growth',
    updatedAt: '2026-07-18',
    body: `# Reach the Eelam Tamil community

**The opportunity:** ~200,000 Sri Lankan Tamil refugees in Tamil Nadu + ~2 million diaspora worldwide — an audience with a deep emotional need (homeland, மண், memory, belonging) that Tamilagaval's original, quality, *organized* homeland catalogue meets like no other channel. The fit is proven; the gap is **awareness**, i.e. distribution.

**Your biggest advantage:** you live in **Toronto (GTA)** — one of the largest Eelam Tamil communities on earth. You're embedded in a core node of your target audience: a high-trust, in-person + WhatsApp channel. Start there.

**Golden rule:** keep it **cultural, emotional, apolitical** — homeland longing + nature, never politics or liberation framing. That keeps the channel a safe, shareable home for *every* Tamil (and avoids risk in a sensitive space).

## WhatsApp share pack (ready to forward — one warm line + a link)
WhatsApp is the #1 way Eelam Tamil families share music (and it's invisible in view sources, but travels far). Share **one song per week**, never a flood.

- **எங்கள் தேசம்** (names Yaazhpaanam, Kilinochchi, Mullaitivu, Vanni, Batticaloa… — the strongest Eelam song):
  \`🌾 நம் ஈழத்து ஊர்களை நினைவுகூரும் ஒரு அசல் தமிழ்ப் பாடல் — மனதைத் தொடும். கேட்டுப் பாருங்கள்: https://youtu.be/NxgKyBINwmc\`
- **ஈழத்து மண்ணே, காலத்து பொன்னே:**
  \`❤️ "ஈழத்து மண்ணே, காலத்து பொன்னே..." — நம் மண்ணின் மணம் கமழும் அசல் தமிழ்ப் பாடல்: https://youtu.be/tw49AjsZs1E\`
- **என் தேசமே, என் சுவாசமே** (newest homeland song):
  \`🌿 "என் தேசமே, என் சுவாசமே..." — பிறந்த மண்ணின் மீதான நேசத்தை உணர்த்தும் புதிய பாடல்: https://youtu.be/akxtNVXgGf4\`
- **தாயகம் / Heritage collection** (whole homeland catalogue in one place — your organization advantage doing the work):
  \`🌾 தாயகம் பற்றிய தமிழ்ப் பாடல்களின் தொகுப்பு: https://www.youtube.com/playlist?list=PLEXvbEQYvb5A\`
- **Share Your Story** (turn listeners into community):
  \`உங்கள் ஊர், உங்கள் நினைவு — பகிருங்கள். சில கதைகள் அடுத்த பாடலாகலாம்: https://tamilagaval.com/share\`

## Community outreach playbook (over weeks, not days)
1. **Your own circle first** — forward one song (with the warm line) into family/friend WhatsApp groups; ask 3–5 trusted people to pass it on. Highest-trust distribution.
2. **GTA community nodes** — Eelam Tamil associations, temples, cultural orgs, community-event groups. Share the Heritage playlist + one song.
3. **Diaspora Facebook groups** (Eelam / SL-Tamil community groups, worldwide) — post a homeland song with the warm line; homeland/nature content is welcome and shareable.
4. **Tamil Nadu segment** — the ~200k refugees are concentrated in TN settlements; reachable through TN SL-Tamil community organizations + local WhatsApp/FB groups, where word-of-mouth compounds fast once it catches.
5. **Invite the story** — point people to /share for homeland/birthplace memories; feature the best (they become community, and possibly future songs).
6. **Cadence & tone** — one warm share per week per group (don't spam); always cultural/emotional, never political.
7. **Watch it work** — track the Sri Lanka % in YouTube Analytics over the coming weeks (currently ~8% vs ~85% India). A few dozen genuine shares this month → a few hundred next.

**Realistic note:** community word-of-mouth is a marathon, but in a tight, emotionally-connected community it *compounds*.

> **Geography confirmed 2026-07-18:** India 83% · Sri Lanka 8% · Canada 3% — unchanged from the July snapshot, so the diaspora Raj writes for is still barely reached. The whole thesis holds; this remains the biggest untapped audience.

## Ready-to-use messages

### Community / association group intro (when you're new to a group)
Use once, warmly, to introduce yourself + the channel to a group that doesn't know you yet (temple / association / community WhatsApp or FB group):

\`\`\`
வணக்கம் அன்பர்களே 🙏
நான் இராஜ் — 35 ஆண்டுகளுக்கும் மேலாக தமிழில் கவிதைகளும் பாடல்களும் எழுதிவருகிறேன். நம் தாயகம், நம் மண், நம் நினைவுகள் சார்ந்த அசல் தமிழ்ப் பாடல்களை "தமிழகவல்" YouTube சேனலில் பகிர்ந்து வருகிறேன்.

நம் ஈழத்து உள்ளங்களைத் தொடும் சில பாடல்கள்:
🌾 எங்கள் தேசம்: https://youtu.be/NxgKyBINwmc
🎵 தாயகம் பாடல்கள்: https://www.youtube.com/playlist?list=PLEXvbEQYvb5A

நேரம் கிடைக்கும்போது கேட்டுப் பாருங்கள். பிடித்தால் பகிர்ந்து, சேனலை Subscribe செய்து ஆதரியுங்கள். நன்றி. ❤️
\`\`\`

### Homeland "Share Your Story" prompt (YouTube Community post / pin)
Seed the /share campaign with the exact memory this audience feels most — pin on a homeland song:

\`\`\`
🌾 உங்கள் ஊர், உங்கள் நினைவு...
நீங்கள் பிறந்த ஊர், விளையாடிய வீதி, உங்கள் மண்ணின் வாசம் — இன்று எங்கு வாழ்ந்தாலும் மனதில் நிற்கும் அந்த நினைவை என்னுடன் பகிருங்கள். 👉 tamilagaval.com/share
சில நினைவுகள் என் அடுத்த தாயகப் பாடலாக மலரலாம். ❤️
— இராஜ் | தமிழகவல்
\`\`\`
`,
  },
  {
    slug: 'end-screen-routing',
    title: 'End-screen routing — subscriber conversion',
    category: 'Growth',
    updatedAt: '2026-07-18',
    body: `# End-screen routing for subscriber conversion

**The finding:** the channel converts ~4.1 subs / 1,000 views overall, but **song-level subscriber affinity varies 3–6×** — that is a bigger lever than the subscribe watermark. So route each discovery engine's end screen to a **proven converter within its genre cluster**, not just a thematically-similar song.

**Method:** full songs only (Shorts excluded — their subs attribute differently), 2026-04-01 → today, **min 800 views** for a reliable rate, cluster-aware (route within genre to the best subs/1k).

**Studio note:** the cleanest end screen = **ONE video element + a Subscribe element**. So below, **Target 1 = the primary end-screen video**; **Target 2 = a fallback / manual alternative** (or a playlist card). Every source also gets a **Subscribe** element.

## Routing table — do in priority order
| P | Source (discovery engine) | views | own /1k | Target 1 (primary) | Target 2 (alt) |
|---|---|--:|--:|---|---|
| **1** | எழுதாத வரியிலே · VUIpOkk62fc | 3,640 | **1.37** | காலை காற்றே · DrPPkgumCQw (8.14) | பொன்வானம் சாயுதே · d3puwsvsZdI (5.99) |
| 2 | நீ சிரிச்ச நேரம் · GXLu3Y7FghU | 24,429 | 5.40 | காலை காற்றே (8.14) | பொன்வானம் (5.99) |
| 2 | செவ்வந்தி பூவே · H5NcoS41fA4 | 13,852 | 4.26 | காலை காற்றே (8.14) | மெல்ல மெல்ல · ldgMDPRnHp0 (5.75) |
| 3 | என் மன்னவனே · eo3Mo--sgPY | 8,291 | 4.46 | காலை காற்றே (8.14) | உன்னை பார்த்தால் · lWt5kvapFKs (5.56) |
| 3 | என் பொன்மணி · KtFF0CCnCY4 | 6,622 | 4.68 | காலை காற்றே (8.14) | பொன்வானம் (5.99) |
| 3 | குறிஞ்சி மலரே · BoHXKQCfOqU | 4,320 | 3.47 | காலை காற்றே (8.14) | மெல்ல மெல்ல (5.75) |
| 4 | உன்னை பார்த்தால் · lWt5kvapFKs | 3,057 | 5.56 | காலை காற்றே (8.14) | மெல்ல மெல்ல (5.75) |

**Priority logic:** P1 = எழுதாத வரியிலே — the biggest leak (high reach × worst conversion 1.37/1k), fix FIRST. P2 = highest-reach engines (a small lift on 14–24k views = many subs). P3/P4 = mid / smaller reach.

## Reference — best reliable converters (subs/1k, ≥800 views)
- **love / melody:** காலை காற்றே **8.14** · பொன்வானம் சாயுதே 5.99 · மெல்ல மெல்ல 5.75 · உன்னை பார்த்தால் 5.56 · நீ சிரிச்ச 5.40
- **homeland:** ஈழத்து மண்ணே ♀ (tw49AjsZs1E) 7.27 · ♂ (KpWeuW_l9xc) 6.13 — (எங்கள் தேசம் NxgKyBINwmc 8.42 but only 706 views → a destination to *boost*, not a discovery engine)
- **mother:** அம்மா உந்தன் (CYVbd5a3uQ4) 6.91
- **motivational:** தம்பி நீயும் கலங்காதே (AD5xJe6CTnk) 7.29
- **folk:** கடலோடு பேசுதடி 6.49 · ஆலமர நிழல் கீழே 6.17

## Worst converters — never end-screen TO these
எழுதாத வரியிலே 1.37 · சித்திர செவ்வானம் (TqM4sChi7eQ) 0.00 · விண்ணிலே தேடிய நிலவை 1.43 (small sample) · ஒரு நாள் திருநாள் 2.29 · முடிவில்லா முகத்தினில் 2.97 · அந்தி மேகமே 3.31.

## Already done (API side, 2026-07-07)
- **Love Songs playlist now leads with காலை காற்றே** (best converter, 8.14/1k).
- All 5 discovery engines have Subscribe + playlist links in description + a pinned Subscribe CTA.
- Subscribe watermark set (entire video, all videos).

**Re-pull quarterly** as views accumulate — rates on <800-view songs firm up over time and the routing may shift.

## Conclusion (authoritative framing)
> We have now removed the obvious conversion leaks. The next 14 days test whether better subscription surfaces and cluster-aware routing can raise full-song conversion above the historical **~4.1 subs/1K** baseline. If conversion remains near 4 despite comparable traffic, the bottleneck is no longer subscribe visibility; the next strategic problem is **viewer affinity, channel identity, and returning-audience formation.**

Historical baseline: **731 subscribers from 179,684 views ≈ 4.07 subs/1K.**

> **Update 2026-07-18:** live **972 subscribers / 247k views** — the Tier-2 gap is now **~28** (was 276). The per-song routing rates above are a 2026-07-07 snapshot; **re-pull them** as views have accumulated before re-optimising the end screens.

## Precision notes (don't overstate the mechanism)
- **Watermark = an *additional* persistent subscribe surface, not the only one.** The watch-page Subscribe button already existed; the watermark adds another. And YouTube video watermarks are **NOT clickable on mobile** — so it is incremental, not a universal "one-tap subscribe."
- **End-screen routing does NOT transfer the destination's rate.** காலை காற்றே's 8.14/1K describes *its own* historical audience mix; viewers referred from நீ சிரிச்ச may convert differently. The experiment specifically tests whether **referred discovery-engine viewers retain higher subscriber affinity** on the converter — it is a hypothesis, not a guaranteed 8.14.
- **Realistic magnitude:** at ~6,857 views/day, lifting 4.07→5.5–6.0 subs/1K ≈ **27.9/day → 37.7–41.1/day (+10–13/day)**; the 276-sub gap (724→1,000) closes in **~9.9 days vs ~6.7–7.3 days ≈ ~3 days saved** (traffic and net-subs fluctuate). Meaningful, not transformative — the conversion stack *harvests existing reach more efficiently*; **content selection + channel identity are the larger long-term levers.**
`,
  },
  {
    slug: 'youtube-credit-block-policy',
    title: 'YouTube credit block — the canonical policy',
    category: 'Publishing',
    updatedAt: '2026-07-18',
    body: `# YouTube credit block — the canonical policy

Every song description uses ONE standard credit block. This keeps the catalogue consistent and keeps our public positioning right: **lead with authorship, be transparent about production, never let the tooling read as the principal creator.**

## The block (use this exactly, every upload)

\`\`\`
✍️ Lyrics: Raj (original, all rights reserved)
🎵 Music Production & Creative Direction: TamilAgaval.com
🤖 AI-Assisted Music Production
© 2026 TamilAgaval / Raj Thangarajah
\`\`\`

## Never use these phrases in a description
| ❌ Banned | Why | ✅ Instead |
|---|---|---|
| \`Music composition: AI-assisted\` | Makes the tool sound like the principal creative identity | \`AI-Assisted Music Production\` (Raj's lyrics + musical direction + prompt/version/vocal/style decisions = TamilAgaval's creative direction) |
| \`100% original\` (bare marketing claim) | A sweeping AI-authorship claim is jurisdiction-specific and fact-dependent (Canada policy still evolving) | \`Lyrics: Raj (original, all rights reserved)\` — a plain rights assertion on the lyrics, **not** a "100%" claim |
| \`Rajeswaran Thangarajah\` (full name) | Keep the public credit brand-owned | \`Raj\` in the credit; \`Raj Thangarajah\` only in the © line |

Never name a specific AI tool (SUNO, Lyria, etc.) — anywhere, public or in records. The music belongs to Tamilagaval.

## How it's enforced (you don't hand-type it)
The composer's **"📋 Copy ready-to-paste"** button (\`/admin/compose\`) now bakes the block in automatically:
1. The AI model is instructed **not** to write any credit / subscribe / link lines.
2. The assembler (\`src/lib/youtube-description.ts\`) **strips any legacy-credit line** the model might still emit, then appends the canonical \`CREDIT_BLOCK\`.
3. Output order is always: **song body → credit block → Subscribe/site/playlist links → hashtags**.
4. A test (\`__tests__/lib/youtube-description.test.ts\`) fails the deploy if the banned phrases ever reappear — so the policy can't silently drift back.

## How to verify
- **Live:** open \`/admin/compose\`, compose any song, click **Copy ready-to-paste** on the Tamil or English description card → the pasted text contains the block above and none of the banned phrases.
- **Automated:** run \`npx jest youtube-description\` → the "permanent credit block" tests confirm the block is emitted and the banned phrases are stripped even when present in the AI body.
- **Catalogue:** open any song on YouTube and expand the description; the 4-line block should be there.

## History
- **2026-07-08:** swept the whole back-catalogue — **56 videos** migrated from the old \`Lyrics & poetry: 100% original… / Music composition: AI-assisted.\` wording to the (then 3-line) block, and locked the composer so new uploads stay consistent.
- **2026-07-18:** block extended to **4 lines** — added the rights wording \`(original, all rights reserved)\`, \`.com\` on the production line, and a copyright line \`© 2026 TamilAgaval / Raj Thangarajah\`. \`CREDIT_BLOCK\` + its deploy-gating test updated in the same change; back-catalogue re-swept to match (74 eligible AI-original songs). **Excluded:** \`0ftkBzL3qJI\` (human-produced — composer Kapileshwer, real singers) and \`dCFlupQYR2M\` (Bharathiyar's lyrics, not Raj's) — false attribution would result.
`,
  },
  {
    slug: 'promote-card-free-playbook',
    title: 'YouTube "Promote" card — the free playbook',
    category: 'Growth',
    updatedAt: '2026-07-15',
    body: `# When YouTube offers to "Promote" a song

Studio's **"Ideas for you → Get up to N more impressions… Promoting <song> can help"** card is not a free reach feature — it's an upsell for a **paid Google Ads video campaign**. The "2,000–6,900 impressions" is what a small ad spend would buy. This guide is the standing decision + the free alternative that does more.

## The decision: hold on paid promotion
Default answer is **no** for now. Reasons, in order:

- **Paid ads are deferred** (no budget allocated this cycle). Nothing about a Promote card changes that — it appears on every video, all the time.
- **Rented reach, not owned demand.** An impression spike lasts exactly as long as the spend. Our reach is already ~84% algorithm-fed; paying widens the *rented* slice, not the owned floor we're trying to build (Status / WhatsApp shares, returning listeners).
- **It doesn't advance YPP.** Watch time from Google Ads promotion **does not count** toward the 4,000 public watch-hours for monetization (confirm in Studio, but that's the standard policy). Paying for views that don't move the watch-hour goal is poor value while that's the target.
- **Weak ROI at this stage.** At a typical 4–8% CTR, ~2–7k impressions ≈ ~100–500 views. A handful of organic WhatsApp forwards can match that for free — and those viewers are warmer.

**When paid ads *would* be worth revisiting:** a specific song with proven strong retention + subscriber conversion, a real budget, and a goal other than watch-hours (e.g. a launch push once monetization is live). Revisit then, deliberately — not off a Studio nudge.

## The free playbook (do this instead)
1. **WhatsApp share** — our single best owned source, zero cost. One warm line + the link into family/community groups. One song per group per week; never a flood.
2. **YouTube Community post** to subscribers — a free push to people who already opted in.
3. **Right playlist + cross-links** — make sure the song sits in its themed playlist and is cross-linked from related songs' end screens.

## Ready-to-use — "அன்பை சுமந்து சுமந்து" (father song · kOpNZHlE9FE)
Universal, emotional framing — a father's love every heart recognizes. Respectful \`-உங்கள்\` register; no politics; the story stays the listener's own.

### YouTube Community post
\`\`\`
❤️ "அன்பை சுமந்து சுமந்து..."

தந்தையின் அன்பு — சொல்லில் அடங்காதது, காலத்தில் மறையாதது.
அந்த அன்பை நினைவுகூரும் ஒரு அசல் தமிழ்ப் பாடல்.

உங்கள் நெஞ்சைத் தொடும் என நம்புகிறேன். கேட்டுப் பாருங்கள் 🎧
👉 https://youtu.be/kOpNZHlE9FE

பிடித்தால், உங்கள் அன்புக்குரியவர்களோடு சேர்ந்து கேளுங்கள். ❤️
— இராஜ் | தமிழகவல்
\`\`\`

### WhatsApp forward (one line + link)
\`\`\`
❤️ "அன்பை சுமந்து சுமந்து..." — தந்தையின் அன்பை நினைவுகூரும் ஒரு அசல் தமிழ்ப் பாடல். மனதைத் தொடும். கேட்டுப் பாருங்கள்: https://youtu.be/kOpNZHlE9FE
\`\`\`

> Also add it to the **Father Songs** playlist and pin the Community post. Keep the tone 100% emotional/universal.

## A "Share to Status" clip for this song is blocked
The auto clip generator (\`scripts/generate-song-short.ts\`) pulls the MP3 + cover from the public catalogue (\`/api/songs\`). This song **isn't in that catalogue** (no \`/content\` page / CDN audio yet), so the clip can't be auto-cut. To unblock: give the script an accessible MP3 (an S3/CDN URL or a local path) with \`--audio\` — YouTube itself can't be used as the source (yt-dlp is bot-walled).
`,
  },
  {
    slug: 'release-calendar-queue',
    title: 'Release calendar & queue — cadence + playlist routing',
    category: 'Publishing',
    updatedAt: '2026-07-18',
    body: `# Release calendar & queue

**The one rule that matters: decouple *creating* from *releasing*.** Compose as freely as inspiration allows — then hold finished songs in the queue below and publish **one strong hero song per week**. The catalogue is already deep enough to run on; you never need to publish as fast as you create.

Why: the subscriber-notification + "suggested" test budget is **channel-level, not per-category**. Two uploads a few days apart compete for the same attention even if they're different genres — so bursts starve every new song of the early breakout velocity it needs. Diversity is an asset for *catalogue depth and search*, not a licence for a faster cadence.

> Companion guide: **Upload cadence & timing** has the data-backed best days/times (target IST; lead with your strongest). This guide is the *system* — the queue, lane sequencing, and playlist routing.

## Weekly rhythm — TESTING themed-day 3–4/week (experiment from 2026-07-20)
- **3–4 well-spaced releases per week, one category per day:** Mon Love · Wed Parent · Fri Nature/Philosophy/Heritage · Weekend strong. **Never two on the same day.** (This supersedes the earlier "1/week", which was too strong — it's under a 6–8-week test; see the **Cadence & timing** doc for the rationale + revert rule, and the weekly Cadence-experiment readout for results.)
- **One category per day** keeps a predictable rhythm for the algorithm *and* subscribers, and different categories (love / parent / philosophical) pull different audience slices — which may offset the channel-level notification budget a higher cadence spends. That's the hypothesis being tested.
- **Publish ahead of the India/diaspora evening peak** (see the timing guide) and **seed your WhatsApp Status at publish**.
- **Judge weekly aggregates, not single uploads.** Objective = building the catalogue (decades of lyrics), not maxing one video.
- **Lead with reach, follow with resonance within the week:**
  - *Reach lane* (broad love / melody / folk) chases breadth and fuels suggested.
  - *Resonance lane* (grief / heritage / niche) is low reach, high advocacy; release these to ride the audience a reach song just built — not two niche songs back-to-back.

## Release queue *(fill in — newest at the bottom)*
| Target date | Song (Tamil / romanized) | Lane | Playlists | Notes |
|---|---|---|---|---|
| YYYY-MM-DD | … | reach | Love, All, Latest | hero |
| YYYY-MM-DD | … | resonance | Heritage, All, Latest | |
| backlog | … | | | finished, unscheduled |

Keep a running **backlog** row; each week promote the strongest one to the next dated slot.

## Alternate versions — publish quietly
Male/female cuts, flute instrumentals, and Shorts should **not** burn the weekly hero slot (they diluted the 14-in-9-days stretch). Publish them spaced out, add straight to their playlist, cross-link to the main version, and skip the notification-heavy push.

## Playlist routing (every release → All Songs + its theme + Latest)
| Song type | Theme playlist |
|---|---|
| Love | ❤️ காதல் / Love |
| Sad / breakup love | 💔 சோகக் காதல் |
| Mother / family | 👩 தாய் |
| Father | 👨 அப்பா |
| Homeland / heritage / village | 🌾 தாயகம் |
| Bharathiyar (classical poem) | 🪶 மகாகவி பாரதியார் |
| Flute / instrumental | 🎋 இசை மட்டும் |
| Short | 📱 குறும்படங்கள் |
| **Every song** | 🎵 அனைத்து / All Songs (\`PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs\`) |
| **Every song (curated)** | ⭐ புதிய / Latest (\`PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU\`) — keep to **newest 12**: add the new one, remove the oldest |
| Best-of (hand-picked) | 🌟 Start Here |

## Per-release checklist
Bilingual title (Tamil hook + romanized + English) · tags incl. the **romanized song name** · description (Lyrics credit, tamilagaval.com, one-tap subscribe, playlists, hashtags) · add to the playlists above · pinned channel comment · standard Tamil caption track · Community-tab teaser · Studio **AI-use = No**.

## Between uploads — let the catalogue work
No new song this week? The channel still grows via playlists (session time), the Short→full-song funnels, pinned comments, WhatsApp Status shares, and search (romanized + Tamil titles). Reach is **re-fuelled by the next strong hero**, not by uploading more, faster.
`,
  },
  {
    slug: 'monetization-ad-settings',
    title: 'Monetization — ad settings & ad-free songs',
    category: 'Publishing',
    updatedAt: '2026-07-20',
    body: `# Monetization — ad settings & which songs stay ad-free

Channel monetized 2026-07-20 (Tier-2 approved — Watch Page ads + YouTube Premium). Money on your terms: **light ads, tributes ad-free, music first.**

## The rules
- **Mid-roll ads OFF on every song.** They break a 4–6 min song mid-emotion — killing the retention that's the channel's biggest strength, and dragging watch-time down (which also confounds the cadence experiment). Keep skippable **pre/post-roll only**.
- **Grief / tribute songs = fully ad-free.** No ad belongs on a song about a lost parent.
- **Lean on fan-funding over ad density.** Super Thanks (unlocked at Tier-2) converts an emotionally-connected audience far better than more ads, and never touches the listening experience.

> **Long-form exception (2026-07-20):** *அன்பை சுமந்து சுமந்து* (\`kOpNZHlE9FE\`, the Father song) is 12+ min, so ads were deliberately enabled on it — pre/post-roll **off**, one **manual mid-roll break at 5:16** (nothing before). It is intentionally NOT on the ad-free list below.

## Keep ad-free — Tier 1 (grief / loss / parent tribute)
| Video | Song |
|---|---|
| \`2AlTwv45AiQ\` | அன்னையும் இல்ல... தந்தையும் இல்ல (lost both parents) |
| \`CYVbd5a3uQ4\` | அம்மா உந்தன் நினைவுகள் |
| \`DozdKmt0cLY\` | கண்ணோடு நீர் அள்ளி |
| \`xT2lbQwF7Zk\` | தந்தையே எங்கள் தெய்வம் |
| \`pkDhDVtXSnk\` | இரை தேட சென்ற தாய் பறவை |
| \`NCysfKUKXwQ\` | ஒரு கண்ணால் மறு கண்ணை |
| \`c61mxpSgAAA\` | அரிதான பெரும் பாசம் |
| \`h1WgaJW9khI\` | செவ்விழி ஓவியமே |

## Consider — Tier 2 (heavy, but not grief — your call)
- Reflective: \`vR5gYh3MvDI\` மண்ணிலே தோன்றி · \`twsUzpzILTE\` இதுவும் கடந்து போகும்
- Homeland: \`tw49AjsZs1E\` / \`KpWeuW_l9xc\` ஈழத்து மண்ணே · \`akxtNVXgGf4\` என் தேசமே · \`NxgKyBINwmc\` எங்கள் தேசம்

Everything else (love / melody / folk) is fine to monetize with light ads.

## How to apply (Studio)
1. **Global default (future uploads):** Settings → Upload defaults → Monetization → Ad types → **uncheck mid-roll**.
2. **Existing catalogue in bulk:** Content → select all → Edit → Monetization → Ad types → **uncheck mid-roll**.
3. **Tier-1 fully ad-free:** Content → select those 9 → Edit → Monetization → **Off**.

Revenue lives in the Monetization panel at \`/admin/analytics\` (and Studio → Revenue). India-heavy audience = low CPM, so it stays modest — the milestone + fan-funding matter more than ad dollars.
`,
  },
  {
    slug: 'reading-impressions-and-reach',
    title: 'Reading impressions & reach — what the numbers actually mean',
    category: 'Growth',
    updatedAt: '2026-08-08',
    body: `# Reading impressions & reach

Impressions are the most misread number on this channel. This page exists so the same question doesn't have to be re-answered from scratch.

## Impressions are Studio-only — not a bug, not a permissions problem

\`impressions\` and \`impressionsClickThroughRate\` are **not in the YouTube Analytics API**. Requesting them returns \`HTTP 400 — Unknown identifier\`, while \`views,estimatedMinutesWatched\` on the same window succeeds. Verified again 2026-08-08.

So nothing automated — no cron, no dashboard panel — can read impressions. Only **Studio → Analytics → Reach** has them. Everything else uses **suggested-video views** (\`insightTrafficSourceType = RELATED_VIDEO\`) as a proxy, and should say so.

The API's \`cardImpressions\` / \`annotationImpressions\` are a different thing (cards and end screens) and read 0 here.

## Always compare against the pre-surge baseline, never the peak

The channel had a one-off surge that peaked in early July. Measured weekly, finalized through 2026-08-05:

| Week | Views | Net subs | Retention |
|---|---|---|---|
| May 21–27 | 2,418 | +11 | 19.2% |
| Jun 4–10 | 2,520 | +14 | 22.1% |
| Jul 2–8 (peak) | 75,496 | +259 | 43.4% |
| Jul 23–29 | 39,672 | +96 | 45.8% |
| Jul 30–Aug 5 | 30,678 | +97 | 51.1% |

Read from the peak, views are **down 59%**. Read from the pre-surge baseline of ~2,400/week, they are **12.8x higher**. Both are true; only the second describes the channel.

The peak lasted about four days. It was never the normal level, and a decline back toward the trend is not a collapse.

## Retention is the number that tells you if something is actually wrong

Retention has risen **every week for eleven weeks — 19.2% to 51.1%**, an all-time high, and 7.7 points above the peak week.

That matters because it settles the causal question. If falling impressions were *causing* a decline, retention would fall with them — the same audience, reached less. Instead the audience that still arrives watches **more than half** of each song.

**Fewer impressions + higher retention = better matching, not suppression.** YouTube narrowed the funnel and the narrowing improved it.

## The direction of causation

Impressions are downstream of performance, not upstream. YouTube serves impressions based on how the last batch converted. A falling impressions line is usually a **symptom**, not the disease.

There is also a real, benign mechanism behind what Studio shows: YouTube reallocates impression *inventory* toward a new upload during its test window, so older songs genuinely dip. The views data shows they **recover**. A dip that recovers and a dip that persists look identical on the day you check — only the trajectory separates them.

## Three tests that settle "new uploads are cannibalising my old songs"

Run these before accepting the claim (all reproducible from the Analytics API):

1. **Cadence-invariance.** Uploads/week were near-constant Jun 15 to Jul 31 (10, 11, 8, 10, 9, 7, 7) while old-song views/day swung 2,643 to 7,873 to 2,182. A constant input cannot cause a 3x swing.
2. **Upload-day null.** Over 21 days, the 8 biggest pre-July songs averaged 2,372 views/day on upload days vs 2,360 on quiet days — 0.5% apart. No upload-day dent. (Exclude the surge-tail outlier or the raw figure misleadingly shows -12%.)
3. **Compounding.** 63 uploads since Jun 15. A -50% penalty per upload would leave 1.1e-19 of baseline reach. Actual: -17% while the catalogue grew 49 to 90 songs. Any multiplicative per-upload penalty is arithmetically impossible.

The settled finding is **dilution, not cannibalisation** — more songs sharing the same total. Which is why **cutting cadence does not raise total reach**.

## Two measurement traps that have caused false alarms

- **Unfinalized days.** Analytics lags ~2-3 days. Studio *displays* recent days but under-reports them and they settle upward. Always state the latest finalized day. When bucketing weeks, divide by the days actually present — a 7-day bucket holding 5 finalized days once produced a false "-41%".
- **Unequal-age comparison.** Comparing a 3-day-old song to an 8-day-old one will show "the algorithm turned against me" every time. Compare **day-1 to day-1, day-7 to day-7**. One such pair looked like a collapse in Studio; aligned at day 1 the newer song was actually ahead (593 views / 33% AVP vs 510 / 32%).

## What to do when reach genuinely decays

Not paid advertising — ruled out, and it would not address the cause.

The structural issue is that **~84% of traffic is algorithm-fed, i.e. rented**. A surge decays and nothing you own catches the people it brought. The durable answer is owned distribution — the WhatsApp Channel, the email list, playlists (already ~28% of views and holding steady while suggested fell 40%).

Judge the channel on **retention, net subscribers, and playlist/subscriber views**. Those are the signals you influence. Impressions are the algorithm's opinion of last week.
`,
  },
];

/** Docs grouped by category, in registry order, for the sidebar. */
export function docsByCategory(): Record<string, AdminDoc[]> {
  return ADMIN_DOCS.reduce<Record<string, AdminDoc[]>>((acc, d) => {
    (acc[d.category] ||= []).push(d);
    return acc;
  }, {});
}

export function getDoc(slug: string): AdminDoc | undefined {
  return ADMIN_DOCS.find((d) => d.slug === slug);
}
