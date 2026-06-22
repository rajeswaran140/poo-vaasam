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
    slug: 'suno-preflight-testing',
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
    slug: 'suno-preflight-how-it-works',
    title: 'Tamilagaval Pre-flight — How it works',
    category: 'Composer',
    updatedAt: '2026-06-22',
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

> Next planned: an **attempt log** so each trial's outcome is recorded and you learn what works over time.
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
