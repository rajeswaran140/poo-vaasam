# AI Engine Evaluation — Gemini vs Claude (Tamilagaval)

**Date:** 2026-06-30 · **Status:** Evaluation complete (live API tests); full adapter benchmark pending · **Owner:** Raj

Tamilagaval's AI features (Lyric Critic, Composer, Lyricist, prompt-critic, lexicon-suggest, YouTube recommendations) run on **Claude** today. A **model-agnostic engine adapter** with a **Gemini** implementation already exists on branch `feat/composer-engine-adapter-gemini` (Anthropic + Gemini adapters, a Zod→Gemini schema converter `toGeminiSchema`, and `scripts/benchmark-composer.ts`), **pushed but not merged**. This report evaluates whether Gemini is worth adopting, and where it is most cost-effective.

> **Architectural premise (settled):** the LLM is a *swappable component*. The moat is Raj's catalogue + the purpose-built layer (feedback-not-ghostwrite discipline, Tamil deterministic tools, his accumulated data), **not** the model. So changing engines is cheap experimentation, not a strategic bet. See `feedback_tamilagaval_ai_augments_craft`.

---

## 1. Executive summary

- **Gemini 2.5 is a credible engine for Tamilagaval's augmentation tasks.** In live tests (Google AI Studio key, in-memory) Gemini 2.5 Flash passed every gate: Tamil fluency/idiom, the **feedback-not-rewrite discipline**, and — critically — **valid structured JSON matching the Critic's exact contract** (the very thing that broke Claude Sonnet 4.5).
- **Most cost-effective recommendation:** route the **cheap, high-volume, low-nuance tasks** (`lexicon-suggest`, `youtube-recommendations`) to **Gemini 2.5 Flash** now (~6× cheaper than Sonnet, quality sufficient). Keep the **nuanced Critic/Composer on Claude Sonnet 4.6** until the full adapter benchmark proves a switch — Gemini Flash is a strong candidate there too.
- **One real caveat:** Gemini 2.5 models are **thinking models** — they bill large internal-reasoning ("thought") token budgets, so the per-call cost is higher than the headline sticker suggests (still cheaper than Sonnet, but not 1/10th). The thinking budget is configurable.

---

## 2. What was tested & how

Tests were run **live against the Generative Language API** via REST (`generateContent`), in-memory only — no key written to disk or committed. The same representative Tamil critique task was used (a 3-line love-lyric draft), mirroring the real Lyric Critic job.

| # | Test | Why it matters | Result |
|---|------|----------------|--------|
| 1 | API access (AI Studio key) | Can we even call it? | ✓ works (a first, Cloud-restricted key was blocked — see §6) |
| 2 | Tamil fluency & idiom | The whole point — Tamil song quality | ✓ fluent, respectful, poetically literate (`அன்புள்ள கவிஞரே…`) |
| 3 | Feedback-not-rewrite discipline | Raj's non-negotiable (augment, don't ghostwrite) | ✓ quoted weak lines verbatim, explained *why*, never rewrote |
| 4 | Structured JSON output | The Critic's forced-contract; **broke on Claude 4.5** | ✓ valid JSON, all 5 sections (overall/strengths/slackLines/wordIdeas/questions) |

**Qualitative note:** both Gemini 2.5 Flash and Pro independently flagged the *same* legitimate weakness Claude would — the abstract closing line `காதல் என்பது அழகு` breaking the concrete நிலா/முகம் imagery — and the structured run produced genuinely good lexicon-grade word ideas: *வந்தது* → **உதித்தது / தோன்றியது / முளைத்தது**. This confirms the "Gemini is strong at Tamil" hypothesis empirically rather than by assumption.

### Measured token usage (from the live runs)

| Model | Task | Prompt | Thinking | Total | Finish |
|-------|------|-------:|---------:|------:|--------|
| gemini-2.5-flash | short critique | 66 | 888 | 1,135 | STOP |
| gemini-2.5-pro | short critique | 66 | 1,519 | 1,689 | STOP |
| gemini-2.5-flash | **structured** critique | 66 | — | 1,919 | STOP |

> `gemini-2.0-flash` is **deprecated** (404 — "no longer available"); use the 2.5 family.

---

## 3. Cost analysis

### 3.1 Indicative list pricing (USD per 1M tokens — *verify in AI Studio / Anthropic, pricing shifts*)

| Engine | Input | Output | Notes |
|--------|------:|-------:|-------|
| Claude Opus 4.8 | $5.00 | $25.00 | overkill for this use |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | **current default** for Critic/Composer |
| Claude Haiku 4.5 | $1.00 | $5.00 | cheaper Claude tier |
| Gemini 2.5 Pro | ~$1.25 | ~$10.00 | thinking billed as output; ≤200k context tier |
| **Gemini 2.5 Flash** | ~$0.30 | ~$2.50 | thinking billed as output; **the value pick** |
| Gemini 2.5 Flash-Lite | ~$0.10 | ~$0.40 | cheapest; for the simplest tasks |

### 3.2 Estimated cost per critique

Using a representative full-ballad critique of **~1k input + ~3k output** (output includes Gemini "thinking" tokens):

| Engine | Est. cost / critique | vs Sonnet |
|--------|---------------------:|-----------|
| Claude Sonnet 4.6 | **~$0.048** | 1× (baseline) |
| Gemini 2.5 Pro | ~$0.031 | ~0.6× |
| Claude Haiku 4.5 | ~$0.016 | ~0.3× |
| **Gemini 2.5 Flash** | **~$0.008** | **~0.17× (≈6× cheaper)** |
| Gemini 2.5 Flash-Lite | ~$0.001 | ~0.03× |

> These are order-of-magnitude estimates; actual cost scales with draft length and the configured **thinking budget** (lowering it cuts Gemini cost and latency further). At Tamilagaval's current low, human-in-loop volume, absolute spend is small either way — the value of Flash is headroom to run AI more freely (more critiques, background analysis) without cost anxiety.

### 3.3 Latency
Gemini Flash is fast, but **thinking adds latency** proportional to the thought-token budget; Pro thinks the most (slowest). Claude Sonnet full-ballad critiques run ~50–85 s today (off-Amplify worker). Definitive latency needs the §7 benchmark on the real task — but Flash with a capped thinking budget is a plausible way to **bring some tasks back under Amplify's ~30 s ceiling** (avoiding the worker).

---

## 4. Most cost-effective adoption plan (tiered)

| Tier | Tasks | Recommended engine | Rationale |
|------|-------|--------------------|-----------|
| **A — adopt now** | `lexicon-suggest`, `youtube-recommendations` | **Gemini 2.5 Flash** (cap thinking budget) | Low-nuance, higher-volume; ~6× cheaper; quality already sufficient. Lowest-risk saving. |
| **B — benchmark, then likely adopt** | Lyric Critic, Composer | **Gemini 2.5 Flash** candidate; keep **Claude Sonnet 4.6** as default/fallback until §7 numbers land | Passed all live tests incl. the structured contract; needs head-to-head on full briefs before owning the default. |
| **C — reserve / avoid for routine** | (the hardest reasoning, if ever) | Gemini 2.5 Pro **only** if quality demands it | Thinks heavily → highest Gemini cost + latency; rarely worth it over Flash here. |
| **Deterministic (no LLM)** | Tamil prosody, audio metrics | n/a — pure code | Already model-free; not part of this decision. |

**Net cost-effective stance:** *Default the cheap tasks to Gemini 2.5 Flash; keep the nuanced ones on Claude Sonnet 4.6 pending the benchmark; never use Pro routinely.* Keep both engines wired (the adapter) so the choice stays per-task and reversible.

---

## 5. Strategic upside beyond cost

- **Gemini can hear audio (Claude can't).** This breaks the Music Lab's documented limit ("the LLM can't hear; scores are human-entered"). A Gemini-backed step could **listen to a SUNO take** and comment on mix/vocals/arrangement — a capability Claude lacks and a genuine Tamilagaval differentiator. (Separate initiative; see `project_poo_vaasam_music_lab`.)
- **Vendor de-risking + ecosystem fit.** Exercising the adapter proves the model-agnostic design and reduces single-vendor exposure; Tamilagaval already lives in GCP (GA4, YouTube API, Lyria).

---

## 6. Risks & caveats

1. **Thinking-token cost/latency** — 2.5 models bill internal reasoning; budget it down for cheap tasks. (Measured: ~900 thought tokens Flash, ~1,500 Pro on a *short* critique.)
2. **Adapter not yet exercised end-to-end** — the live tests used raw REST + a hand-written response schema. The real path (`@google/genai` SDK + `toGeminiSchema` converter + the Zod contract) is validated by unit tests on the branch but not yet run against the live API. §7 closes this.
3. **Pricing volatility** — figures here are indicative; confirm current rates before committing budget.
4. **Key security** — the working key was pasted into the chat transcript. **Rotate or API-restrict it in AI Studio.** A first key failed because the Generative Language API was blocked for it (Cloud-console API restriction / API not enabled) — AI Studio keys avoid this.
5. **Model currency** — `gemini-2.0-flash` is retired; standardize on the **2.5** family.

---

## 7. Definitive benchmark — how to finish the evaluation

To get hard quality/cost/latency numbers on the *real* code path:

1. Check out `feat/composer-engine-adapter-gemini` (in an isolated worktree to keep `master` clean).
2. `npm install` (the branch adds `@google/genai`).
3. Provide a working `GEMINI_API_KEY` (AI Studio) **and** the `ANTHROPIC_API_KEY` (pulled in-memory) for the head-to-head.
4. Run `scripts/benchmark-composer.ts` against a representative brief/critique → compare output quality, tokens/cost, and latency, Gemini Flash + Pro vs Claude Sonnet 4.6.
5. Decide defaults per Tier A/B above; merge the adapter so Gemini is a first-class, per-task option.

**Prod stays on Anthropic** until the benchmark earns any default change.

---

## 8. Decision checklist

- [ ] Rotate/restrict the exposed AI Studio key.
- [ ] Run the §7 benchmark for definitive numbers (needs a working key + Claude key).
- [ ] Adopt Gemini 2.5 Flash for `lexicon-suggest` + `youtube-recommendations` (Tier A).
- [ ] Merge `feat/composer-engine-adapter-gemini` so the engine is selectable per task.
- [ ] Decide Critic/Composer default after the benchmark (Tier B).
- [ ] (Stretch) Prototype "Gemini listens to a Music Lab take".
