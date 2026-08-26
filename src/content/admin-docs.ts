/**
 * In-app admin documentation registry. Plain markdown strings rendered by the
 * /admin/docs viewer (parsed via src/lib/markdown-blocks.ts — no runtime DB, no
 * external dep). Add a new guide here and it appears in the portal. Keep
 * `updatedAt` current when you edit a doc.
 */

import { LEXICON_WORD_GROUPS, LEXICON_WORD_COUNT } from '@/content/lexicon-word-list';

export interface AdminDoc {
  slug: string;
  title: string;
  category: string;
  /**
   * When this doc was last updated. Accepts either a date-only string
   * (`YYYY-MM-DD`) — how everything was written before 2026-08-21 — or a full
   * ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SSZ`). The viewer formats both;
   * date-only renders "21 Aug 2026", full timestamp renders "21 Aug 2026 · 19:47 UTC".
   * For a NEW edit prefer the full timestamp so the audit trail is precise —
   * the sidebar list shows this alongside every entry.
   */
  updatedAt: string;
  body: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an `AdminDoc.updatedAt` for display. UTC throughout to keep the
 * server render and the client render byte-identical (locale-based formatters
 * would trip hydration on any admin whose browser is not en-GB / UTC).
 *
 * Date-only input (`2026-08-21`)          → `21 Aug 2026`
 * Full ISO input   (`2026-08-21T19:47:00Z`) → `21 Aug 2026 · 19:47 UTC`
 * Anything unparseable falls back to the raw string so a bad entry is
 * visible rather than silently blank.
 */
export function formatDocUpdatedAt(iso: string): string {
  if (!iso) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = MONTHS[d.getUTCMonth()];
  const yy = d.getUTCFullYear();
  const dateStr = `${dd} ${mm} ${yy}`;
  if (dateOnly) return dateStr;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dateStr} · ${hh}:${mi} UTC`;
}

export const ADMIN_DOCS: AdminDoc[] = [
  {
    slug: 'start-here',
    title: 'Start here — what to read, in what order',
    category: 'Start here',
    updatedAt: '2026-08-10',
    body: `# Start here

These guides accumulated one problem at a time, so reading them front to back is not the fastest way in. This is the order that builds on itself.

## If you have ten minutes

Read these three. Almost every wrong conclusion about the channel comes from not knowing one of them.

1. **Reading impressions & reach** — what the numbers mean, and the three ways a healthy channel looks like it is collapsing.
2. **Video length & average view percentage** — why a 10-minute song reports 29% and that is not a weak song.
3. **Monetization → What the money actually depends on** — net vs gross, and why the RPM is what it is.

## Writing a song

| order | guide | what it gives you |
|---|---|---|
| 1 | பாடல் எழுதுதல் — முறையான கற்றல் வரிசை | the craft itself, in Tamil, and which tools cover which skill |
| 2 | Lyric Critic — coach your own draft | feedback on a line without anyone rewriting it |
| 3 | Instrument palette for SUNO prompts | naming the sound you already hear |
| 4 | Tamilagaval Pre-flight — how to test / how it works | vetting a prompt before spending a generation |
| 5 | Music Lab — logging generations | keeping track of what you tried |
| 6 | Music Lab — mastering a song for loudness | getting to −14 LUFS without clipping |

**The rule underneath all of these:** no tool here rewrites your line. They tell you *where* something slackens and *why*. The decision stays yours.

## Publishing it

| order | guide |
|---|---|
| 1 | Release calendar & queue — cadence + playlist routing |
| 2 | Upload cadence & timing — when to publish |
| 3 | YouTube credit block — the canonical policy |
| 4 | Monetization — ad settings & ad-free songs |
| 5 | **Publishing traps — things that fail silently** |

Read the traps guide **before** your next upload, not after. Every entry in it cost real time, and none of them announce themselves.

## Growing the audience

| order | guide | the idea |
|---|---|---|
| 1 | Reading impressions & reach | learn to read the dashboard before acting on it |
| 2 | Reach the Eelam Tamil community | why hand-sharing is the only route to the diaspora |
| 3 | End-screen routing | turning a watch into a subscriber |
| 4 | YouTube "Promote" card | the free playbook |
| 5 | Spotify & streaming | making the catalogue discoverable off YouTube |

## The four things worth remembering

**Reach is rented.** ~84% of views come from YouTube's recommendation engine, and it decides who sees you. Your own audience — subscribers, playlists, WhatsApp — is the part nobody can switch off.

**Theme does not decide geography, distribution does.** Homeland songs reach 1–2% diaspora; a song about the Tamil language reaches 28%. You already own what that audience wants; they never see it.

**Ads follow the audience, not the effort.** One US view is worth about 88 Indian ones. Revenue changes when *who watches* changes — or when you sell something.

**The API response is not proof.** Privacy, schedules, branding, tags — all of them have returned a clean 200 while changing nothing. Verify with a fresh read.
`,
  },
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
    updatedAt: '2026-08-21T19:47:00Z',
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

## Compare before & after

Once a master lands, the Sound Engineering page shows an A/B compare player right below it. The source WAV and the mastered WAV load into a shared Web Audio graph and play in **lock-step**: hitting **A** or **B** (or ← / →) swaps which one is audible at the *same instant of the song*, so you can judge the difference honestly. **Space** plays / pauses; **j / l / k** mirror the YouTube shortcuts (back 10, forward 10, play/pause).

**Match loudness is on by default — and it should be.** The louder of two clips always seems better; without matching, you would just be proving that the master is louder, which the numbers already tell you. With matching on, both sides are pulled to the quieter one's level via the measured integrated LUFS, so you are comparing the *sound*, not the loudness. Turn it off ("True levels") when you *want* to hear the level change — but never for a "which is better" call.

Volume rides a **shared output stage** after the A/B split, so it scales both sides identically and cannot skew the comparison. Playback rate does the same. Two things the player deliberately does NOT do: fade between A and B (a hard swap is what mastering engineers use — a fade blends what should be a difference into a haze), and touch EQ or tone (the whole promise of this module is *loudness only, never tone*; the player must not violate it either).

**When it earns its keep:**
- After running a **0.68 LU change** on a song that was almost on target — the honest answer will usually be "I can't tell", which is the correct answer and worth confirming rather than assuming.
- When comparing a **hot** or **quiet** outlier against its corrected master — turning match *off* then genuinely shows the loudness fix; turning it back *on* confirms nothing else moved.
- Between **two masters of the same song at different targets** (-14 vs -16 for Spotify vs Apple) — the prev / next arrows step through them without leaving the player.

**When it is misleading:** if the source and the master have different silence bounds (a trimmed intro on one, not the other), the lock-step alignment plays the same *clock position* but not the same *musical position*. The pre-master analysis flags trim proposals so this can be applied consistently — but if you master with a trim and then A/B, position N in the master maps to position N + trim in the source. Rewind to a point past both intros before switching.

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
    slug: 'music-lab-reference-mastering-plan',
    title: 'Music Lab — reference-matching feasibility assessment (revised, PROPOSAL)',
    category: 'Music Lab',
    updatedAt: '2026-08-26T21:24:24Z',
    body: `# Reference-matching feasibility assessment

> **Status: PROPOSAL — Phase 1A spike, no production code touched.** This replaces an earlier draft that had wrong license info + over-broad scope. Recommendation at the bottom is **GO WITH CHANGES → Phase 1A only** (spike first, decide on Phase 1B after evidence).

> **Two corrections from the earlier draft up front:**
> - **Matchering is GPL-3.0-or-later, NOT MIT.** Verified against PyPI. Isolation strategy is mandatory (see §4).
> - **Do not claim fair-use for storing commercial reference tracks.** Phase 1 uses TamilAgaval-owned masters only.

## 1. Current architecture discovered

| Component | State |
|---|---|
| **Master-worker Lambda** | \`tamilagaval-master-worker\` · nodejs20.x · **3008 MB · 900s · 4096 MB ephemeral · Zip package** · has ffmpeg Lambda layer (~30 MB) |
| **Role** | \`tamilagaval-compose-worker-role\` (SHARED with compose-worker) — 3 inline policies: \`compose-worker-ddb\`, \`music-lab-s3-takes\` (L1-scoped to \`tamil-web-media/audio/mastering/*\` per 2026-08-21 fix), \`read-compose-worker-secrets\` |
| **S3 workspace** | \`tamil-web-media/audio/mastering/*\` in us-east-1; Lambda in ca-central-1 (cross-region reads handled via \`TAKES_BUCKET_REGION\` env) |
| **Bucket protection** | CloudFront OAC allowed on \`/*\`, explicit \`Deny\` Sid \`DenyCloudFrontOnMasteringWorkspace\` on \`audio/mastering/*\` — workspace is API-only |
| **Job orchestration** | Existing route creates \`MASTERJOB#<id>\` DDB item (24h TTL), Event-invokes \`master-worker\` Lambda, worker \`UpdateItem\`s status. Client polls \`GET /api/admin/music-lab/master/[jobId]\`. **No SQS, no Step Functions.** |
| **Deploy pattern** | \`esbuild → zip → aws lambda update-function-code\`; scripts as \`npm run deploy:master-worker\` |
| **Feature flags** | \`FEATURES.ADMIN\` in \`src/config/features.ts\` — 3 flags today. Comment warns against dead flags — only add if wired. |
| **UI** | \`src/app/(admin)/admin/mastering/page.tsx\` — 2073-line client component with A/B compare player |

## 2. Files / components that would need modification

Only when Phase 1B starts. Phase 1A touches NOTHING in the production codebase.

| Type | File | Purpose |
|---|---|---|
| **New** | \`worker/matchering_worker/handler.py\` + \`Dockerfile\` + \`requirements.txt\` | Python container Lambda |
| **Modify** | \`worker/master-worker.ts\` | After loudnorm, if event carries \`referenceKey\`, Event-invoke Python worker |
| **Modify** | \`src/types/masterJob.ts\` + \`MasterJobRepository.ts\` | Sparse-add new optional fields (§9) |
| **Modify** | \`src/app/api/admin/music-lab/master/route.ts\` | Zod: \`referenceId?\`, \`matchingMethod?\` |
| **New** | \`src/lib/mastering-references.ts\` | Reference model + S3 layout helpers |
| **New** | \`src/app/api/admin/mastering/references/…\` | CRUD (deferred to Phase 1C) |
| **Modify** | \`src/config/features.ts\` | \`MASTERING_REFERENCE_MATCHING: false\` |
| **Modify** | \`package.json\` | \`deploy:matchering-worker\` script |
| **Modify** | S3 bucket policy on \`tamil-web-media\` | Extend \`DenyCloudFrontOnMasteringWorkspace\` Sid to also cover \`audio/references/*\` |
| **New IAM** | \`tamilagaval-matchering-worker-role\` | Least-privilege, prefix-scoped |
| **Modify** | \`src/app/(admin)/admin/mastering/page.tsx\` | 3-way A/B/C player (Phase 1C) |

## 3. Whether Matchering works in the proposed runtime

**Cannot answer statically. Requires the Phase 1A spike.** Known:

- Matchering's PyPI classifiers list Python 3.8, 3.9, 3.10 — **Python 3.11 is NOT declared compatible** by upstream.
- Package hasn't been updated since **v2.0.6 on 2022-10-19** (4 years dormant). NumPy/SciPy have had breaking changes since.
- No AWS Python container Lambda exists in the account today. Deploy pattern is currently Zip-only.

The spike must actually build a container matching AWS Lambda's Python image, install Matchering with pinned deps, run against a real TamilAgaval WAV, and report empirical results.

## 4. License finding — RED FLAG (mitigable)

**Matchering is GPL-3.0-or-later**, verified against PyPI. Not MIT — the earlier draft was wrong.

**Implications and mitigation:**

- GPL is a **distribution license**. TamilAgaval is internal SaaS (a private Lambda serving the admin UI). Internal use does not trigger source-disclosure obligations.
- **Hard rules going forward:**
  - Matchering runs in its OWN process boundary (a separate Python Lambda container). No Node worker code links or bundles Matchering. Aggregation-at-runtime is not "combined work" under GPL.
  - Do NOT bundle Matchering into any Docker layer that also contains code the org may want to keep proprietary.
  - Do NOT redistribute the container image outside AWS. Keep it in a private ECR repository.
  - Do NOT open-source the matchering-worker directory alongside proprietary integration code without a compliance review.
- If TamilAgaval ever offers a distributable form of the mastering system, revisit GPL obligations from scratch.
- Add a \`LICENSING.md\` inside the matchering-worker directory documenting all of the above.

## 5. Recommended AWS execution model

**Container-image Python Lambda, Event-invoked by the existing Node master-worker after the loudnorm pass completes.** Rationale:

- Container is required — Matchering + numpy + scipy + soundfile exceeds Lambda's 250 MB Zip limit.
- Reuses the established pattern (Event-invoke, DDB job as coordination point). **No new AWS services introduced.**
- Python worker patches the same \`MASTERJOB#\` item that the Node worker owns. UI polling already works — no route changes for status.

**Do NOT:** synchronous invoke from the Node worker (Node Lambda idles while waiting → billing waste + timeout risk).

**Do NOT:** SQS / Step Functions / ECS / Batch — none justified by the current problem shape.

Two invocation patterns to pick between during the spike:

- **(A) Node worker completes loudnorm → Event-invokes Python worker → returns.** Python worker owns the matched-output slot and patches DDB. Cleanest separation. Recommended default.
- **(B) Route enqueues BOTH jobs at start, both patch different fields on the same MASTERJOB in parallel.** Faster wall-clock but harder concurrency reasoning.

## 6. Estimated Lambda memory / storage / runtime (hypothesis, needs benchmark)

- Memory: **3008 MB** (matches existing master-worker; Matchering reportedly peaks ~1.5-2 GB for 5-7 min stereo 48k)
- Ephemeral storage: **4096 MB explicit** (matches master-worker; do not rely on default)
- Timeout: **900s** (max)
- Cost estimate at 90s/invocation: ~**$0.036 per master** (~$1-2/month at current cadence)

**These are hypotheses. The spike produces real numbers across 2048 / 3072 / 4096 / (optional 6144) configs. Do not commit to production sizing without them.**

## 7. Existing code that can be reused

| Component | Reuse as-is |
|---|---|
| \`MasterJobRepository\` — job state, sparse-index for saved jobs, cursor pagination | Extend fields; no shape change |
| \`mastering-storage.ts::isMasteringKey\` — prefix validation | Reuse for reference key validation with \`isReferenceKey\` sibling |
| Event-invoke pattern + \`Lambda.Invoke(Event)\` in master start-route | Node master-worker gains one line to Event-invoke the Python worker |
| S3 bucket + workspace CloudFront-deny policy | Extend the Deny Sid to also cover \`audio/references/*\` |
| \`requireAdmin\` + \`requireBearer\` auth pattern | Reuse verbatim on any new routes |
| Zod validation pattern | Reuse for reference metadata + method enum |
| Feature-flag pattern | Add one entry, respect the "no dead flags" convention |
| Existing UI polling in the mastering page | Extends naturally to \`matchingStage\` field |

## 8. Risks / blockers

| Risk | Severity | Mitigation |
|---|---|---|
| **Matchering GPLv3, not MIT** | HIGH (legal) → LOW (with isolation) | Container isolation + private ECR + LICENSING.md — see §4 |
| **Matchering dormant since 2022-10-19; Python 3.11 uncertified** | HIGH | Spike (§3) resolves. Fallbacks: pin to Python 3.10, or fork+pin deps, or roll an in-house reference matcher on FFmpeg |
| **First Python container Lambda in the account — new deploy path** | MEDIUM | Standard AWS pattern; adds ECR repo creation to setup |
| **Matched output may not sound better than loudnorm-only on SUNO source** | HIGH (product) | Blind A/B on 10 tracks per revised brief. Do NOT enable flag until evidence exists across genres. |
| **Reference bank curation is ongoing work** | MEDIUM | Start with 3-5 TamilAgaval-owned masters (your own best releases); no commercial-track question at all in Phase 1A |
| **Race condition: loudnorm-done vs matched-done** | LOW | Explicit \`matchingMethod\` state machine on the job |
| **Container cold-start latency** | LOW | Non-interactive job; user already tolerates 30-90s |

## 9. Revised implementation phases

**Phase 1A — standalone feasibility spike (DO NOT ship to production)**
- Dockerfile matching AWS Lambda's Python container base (both 3.10 and 3.11 variants)
- Install Matchering + pinned deps
- Run against 3 real TamilAgaval WAVs (24-bit/48k, 5-7 min)
- Benchmark memory + duration + \`/tmp\` across 2048/3072/4096/(6144) MB
- Deliverable: written spike report; no production code merged

**Phase 1B — production integration (only after Phase 1A GO)**
- Deploy \`tamilagaval-matchering-worker\` container Lambda per Phase 1A recommendations
- New IAM role (least-privilege, prefix-scoped)
- Extend \`MASTERJOB#\` schema (sparse additions)
- Extend \`master-worker.ts\` to Event-invoke Python worker after loudnorm
- Extend start-route zod to accept \`referenceId\` + \`matchingMethod\`
- 3-5 TamilAgaval-owned references pre-seeded via one-off script (no CRUD UI yet)
- Feature flag \`MASTERING_REFERENCE_MATCHING = false\`
- Backend tests
- Deliverable: backend deployed dark; no UI

**Phase 1C — UI + reference CRUD (only after Phase 1B blind-A/B validates)**
- 3-way A/B/C player in existing mastering page
- Reference-picker dropdown + method radio
- Reference-management panel (minimal — list + upload + delete)
- Feature flag → true
- Deliverable: production feature live

## 10. Exact proposed job-schema additions (sparse fields on MASTERJOB#)

Per your revised brief — no meaningless \`tonalDeltaDb\` field:

\`\`\`ts
referenceId?: string;

matchingMethod?:
  | 'loudnorm'
  | 'matched'
  | 'both';

matchedMasterKey?: string;

matchingStage?:
  | 'queued'
  | 'downloading'
  | 'analyzing'
  | 'matching'
  | 'normalizing'
  | 'writing'
  | 'uploading'
  | 'completed'
  | 'failed';

matchingStats?: {
  inputLufs?: number;
  referenceLufs?: number;
  outputLufs?: number;
  inputTruePeakDbtp?: number;
  outputTruePeakDbtp?: number;
  inputLra?: number;
  outputLra?: number;
  elapsedSec?: number;
  referenceId: string;
  engine: 'matchering';
  engineVersion: string;
};
\`\`\`

Reference metadata model (extensible, minimum-viable subset used in Phase 1B):

\`\`\`ts
interface MasteringReference {
  id: string;
  title: string;
  source?: string;
  ownership?: string;
  genre?: string;
  subgenre?: string;
  style?: string;
  mood?: string;
  vocalType?: 'male' | 'female' | 'duet' | 'instrumental';
  ragaOrScale?: string;
  key?: string;
  bpm?: number;
  meter?: string;
  eraStyle?: string;
  instrumentation?: string[];
  dynamicCharacter?: string;
  integratedLufs?: number;
  truePeakDbtp?: number;
  sampleRate?: number;
  bitDepth?: number;
  notes?: string;
  uploadedAt: string;
  enabled: boolean;
}
\`\`\`

Phase 1 uses only \`id\`, \`title\`, \`enabled\`, \`uploadedAt\` in code paths. The rest are populated by hand as references are added; automatic recommendation logic based on them is EXPLICITLY out of scope for Phase 1.

## 11. Estimated effort

| Phase | Effort |
|---|---:|
| **Phase 1A** — spike (container + benchmark + 3-WAV test + report) | **3-5 days** |
| **Phase 1B** — production integration (Lambda + IAM + schema + route + tests) | 4-5 days |
| **Phase 1C** — UI (A/B/C player + reference picker + minimal CRUD) | 4-5 days |
| Blind-A/B validation on 10 tracks | 1-2 days (mostly listening) |
| **Total (Phase 1A → 1C) if all GO** | **~2-3 weeks focused** |

## 12. Recommendation

## **GO WITH CHANGES → Phase 1A only**

- **Do proceed with Phase 1A spike.** Cheapest way to resolve the two questions I cannot answer statically: does Matchering install and run on modern Python + Lambda? Does it improve real TamilAgaval audio?
- **Do NOT commit to Phase 1B until Phase 1A report is reviewed.** If the spike shows Matchering is broken on modern deps OR its output is not audibly better on TamilAgaval source, ~2 weeks of production-integration work is saved for nothing.
- **GPL isolation constraint is a hard rule going forward** — documented in the spike itself so it survives handoffs.
- **Reference-bank strategy for Phase 1B: TamilAgaval-owned masters only.** Defer any commercial-reference question to a separate legal decision if it ever comes up. The stated goal is a consistent TamilAgaval house sound, not chasing external tracks.

## Open questions before Phase 1A starts

1. **Which 3 test WAVs?** Suggest your best-mastered current release + a difficult/dense one + a mid-catalogue one.
2. **Spike lives here in \`spike/matchering-feasibility/\`, or a separate throwaway repo?** Recommend here — report is reviewable inline, deleted when 1B ships.
3. **Spike report format:** admin-doc PR (this style, reviewable in-portal) or a plain markdown file in the repo?
4. **Acceptance bar for GO to Phase 1B?** Suggest all four must pass:
   - Matchering installs cleanly and runs to completion on all 3 WAVs
   - Peak memory < 3008 MB at some tested config
   - Matched output measurably differs from loudnorm-only in blind listen
   - No new legal blocker discovered during setup

## Notes on things the earlier draft got wrong

- Claimed Matchering was MIT. It is GPLv3. Corrected here.
- Assumed fair-use for commercial reference tracks. Removed. Phase 1 uses only TamilAgaval-owned masters.
- Proposed a meaningless \`tonalDeltaDb\` in the stats schema. Removed; \`matchingStats\` now uses only defensible measurements (LUFS / true-peak / LRA / elapsed).
- Proposed a ~200 LOC reference-management panel in Phase 1. Deferred to Phase 1C (only if Phase 1B validates).
- Assumed Python 3.11 works. Correct answer is "unverified; spike must test both 3.10 and 3.11 and report".
- Assumed default ephemeral storage. Corrected: 4096 MB explicit.
- Proposed sync invoke from Node worker → Python worker. Corrected: Event-invoke, keep async orchestration.

---

*This doc is a review artifact. Once Phase 1A ships and the spike report exists, that report becomes a separate doc; when Phase 1B validates, this doc is replaced by a user-facing "how to use reference-track mastering" guide.*`,
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
    updatedAt: '2026-08-10',
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

---

## Why sharing by hand is the ONLY route in (measured 2026-08-10)

This was the missing proof. The way each region finds the channel is completely different:

| how they arrive | India | Sri Lanka | Diaspora (CA/GB/DE/CH/FR/AU/US) |
|---|---|---|---|
| Suggested video | **53.8%** | 50.7% | **21.6%** |
| Playlist | 21.5% | 31.4% | **37.2%** |
| Channel page | low | low | **36.1%** |

**YouTube's recommendation engine barely surfaces you outside South Asia.** In India it drives over half your views. In the diaspora, nearly three-quarters arrive by *browsing* — the channel page or a playlist. They came looking.

Suggested-video is fed by what your existing viewers watch. Your viewers are Indian, so YouTube keeps placing you beside Indian Tamil content, which brings more Indian viewers. **The loop is self-reinforcing and cannot be argued with.** No amount of song quality redirects it.

**External referral traffic is ~0.3%.** Essentially nobody arrives from outside YouTube — which is exactly the gap this playbook fills. Every WhatsApp forward is a view the algorithm was never going to give you.

## Do not confuse theme with reach

| song | diaspora share |
|---|---|
| முத்தமிழின் மூன்றெழுத்தில் (about the Tamil language) | **28.3%** |
| அன்னையும் இல்ல... தந்தையும் இல்ல | 13.4% |
| ஈழத்து மண்ணே (homeland) | **1–2%** |

The homeland songs are *not* reaching the diaspora, despite being written for them. **Theme does not decide geography — distribution does.** You already own the songs this audience wants; they simply never see them. Writing more homeland songs will not fix a distribution problem.

## Where the effort pays

1. **WhatsApp Channel** — the one built-and-waiting way to seed views from outside YouTube. Needs the invite link (\`https://whatsapp.com/channel/…\`) dropped into \`SITE.whatsapp.url\`.
2. **Channel page** — 36% of diaspora land there first, versus almost none of your Indian viewers. It is their front door, so it should lead with **🌟 இங்கே தொடங்குங்கள் | Start Here**, not a wall of 97 videos.
3. **Playlists** — 37% of diaspora traffic, their single biggest source.
4. **Romanized / English searchability** — second-generation viewers often do not read Tamil script.

**Honest scale:** ~280 diaspora views/day today. Ads alone at \\$10/day would need ~4,100/day — 14x. A realistic 3–5x roughly doubles or triples revenue. This is a year of work, not a quarter, which is why the commission funnel is the bridge.

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
    updatedAt: '2026-08-10',
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

Revenue lives in the Monetization panel at \`/admin/analytics\` (and Studio → Revenue).

---

# What the money actually depends on (measured 2026-08-10)

## Read the NET number, not the gross

| 14 finalized days | |
|---|---|
| **Net — what reaches your bank** | **\\$1.87/day** |
| Gross — before YouTube's share | \\$3.32/day |
| Best single day | \\$2.55 |

If a figure looks roughly double what you expect, you are reading **gross**. YouTube keeps about 45% of ad revenue. Always judge progress on net.

## Why the RPM is \\$0.25

|  | share of views | share of revenue | RPM |
|---|---|---|---|
| India | ~80% | 39% | **\\$0.13** |
| High-RPM countries | **6.1%** | **56%** | ~\\$2.30 |

Per country: US **\\$11.44** · Switzerland \\$4.31 · Germany \\$3.61 · UK \\$3.17 · Canada \\$1.55 · India \\$0.13.

**One US view is worth about 88 Indian views.** Sri Lanka is worse than India, not comparable: 26,855 views produced **\\$0.25**, an RPM of **\\$0.01**.

## The arithmetic nobody can argue with

At the current audience mix, **\\$10/day means about 40,000 views/day** — roughly 8x, while views are falling as the July surge normalizes. That is not a plan.

The two things that actually move it:
1. **Change who watches** — diaspora views are worth ~18x Indian ones. See *Reach the Eelam Tamil community*.
2. **Sell something** — \\$10/day is \\$300/month, which is **one music-composition commission**. The commission link now sits on 95 of 97 videos.

## Mid-rolls: the rule has an exception you just created

Mid-rolls need a video of **8 minutes or more**. Your songs run 5–7 minutes, so mid-rolls were never available on the catalogue — the "mid-rolls off" rule costs you nothing there.

**A paired song + music version runs ~10 minutes and clears the threshold.** That format is the first thing on the channel that could carry mid-rolls, at roughly 2–3x the ad impressions per view. Currently you serve **1.21 ad impressions per monetized playback** — pre-roll only.

That is a real revenue option, and it is a genuine trade against the ad-free listening you have chosen. Grief songs stay ad-free regardless.

## Shorts earn nothing — judge them differently

5,645 Short views produced **\\$0.09**, with **zero** monetized playbacks and **zero** ad impressions. Shorts are a discovery tool. Judge them on subscribers driven, never on revenue.

## One interaction worth knowing

\`2AlTwv45AiQ\` is both a **Tier-1 ad-free song** and the **channel trailer**. The trailer is the surface most non-subscribers meet, and it earns nothing by design. That is a defensible choice — just make it knowingly.
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

**Working baseline: a 30-40K weekly-view channel**, not a 75K channel that lost 45K. The objective is to raise that floor (30-40K to 40-50K), not to recreate one exceptional week.

⚠️ **The floor is a hypothesis, not a measurement.** The last four weeks read 39,884, 35,075, 39,672, 30,678 — the most recent is the lowest, and suggested-video views fell 40% in that final week. Two or three more finalized weeks are needed before "30-40K" is established rather than assumed.

## Distribution contracted; audience quality improved

That is the right description. Retention has risen **every week for eleven weeks — 19.2% to 51.1%**, an all-time high and 7.7 points above the peak week.

An earlier version of this page went further and argued:

> If falling impressions were causing the decline, retention would be flat or falling with it.

**That inference is invalid and has been withdrawn.** It assumes impression contraction is audience-neutral — a random subsample. It is not. Algorithmic contraction is *selective*: it prunes marginal, low-propensity viewers first, so retention rises mechanically as the funnel narrows, whichever way causation runs. Rising retention is compatible with both stories and discriminates between neither.

What retention does establish is that the audience still arriving is **better matched** — not that the channel is deteriorating. Do not overclaim beyond that.

### The mix-shift objection, and the test that answers it

Channel-level retention could rise purely from composition — more love songs (which retain 51-62% here) and fewer family/grief songs (22-36%). The test is to hold the songs constant. Same five songs, peak week (Jul 2-8) vs Jul 30-Aug 5:

| Song | Peak AVP | Now AVP | Change |
|---|---|---|---|
| நீ சிரிச்ச நேரம் | 48.8% | 53.9% | +5.1 |
| என் மன்னவனே | 43.0% | 56.6% | +13.6 |
| செவ்வந்தி பூவே | 47.4% | 55.7% | +8.4 |
| உன்னை பார்த்தால் | 50.9% | 58.7% | +7.8 |
| என் பொன்மணி | 49.4% | 65.1% | +15.7 |

**All five rose.** Identical files, unchanged. So the gain is audience quality, not composition.

Watch-time per view has risen eight weeks running: 2.02, 2.16, 2.51, 2.78, 2.77, 2.68, 3.03 min/view. Views fell 59% from the peak while watch-minutes fell only 51%.

## Subscriber conversion — always divide by NON-subscriber views

Headline subs per 1,000 views fell from 4.29 (late June) to 2.42 (Jul 23-29) before recovering to 3.16. That reads as decay. Most of it is an artifact.

Views from **already-subscribed** viewers rose from 9.7% to 21.2% of the total, and those people cannot subscribe again. Excluding them:

| Week | subs/1k (all views) | subs/1k (excluding subscriber traffic) |
|---|---|---|
| Jun 25-Jul 1 | 4.29 | 4.75 |
| Jul 2-8 (peak) | 3.43 | 3.92 |
| Jul 16-22 | 2.94 | 3.50 |
| Jul 23-29 | 2.42 | 2.87 |
| Jul 30-Aug 5 | 3.16 | **4.01** |

New-viewer conversion is at its best since June and above the peak week. The headline figure is diluted by your own audience returning more often — a good problem wearing a bad disguise.

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
  {
    slug: 'songwriting-craft-curriculum',
    title: 'பாடல் எழுதுதல் — முறையான கற்றல் வரிசை (songwriting craft)',
    category: 'Composer',
    updatedAt: '2026-08-09',
    body: `# பாடல் எழுதுதல் — முறையான கற்றல் வரிசை

நீங்கள் எழுதக் கற்றுக்கொண்டு பிறகு எழுதத் தொடங்கியவர் அல்ல; **எழுதிக்கொண்டே உங்கள் சொந்த முறையை உருவாக்கியவர்.** இப்போது செய்ய வேண்டியது அந்த இயல்பான படைப்பாற்றலை மாற்றுவது அல்ல; அதற்குப் பின்னால் இருக்கும் இலக்கணத்தையும் பாடல் கட்டமைப்பையும் அறிந்துகொள்வது.

உங்கள் வரிகளைப் பார்த்தாலே தெளிவாகிறது: நீங்கள் இயல்பாகவே **எதுகை, மோனை, ஒலிநயம், சொல் மீட்சி, எதிரொலி, உருவகம், காட்சிப்படுத்தல், வட்டார மொழி, பல்பொருள்** ஆகியவற்றைப் பயன்படுத்துகிறீர்கள். \`நிலவு / பருவம்\`, \`வெய்யில் / மெய்யில்\`, \`எண்ணம் / கன்னம் / கண்கள்\`, \`சாய் / சாய்ந்த / சாய்ந்து\` — இவை விதியைப் படித்துவிட்டு எழுதப்பட்டவை அல்ல; காதால் ஓசையை உணர்ந்து எழுதப்பட்டவை.

## கவிதைக்கும் பாடலுக்கும் உள்ள வேறுபாடு

கவிதையில் ஒரு வரி தனியாகவே அழகாக இருக்கலாம். பாடலில் அந்த வரி **மெட்டு, தாளம், அசை, உச்சரிப்பு, மூச்சு, repetition, singer phrasing** ஆகியவற்றுக்குள் வாழ வேண்டும்.

**அதனால்தான் ஒரு சிறந்த கவிதை அப்படியே சிறந்த பாடலாகிவிடாது.**

## கற்கும் வரிசை — 10 படிகள்

| # | பகுதி | இப்போது என்ன கருவி உள்ளது |
|---|---|---|
| 1 | **பல்லவி – அனுபல்லவி – சரணம்**: ஒவ்வொன்றின் வேலை என்ன, ஒன்றிலிருந்து மற்றொன்று எப்படி வளர வேண்டும் | Lyric Critic — \`structure\` aspect |
| 2 | **எதுகை – மோனை – இயைபு – ஓசைநயம்**: ஏற்கனவே பயன்படுத்துவதை முறையாக அடையாளம் காண்பது | ✅ Tamil Prosody panel — \`analyzeProsody\` இவற்றைத் தானாகவே குழுவாக்கிக் காட்டுகிறது |
| 3 | **சீர் – அசை – மாத்திரை உணர்வு**: பாடும்போது ஏன் சில வரிகள் எளிதாகவும் சில நெருக்கமாகவும் வருகின்றன | ✅ \`countSyllables\` (உயிர் + உயிர்மெய், தனி மெய் அல்ல) + off-meter flag |
| 4 | **Meter consistency**: ஒரே மெட்டில் சரணம் 1, 2, 3 அனைத்தையும் பாடக்கூடியதாக எழுதுவது | ✅ Flow suggestions — பாடலின் *சொந்த* dominant syllable count-ஐ வைத்து ஒப்பிடுகிறது |
| 5 | **Hook writing**: முதல் முறை கேட்டவுடன் நினைவில் நிற்கும் பல்லவி | ❌ கருவி இல்லை — முற்றிலும் கைவினை |
| 6 | **Imagery & metaphor**: அழகான சொற்களை அடுக்காமல், காட்சிகள் ஒன்றிலிருந்து ஒன்று வளரும்படி | Lyric Critic — \`imagery\` aspect |
| 7 | **Emotional progression**: சரணம் 2, சரணம் 1 சொன்னதையே வேறு வார்த்தையில் சொல்லாமல் கதையை முன்னேற்றுவது | Lyric Critic — \`emotion\` aspect |
| 8 | **Melody-aware writing**: நீண்ட உயிரெழுத்து எங்கே, குறில் எங்கே சிக்குகிறது, எந்தச் சொல்லை நீட்டிப் பாடலாம் | ✅ \`analyzeGamaka\` — வரி முடிவு திறந்ததா, நெடில் விகிதம் என்ன |
| 9 | **Colloquial vs literary**: \`உன்னோட\`, \`வரப்பில\` போன்ற பேச்சுவழக்கும் \`மெய்யில்\`, \`காவியம்\` போன்ற செவ்வியல் சொற்களும் ஒரே பாடலில் எப்போது இயல்பாகச் சேரும் | Lexicon — \`register\` field (sangam / literary / village / modern / devotional) |
| 10 | **Editing**: எழுதிய வரியை அழிக்கப் பயப்படாமல், அதன் **பொருள், ஒலி, இசை** மூன்றையும் தனித்தனியாகச் சோதிப்பது | Lyric Critic — slack lines + word ideas, ஒருபோதும் rewrite அல்ல |

**குறிப்பு:** 2, 3, 4, 8 ஆகியவை ஏற்கனவே கணக்கிடப்படுகின்றன — அவை LLM அல்ல, தூய கணிதம். எனவே ஒவ்வொரு முறையும் ஒரே பதில் வரும்.

## மிக முக்கியமான விஷயம்

**இவற்றைக் கற்ற பிறகு எல்லா விதிகளையும் ஒவ்வொரு வரியிலும் கட்டாயமாகப் பின்பற்ற வேண்டியதில்லை.**

ஒரு அனுபவமுள்ள கவிஞர் விதியை மீறலாம்; ஆனால் *ஏன் மீறுகிறோம்* என்று தெரிந்து மீறுவது இன்னும் வலிமையானது.

இதே காரணத்தால்தான் இந்தத் தளத்தின் எந்தக் கருவியும் உங்கள் வரியை **மாற்றி எழுதுவதில்லை** — Lyric Critic ஒரு வரியை மேற்கோள் காட்டி *ஏன் தளர்கிறது* என்று சொல்லும், மாற்று வரி தராது. முடிவு உங்களுடையது.

## அடுத்த பாடலை உருவாக்கும் முறை

**நீங்கள் வரிகளை எழுதுங்கள். நான் வரிகளை எழுதமாட்டேன்.**

ஒவ்வொரு கட்டத்திலும் இவற்றை மட்டும் ஆய்வு செய்து சொல்வேன்:

- இது **பல்லவியாக** ஏன் வேலை செய்கிறது (அல்லது செய்யவில்லை)
- **அசை** எங்கே அதிகம், எங்கே நெருக்கம்
- **எதுகை / மோனை** எங்கே விழுகிறது
- **melody** எங்கே மூச்சு கேட்கிறது — வரி முடிவு நீட்டிப் பாடக்கூடியதா
- **சரணம்** கதையை முன்னேற்றுகிறதா, அல்லது அதையே திரும்பச் சொல்கிறதா

இப்படிச் செய்தால் ஒரு புதிய பாடல் உருவாகும் அதே நேரத்தில் **formal songwriting முறையையும் நடைமுறையாகக் கற்றுக்கொள்ளலாம்.**
`,
  },
  {
    slug: 'video-length-and-avp',
    title: 'Video length & average view percentage — why a 10-minute song reads 29%',
    category: 'Growth',
    updatedAt: '2026-08-10',
    body: `# Video length & average view percentage

**The one sentence:** your listeners watch a near-constant amount of time, so **video length — not song quality — sets the average-view-percentage you see.**

## The measurement

Across the 10 biggest songs (May–Aug 2026), average view duration barely moved: **2:21 to 3:15, median 2:54**. Reported AVP ran 44–52% on songs of 5:04–7:05.

Because watch time is roughly fixed, length is the denominator. The **same 2:54 of listening** reports as:

| video length | AVP shown |
|---|---|
| 5:04 | 57% |
| 6:05 | 48% |
| 7:05 | 41% |
| 10:08 | **29%** |

Identical listening. The number nearly halves.

## Why this matters

A paired *song + music version* upload runs about 10 minutes, with the vocals ending around the halfway mark. It will report roughly **29% AVP** against a 44–52% norm — and it would be wrong to read that as a weak song. Most viewers never reach the instrumental half at all, so it cannot be driving them away.

AVP also feeds how YouTube decides to suggest a video, so the cost is real, not cosmetic. And it breaks comparability: one 10-minute paired upload sitting in a series of 6-minute songs is not measuring the same thing.

**This is the same trap as reading unfinalized days or treating a peak as the baseline.** See *Reading impressions & reach*.

## The question worth asking instead

Not "what is the AVP", but **"what happens at the moment the song ends?"** Three outcomes:

- **Cliff** — the fall steepens sharply there. The instrumental half is losing people the song was holding.
- **Stable continuation** — they leave at the rate they were already leaving. The boundary is not driving them away.
- **Seek-in** — the curve *rises* after that point. A retention curve can only fall from spillover, because a viewer who left cannot un-leave. **A rise means people are jumping there deliberately** — that is demand, not tolerance.

## How to measure it

\`\`\`
npx tsx scripts/retention-boundary.ts <videoId> <mm:ss>
\`\`\`

It reports the hold either side of the moment, whether the fall steepens, and whether anyone seeks in. Run it at least **4 days after publish** — YouTube backfills retention for about 72 hours, and an unfinalized tail will read as a cliff that is not there.

A control to compare against: முத்தமிழின் (\`J2tc_aUNOPA\`) at its 3:00 midpoint returns **NO CLIFF** and **SEEK-IN: no** — what a normal single-part song looks like.

**Caution:** do not treat every small rise as proof of demand. Retention data has local variation, replay behaviour and aggregation effects. Want a meaningful rebound and enough views behind it before believing it.
`,
  },
  {
    slug: 'publishing-traps',
    title: 'Publishing traps — things that fail silently',
    category: 'Publishing',
    updatedAt: '2026-08-10',
    body: `# Publishing traps — things that fail silently

Each of these cost real time. None of them produce an error message.

## Setting a video PRIVATE does not cancel its scheduled publish

A video can be private **and** still scheduled. Setting privacy to private in Studio does not always clear \`publishAt\` — a staged upload was found private with its schedule still armed for the next morning. It would have published itself.

**Always re-read the schedule after any privacy change.** And clearing it needs an explicit null:

\`\`\`
PUT videos?part=status
{"id":"…","status":{"privacyStatus":"private","publishAt":null, …}}
\`\`\`

Omitting the field returns HTTP 200 with a clean-looking response **and changes nothing**. Re-read to confirm — the update response lied.

## Chapters need THREE timestamps, not two

YouTube renders a chapter bar only with **at least three** timestamps, the first at exactly \`0:00\`, and every segment **10 seconds or longer**.

Two entries (\`0:00\` and \`5:36\`) render as plain clickable text: no chapter bar, no seekable segments. If the point of the chapters is to let someone jump to the second half, two entries **do not accomplish it**.

## You cannot comment on a private video

\`commentThreads.insert\` returns **403 "insufficient permissions"** on a private video even as the channel owner with a write token. The pinned-comment step must wait until the video is public. Do not read the 403 as a token problem — check the privacy status first.

Same for playlists: a private video shows as *unavailable* to viewers, so add it after publish.

## Reading a private video needs OAuth, not the API key

\`videos.list\` with an API key returns an **empty item list** for a private video — indistinguishable from "deleted". Check as the owner before concluding anything is gone.

## channels.update silently ignores a full payload

Sending the whole \`brandingSettings\` object back (including read-only members) returns **HTTP 200 with the OLD values echoed** and changes nothing. It works only when the payload carries writable fields alone:

\`\`\`
PUT channels?part=brandingSettings
{"id":"UC…","brandingSettings":{"channel":{
   "title":…, "description":…, "keywords":…, "country":…, "unsubscribedTrailer":…}}}
\`\`\`

There is no error to catch. **Always re-read after the write.**

## Deleting a video breaks every link pointing at it

A Short's description link to its full song becomes a 404 the moment the song is deleted — and a Short without a working full-song link is a dead end, which is its whole job.

**Before deleting, scan the catalogue for references to that video id**, and repoint them. Deleting also silently drops the video from every playlist it belonged to.

## Auto-ASR captions come back

YouTube regenerates automatic caption tracks after you delete them — one reappeared within a day of a catalogue-wide cleanup. Caption hygiene is a **recurring sweep**, not a one-time pass.

## A premiere has no duration until it airs

\`contentDetails.duration\` is absent while \`liveBroadcastContent\` is \`upcoming\`. Anything that needs the length — chapter placement, a retention boundary ratio — cannot be computed before it goes live.

## Verify the write, not the response

The thread through most of these: **the API response is not evidence that anything changed.** A separate read is. That applies to privacy, schedules, branding, and tags — where a PUT response returned tags in a form that looked different from what was sent, while a fresh read showed them untouched.
`,
  },
  {
    slug: 'lexicon-word-list',
    title: `Literary word list — ${LEXICON_WORD_COUNT} words to import`,
    category: 'Composer',
    updatedAt: '2026-08-15',
    body: buildWordListDoc(),
  },
  {
    slug: 'twitch-app-registration',
    title: 'Twitch — register the developer-console app (first-time setup)',
    category: 'Integrations',
    updatedAt: '2026-08-24T05:15:00Z',
    body: `# Twitch — register the developer-console app

**One-time setup.** Do this before the "Connect Twitch" button on [/admin/twitch](/admin/twitch) will do anything useful. Takes ~5 minutes.

## What this creates

A **Twitch OAuth application** — the identity TamilAgaval presents when it asks a Twitch user (you) to authorize the connection. Twitch identifies our app by a **Client ID** (public) and authenticates our token-exchange calls with a **Client Secret** (server-only, never in the browser). Both live in Twitch's developer console until we copy them into AWS SSM.

## Step 1 — Create the app

1. Open [dev.twitch.tv/console/apps/create](https://dev.twitch.tv/console/apps/create) and sign in with your Twitch account (the same one you'll be connecting).
2. Fill the form exactly:

| Field | Value |
|---|---|
| **Name** | \`TamilAgaval\` — cosmetic; only you see it |
| **OAuth Redirect URLs** | \`https://tamilagaval.com/api/admin/twitch/callback\` — copy verbatim; Twitch enforces exact match |
| **Category** | \`Website Integration\` |
| **Client Type** | **\`Confidential\`** — critical. Public-type clients get no Client Secret; our server-side OAuth flow requires one. |

3. Solve the captcha, click **Create**.

## Step 2 — Save the credentials

The next screen shows your **Client ID** (visible whenever you come back) and a **New Secret** button.

1. Click **New Secret** → Twitch shows the Client Secret **exactly once**. Copy it now.
2. **Save both values somewhere trustworthy.** A password manager entry named "Twitch — TamilAgaval OAuth app" is ideal.
3. If you lose the secret later, coming back to this app page + **New Secret** rotates it (any live OAuth session becomes invalid — do it deliberately).

## Step 3 — Get them into AWS SSM

Two paths — pick either. **Nothing else in the integration works until these values are in SSM.**

### Path A — Ask Claude to do it in-chat

Paste the two values in a chat message. Claude will:
- \`aws ssm put-parameter\` the Client Secret to \`/amplify/d3rkmepk4popv0/master/TWITCH_CLIENT_SECRET\` (SecureString)
- Generate a random 32-byte \`TWITCH_STATE_SECRET\` and put it alongside
- Add the Client ID + redirect URI as Amplify environment variables
- Push a small follow-up PR wiring the four env vars into \`next.config.ts\` + \`amplify.yml\` so the build inlines them

Standard "session transcript exposure — rotate at Twitch if the transcript persists somewhere sensitive" caveat.

### Path B — Do the SSM writes yourself

If you'd rather not send secrets through the chat:

\`\`\`bash
# Client Secret — SecureString
aws --region ca-central-1 ssm put-parameter \\
  --name /amplify/d3rkmepk4popv0/master/TWITCH_CLIENT_SECRET \\
  --type SecureString --key-id alias/aws/ssm \\
  --value 'PASTE_CLIENT_SECRET_HERE' \\
  --overwrite

# State-cookie HMAC secret — random 32 bytes
aws --region ca-central-1 ssm put-parameter \\
  --name /amplify/d3rkmepk4popv0/master/TWITCH_STATE_SECRET \\
  --type SecureString --key-id alias/aws/ssm \\
  --value "$(openssl rand -base64 32)" \\
  --overwrite
\`\`\`

Then paste **just the Client ID** in chat (it's not a secret) so Claude can add it to Amplify env vars + push the wiring PR.

## What Claude adds after credentials land

1. Amplify env vars added (via \`aws amplify update-app --environment-variables\`):
   - \`TWITCH_CLIENT_ID = <client-id>\`
   - \`TWITCH_OAUTH_REDIRECT_URI = https://tamilagaval.com/api/admin/twitch/callback\`
2. Small PR that adds the four keys to \`next.config.ts\`'s \`env:\` block + \`amplify.yml\`'s SSM-fetch loop (same pattern P2.4 already established for the 13 other secrets).
3. Amplify auto-builds. When the build lands, the \`/admin/twitch\` page's **Connect Twitch** button becomes functional.

## Step 4 — Connect (end-to-end test)

After the wiring PR merges and Amplify builds:

1. Open [/admin/twitch](/admin/twitch) in this admin portal.
2. Click **Connect Twitch**.
3. Twitch shows their consent screen — sign in (same account whose channel you want tracked), click **Authorize**.
4. Twitch redirects back to \`/admin/twitch?connected=1\`. The page should now show your channel avatar + display name + **Connected** badge.
5. Click **Enable EventSub** (PR 2 feature — only visible once PR 2 merges). The page will list \`stream.online\` and \`stream.offline\` subscriptions as **pending → enabled** within a few seconds.
6. Go live on Twitch. Within ~30 seconds, the **Stream** panel flips to **LIVE**. Go offline — flips back to **Offline**.

## Rotation & disconnect

- **Rotate the Client Secret** — dev.twitch.tv/console/apps → the app → **New Secret**. Then \`aws ssm put-parameter --overwrite\` the new value. Any active user tokens are invalidated; **Reconnect** on \`/admin/twitch\` picks up the new secret and re-authorizes.
- **Disconnect** — button on \`/admin/twitch\`. Revokes tokens at Twitch (best-effort) + deletes both SSM token params + flips the DDB record's status to \`disconnected\`. Reversible via **Connect Twitch** again.
- **Nuke the whole thing** — the disconnect button, followed by deleting the app in Twitch's dev console. Any code paths that call the Twitch API will start returning "not connected"; nothing else in TamilAgaval is affected.

## Troubleshooting

**"Twitch rejected the authorization code."** The \`TWITCH_OAUTH_REDIRECT_URI\` env var doesn't exactly match a Redirect URL registered in the dev console. Log into the console, verify the URLs list, and if you added a second URL for local dev make sure the production one is still there too.

**"State cookie did not match the expected session."** You started the connect flow in one browser and completed it in another — or a browser extension blocked the state cookie. Retry in a single, extension-clean browser tab.

**Connect fires but Twitch shows "You cancelled the authorization."** Twitch's response to that button being clicked; nothing was stored. Just retry.

**\`Enable EventSub\` returns "Could not read or create the EventSub secret."** Rare — happens when the Amplify service role lost SSM write permission for the \`TWITCH_EVENTSUB_SECRET\` path. Check the CloudWatch log for the enable route. Fixable by manually creating the secret with \`aws ssm put-parameter\` (SecureString, 32 random bytes) — the enable route will find it on the next call.
`,
  },
  {
    slug: 'reading-channel-health',
    title: 'Reading channel health — cool-downs, cadence, and the RPM myth',
    category: 'Growth',
    updatedAt: '2026-08-25T20:00:00Z',
    body: `# Reading channel health — cool-downs, cadence, and the RPM myth

Frameworks for interpreting month-over-month channel numbers without either panicking or over-optimizing. Written after a session where "views dropped 43%, subs dropped 62% this month" turned out to be normal post-surge decay, not a broken channel — the reasoning below is what let us see that instead of firefighting.

Nothing here is universal. It's calibrated to a small-to-mid Tamil-music channel (1,000-10,000 subs) and the audience mix that comes with it. Adjust the specific numbers if the channel scale or genre shifts.

## The post-surge cool-down (the pattern to recognize first)

When a channel goes from a few uploads a month to a burst of 30+ in one month, YouTube's algorithm amplifies BOTH the new videos AND the older catalogue (channel-freshness signal). Views can 20-50× overnight.

When the burst ends, the amplification decays proportionally. The whole channel returns toward a new baseline that's much higher than pre-burst but much lower than peak-burst. From inside the drop it FEELS like the channel is broken — from outside, it's textbook algorithm behaviour.

**How to tell you're in a cool-down (vs a real decline):**

1. The SAME top-5 videos still occupy the top-5 in the new period, just at half the volume each. If the songs are unchanged but the amplification softened, it's a channel-level signal (cadence, freshness), not a per-song quality problem.
2. Engagement PER view is stable or improving (avg view % steady or up; likes-per-view steady; shares-per-view steady). If per-view quality is fine and only VOLUME is down, the audience that DID watch is still the same audience.
3. Revenue per 1000 views (RPM) is not falling. Cool-downs affect impressions, not RPM.
4. Upload cadence is materially different from the surge month. If uploads dropped from 30/month to 10/month, expect view volume to drop proportionally.

**How to tell it's a REAL decline** (the counter-picture):

- Same top-5 videos rank very differently or lose slots — one specific video collapsed while others held
- Per-view engagement drops (retention, likes-per-view, comments-per-view) — audience quality is degrading
- RPM drops sharply — advertisers are pulling back OR content-mix is shifting to lower-CPM segments
- Sub CHURN increases (\`subscribersLost\` climbing month-over-month) — existing subs actively unsubscribing, not just fewer new ones

## The right pace for a small Tamil music channel

30+ uploads per month is a burst pace, not a sustainable one. It works to jump-start algorithm attention but every song that arrives in that burst gets less individual thought (thumbnail, description, promotion, community post).

**The sustainable rhythm is ~2 uploads per week — 8-10 per month.** Enough to keep the channel-freshness signal alive (which prevents impressions on older videos from decaying), few enough that each release gets real attention.

If the current cadence is far above that, be aware: dropping to sustainable is going to LOOK like a decline for 2-4 weeks. It's the algorithm normalising, not the channel dying. Ride through it and keep the rhythm. Stopping uploads mid-cool-down is what turns a cool-down into a real decline.

## The single number worth watching weekly

Not views. Not impressions. Not RPM.

**Net subscribers gained per week** (\`subscribersGained\` minus \`subscribersLost\` over the last 7 days). Track it every Sunday. Compare each week to the prior week — never to a peak week or a burst period.

- Trending up week-over-week: fundamentals working; content resonates
- Flat: healthy; the channel has found its sustainable audience
- Trending down for 4+ weeks straight: real signal to investigate

Views are noisier than subs — a single viral moment can distort a week. Subs are the audience's actual "come back for more" vote and change more slowly. Six weekly data points > any single monthly comparison.

## RPM: the honest Tamil-India range

Realistic RPM by market for music content:

| Audience | RPM range |
|---|---|
| Tamil-India | **$0.30 – $1.50** |
| English-India | $1.00 – $3.00 |
| Sri Lankan Tamil diaspora | $2.00 – $6.00 |
| Canadian / UK / US Tamil diaspora | $5.00 – $12.00 |
| Global English music | $3.00 – $10.00 |

Music content typically runs at 40-60% of the RPM of talk / vlog / gaming in the same market because there are fewer ad slots (no mid-rolls under 8 minutes, limited display ads on music content in some markets).

**A channel RPM of $0.40-0.60 for Tamil-India audience is normal, not a sign that revenue is being redirected.** It's the actual market rate. The way to move it is to shift audience geography or to change what qualifies for ads — not to fight anyone.

**The three levers that actually work:**

1. **Geographic mix.** More SL / CA / UK / US audience share lifts CPM naturally. Emotional-tribute themes with cultural / Jaffna Tamil identity signals tend to draw more diaspora viewers, which raises the whole channel's RPM.
2. **Video length ≥ 8 minutes.** Enables mid-roll ads (multiple ads per view instead of one). Not a reason to artificially lengthen songs — but when a song's arrangement supports 9-10 minutes, taking it there materially lifts RPM on that video.
3. **Watch-through rate.** Higher retention = more of the video is eligible to serve ads = more revenue per playback. First-minute retention is the highest-leverage part of the curve; a distinctive musical hook in the opening 15-30 seconds does more for RPM than any post-video edit.

## The \`licensedContent: true\` flag — what it does and doesn't mean

The Data API returns \`contentDetails.licensedContent: true\` when YouTube's Content ID system has ANY copyright association with the video's audio. That includes:

- **Self-registration via a music distributor.** If you upload a track to DistroKid / TuneCore / CDBaby and they register it with Content ID on your behalf, then upload the same track to YouTube from your own account, YouTube sees the fingerprint match against DistroKid's registration and sets the flag. This is NOT a third-party claim — it's your own registration matching your own upload.
- **A third-party claim** (someone else registered content that YouTube's fingerprinter matched against your audio).
- **Match against a music-library sample** if any of the audio contains a fingerprint that traces to a licensed sample.

**\`licensedContent: true\` alone does NOT mean revenue is being redirected.** To find out what's actually happening, open YouTube Studio → Content → the specific video → the Copyright tab. That view is authoritative: it lists any actual claims, who filed them, what policy is applied (monetize-for-claimant / monetize-for-you / track / block), and whether any dispute is in progress.

**The Distrokid self-vs-self gotcha:** artists who self-upload to YouTube AND self-distribute via DistroKid sometimes see YouTube flag their own video as containing licensed content that "matches" the DistroKid-registered version — because from YouTube's fingerprinter's POV, they're indistinguishable. This shows up as a "claim on your own video" in Studio. The fix is a straightforward dispute (you own both sides); once resolved, the revenue routes correctly to you. \`GXLu3Y7FghU\` (Nee Sirichcha Neram Thaan) was this case in mid-2026; resolved cleanly. Don't extrapolate that resolution to a systemic problem — it's a specific reconciliation, not a pattern.

## What to actually do when the numbers look bad

1. **Don't stop uploading.** The single worst reaction. Silence tells the algorithm "this channel is done" and turns a cool-down into a real decline. Even if you have less to release, ship SOMETHING at the sustainable cadence — a rework, an instrumental cut, a rehearsal snippet.
2. **Look at the top-5 comparison.** If the same songs still rank, you're in a cool-down. If a specific song collapsed, look at THAT song's Studio numbers for a clue (was the thumbnail changed, description edited, tag list altered — anything reset its algo signal?).
3. **Look at weekly net-sub trend.** Six data points beat any single monthly comparison.
4. **Ignore RPM month-over-month noise.** Only worry if RPM drops for 3+ months and stays down.
5. **Compare to true baseline, not to peak.** May 2026's 4,147 views (before the July burst) is the honest baseline for this channel. Anything meaningfully above that is a win, not a decline.
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

/**
 * Build the word-list doc body FROM THE DATA, so the page and the list can
 * never disagree. Each theme becomes a fenced block that pastes straight into
 * /admin/lexicon → Paste list, which is the step that attaches the theme.
 */
function buildWordListDoc(): string {
  const groups = LEXICON_WORD_GROUPS.map((g) => {
    const lines = g.words.map((w) => `${w.word} — ${w.gloss}`).join('\n');
    return [
      `## ${g.theme} — ${g.words.length} words`,
      '',
      `Register **${g.register}** · theme **${g.theme.replace(/ \(part \d+\)/, '')}** · select both before importing.`,
      '',
      '```',
      lines,
      '```',
      '',
    ].join('\n');
  }).join('\n');

  return `# Literary word list — ${LEXICON_WORD_COUNT} words

Proposed vocabulary for the Lexicon, grouped by theme and ready to paste.

## What this is, and what it is not

**De-duplicated against your lexicon.** 833 words were drafted; **252 (30%) you already had** and were dropped. Only the ${LEXICON_WORD_COUNT} you did not have are below — அவனி, ஞாலம், விசும்பு, மாரி, கார்முகில், ஏக்கம், முறுவல் and 245 others were already yours.

**Nothing here is in the database.** Reading this page changes nothing. Each block has to be imported deliberately.

> ⚠️ **The registers are proposals, not findings.** Almost everything is filed \`literary\` on purpose — the mildest available claim. Only the **sangam** group holds genuine Sangam-era technical terms (verse forms, the anthologies, the sections of the Tolkappiyam). Filing a word as \`sangam\` because it sounds classical is exactly what left 1,046 existing entries under a register nobody chose. Change any of these with bulk edit once you have judged them.

**English glosses only.** No Tamil meaning yet — write your own, or let Enrich propose one. Either way the entry still needs your eye.

## How to import a block

1. Go to **Lexicon → 📋 Paste list**
2. Set the **register** and **theme** named above the block
3. Copy everything inside the fence and paste it
4. **Import**

Doing it block by block is what gives each word its theme. All 1,047 existing entries have none, which is why the theme filter is still inert — these ${LEXICON_WORD_COUNT} arrive with one already attached.

Blocks are capped at 50 words to match the bulk endpoint; a longer theme is split into parts.

---

${groups}`;
}
