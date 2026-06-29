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
