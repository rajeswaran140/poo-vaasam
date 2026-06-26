# FE/BE Audit Remediation — 2026-06-26

Comprehensive frontend + backend audit (4 parallel auditors over the 102 commits since the 2026-06-09 baseline). Verdict: **no critical/high issues**; the items below were the medium/low findings. All fixed with tests; `tsc`/lint/full-suite green (**1,674 tests**, +39 from audit start).

## MEDIUM

| Fix | Files | Tests |
|---|---|---|
| **Public `/api/ai/chat` input cap** — Zod bounds the body before the LLM: `messages` 1–20, each `content` ≤4000 chars, `role` ∈ {user,assistant}, `poemId` ≤200. Blocks token-cost amplification on an unauthenticated route. | `src/app/api/ai/chat/route.ts` | `__tests__/api/ai-chat.test.ts` (7) |
| **Un-paginated admin Scans → silent 1 MB truncation.** New reusable `DynamoDBOperations.scanAll` (loops `LastEvaluatedKey`, `maxItems` safety cap, returns `truncated`); wired into the contact + subscribers admin reads, which now surface a `truncated` flag. | `src/infrastructure/database/dynamodb-client.ts`, `src/app/api/admin/contact/route.ts`, `src/app/api/admin/subscribers/route.ts` | `dynamodb-scanall.test.ts` (3), `admin-contact.test.ts` (4), `admin-subscribers.test.ts` (+1) |

## LOW

| Fix | Files | Tests |
|---|---|---|
| **Cost-abuse `limit` clamps** (1–50, NaN→default) on the public search/related routes. | `src/app/api/ai/search/route.ts`, `src/app/api/content/related/route.ts` | `content-related.test.ts` (4), `ai-search.test.ts` |
| **TTS error-detail leak** — both TTS routes returned the raw internal `error.message` (`details`). Now log via `logger` server-side, return a generic client message. | `src/app/api/tts/synthesize/route.ts`, `src/app/api/tts/context-aware/route.ts` | `tts-synthesize.test.ts` (3) |
| **analyze-poem masked failures** — on LLM/parse failure it returned `success:true` with a default "sad" analysis, indistinguishable from a real classification. Now adds `degraded:true` so outages are observable; logs the real error. | `src/app/api/ai/analyze-poem/route.ts` | `ai-analyze-poem.test.ts` (3) |
| **Search `type` not validated** against the `ContentType` enum before billable embedding work. Now 400s on an invalid type. | `src/app/api/ai/search/route.ts` | `ai-search.test.ts` |
| **Stray `console.log`/`console.error`** on production AI paths → routed through `logger`. | `ai/search/route.ts`, `services/ai/openai.ts`, `services/ai/embeddingCache.ts` | n/a (logging) |
| **3 untested AI adapters** now have unit tests for their pure/logic surface. | — | `google-tts.test.ts` (5), `claude-suggestions.test.ts` (2), `embeddingCache.test.ts` (4) |
| **`PerformanceDashboard` used plain `fetch`** on admin endpoints (would 401). → `adminFetch`. (Latent — component not yet mounted.) | `src/components/admin/PerformanceDashboard.tsx` | n/a |
| **`changeDays` stale-response race** in the YouTube panel — a slow old-range response could clobber a newer one. Added a monotonic request-token guard. | `src/components/admin/YouTubeVideosPanel.tsx` | n/a |
| **a11y warning** — lucide `Image` icon tripped `jsx-a11y/alt-text`; aliased to `ImageIcon` + `aria-hidden`. | `src/app/(admin)/admin/media/page.tsx` | n/a |
| **Deleted dead/stale files** — broken `debug/tts` page (coupled to a since-hardened endpoint) and the throwaway `publish-ellarkkum-draft.ts` script (the only thing breaking repo-wide `tsc`). | removed | — |

## Notes / deliberately not changed
- `WordPalette` async load: already re-entrancy-guarded (`!loaded && !loading`) and React 19 no-ops setState-after-unmount → no change needed.
- Rate limiters remain **in-memory + XFF-trusting** — fine at current traffic; move to a shared store (DynamoDB-TTL) when traffic grows. (Watch-later, not a defect.)
- CSP keeps `unsafe-inline`/`unsafe-eval` (Next App-Router limitation) — nonce hardening is the eventual step.
- One stale `.next/types/validator.ts` reference to the deleted debug page regenerates clean on the next `next build`.

## Verified clean (no action)
Auth (JWT verified, fail-closed prod), no XSS/SSRF/injection/path-traversal/open-redirect, LLM off the render path, Amplify SSR split correct, **no `NEXT_PUBLIC` AWS secret in the Amplify env or client bundle** (re-verified live).
