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
